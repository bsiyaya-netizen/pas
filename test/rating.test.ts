import { describe, expect, it } from "vitest";
import { ProductCatalog } from "../src/product/catalog.js";
import { parseProduct, type Product } from "../src/product/schema.js";
import { rate, RatingError, type RatingRequest } from "../src/rating/engine.js";
import { compareInsurers } from "../src/rating/compare.js";
import { products, productA } from "./fixtures.js";

const risk = {
  territory: "gauteng",
  excessOption: 5000,
  vehicle: { value: 300_000, use: "private" },
  driver: { age: 35, claimsLast3Years: 0 },
};

describe("rate", () => {
  it("prices a motor risk with a worksheet, VAT split and commission", () => {
    const result = rate(productA, { coverages: ["car_hire"], risk });

    // 0.045 x 300 000 / 12 x 1.0 (age) x 0.9 (no claims) x 1.0 (R5 000 excess) = R1 012.50
    expect(result.coverages.map((c) => [c.code, c.premium])).toEqual([
      ["comprehensive", 101_250],
      ["car_hire", 8_500],
      ["sasria", 1_200],
    ]);
    expect(result.coverages[0]!.worksheet.map((w) => w.label)).toEqual([
      "Base annual rate",
      "Vehicle value",
      "Monthly",
      "Driver age factor",
      "Claims history factor",
      "Excess option factor",
      "Coverage minimum",
    ]);
    expect(result.totalPremium).toBe(110_950);
    expect(result.totalExcludingVat).toBe(96_478);
    expect(result.vat).toBe(14_472);
    // SASRIA carries no commission: (101 250 + 8 500) / 1.15 x 12.5%
    expect(result.commissionRate).toBe(0.125);
    expect(result.commission).toBe(11_929);
  });

  it("falls back to the wildcard row when the territory has no specific rate", () => {
    const result = rate(productA, { coverages: [], risk: { ...risk, territory: "kwazulu_natal" } });
    // 0.035 x 300 000 / 12 x 0.9 = R787.50
    expect(result.coverages[0]!.premium).toBe(78_750);
  });

  it("tops up to the product minimum premium", () => {
    const result = rate(productA, {
      coverages: [],
      risk: { ...risk, territory: "western_cape", vehicle: { value: 20_000, use: "private" } },
    });
    expect(result.coverages[0]!.premium).toBe(20_000); // coverage minimum R200
    expect(result.minimumPremiumAdjustment).toBe(3_800); // up to R250 with SASRIA
    expect(result.totalPremium).toBe(25_000);
  });

  it("adds VAT on top when premiums are quoted excluding VAT", () => {
    const exclusive = { ...productA, tax: { vatRate: 0.15, premiumsIncludeVat: false } };
    const result = rate(exclusive, { coverages: [], risk });
    expect(result.totalExcludingVat).toBe(102_450);
    expect(result.totalPremium).toBe(117_818);
    expect(result.vat).toBe(15_368);
    expect(result.commission).toBe(12_656); // 101 250 x 12.5%
  });

  it("rejects commission above the regulatory cap", () => {
    expect(() => rate(productA, { coverages: [], risk, commissionRate: 0.2 })).toThrow(/cap/);
  });

  it("explains missing inputs and unmatched rates", () => {
    const missing: RatingRequest = { coverages: [], risk: { ...risk, driver: { claimsLast3Years: 0 } } };
    expect(() => rate(productA, missing)).toThrow(RatingError);
    expect(() => rate(productA, missing)).toThrow('Missing input "driver.age"');

    const tooYoung = { coverages: [], risk: { ...risk, driver: { age: 17, claimsLast3Years: 0 } } };
    expect(() => rate(productA, tooYoung)).toThrow(/No row in table "driverAge"/);

    expect(() => rate(productA, { coverages: ["boat"], risk })).toThrow(/does not offer/);
  });
});

describe("compareInsurers", () => {
  const catalog = new ProductCatalog(products);

  it("lists insurers cheapest first", () => {
    const quotes = compareInsurers(catalog, "motor", "2026-10-13", { coverages: [], risk });
    expect(quotes.map((q) => [q.insurer, q.result?.totalPremium])).toEqual([
      ["Example Insurer B", 93_450],
      ["Example Insurer A", 102_450],
    ]);
  });

  it("lists insurers that cannot price the risk last, with the reason", () => {
    const young = { ...risk, driver: { age: 19, claimsLast3Years: 0 } };
    const quotes = compareInsurers(catalog, "motor", "2026-10-13", { coverages: [], risk: young });
    expect(quotes[0]!.insurer).toBe("Example Insurer A");
    expect(quotes[1]).toMatchObject({ insurer: "Example Insurer B" });
    expect(quotes[1]!.error).toMatch(/driverAge/);
  });
});

describe("ProductCatalog", () => {
  const v2: Product = { ...productA, version: 2, effectiveFrom: "2027-01-01", minimumPremium: 400 };
  const catalog = new ProductCatalog([productA, v2]);

  it("resolves the version in force on a date", () => {
    expect(catalog.resolve("example-a-motor", "2026-12-31")?.version).toBe(1);
    expect(catalog.resolve("example-a-motor", "2027-01-01")?.version).toBe(2);
    expect(catalog.resolve("example-a-motor", "2025-06-01")).toBeUndefined();
  });

  it("refuses to load the same version twice", () => {
    expect(() => catalog.add(productA)).toThrow(/already loaded/);
  });
});

describe("product schema", () => {
  it("rejects a step that points at a missing table", () => {
    const broken = structuredClone(productA) as Record<string, any>;
    broken.coverages[0].steps[0].operand.table = "nope";
    expect(() => parseProduct(broken)).toThrow(/Unknown table "nope"/);
  });

  it("rejects a lookup that leaves a table dimension unkeyed", () => {
    const broken = structuredClone(productA) as Record<string, any>;
    delete broken.coverages[0].steps[0].operand.keys.use;
    expect(() => parseProduct(broken)).toThrow(/Missing key for dimension "use"/);
  });
});
