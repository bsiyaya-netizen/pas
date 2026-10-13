import { describe, expect, it } from "vitest";
import { parseProduct, type Product } from "../src/product/schema.js";
import { assess, requiredAuthority } from "../src/underwriting/rules.js";
import { cleanRisk, productA, productB } from "./fixtures.js";

const withRules = (rules: unknown[]): Product =>
  parseProduct({ ...structuredClone(productA), underwriting: { rules } });

describe("assess", () => {
  it("accepts a clean risk", () => {
    expect(assess(productA, cleanRisk, 102_450)).toEqual({ outcome: "accept", hits: [] });
  });

  it("warns without blocking when a field is missing", () => {
    const risk = { ...cleanRisk, driver: { age: 35, claimsLast3Years: 0 } };
    const result = assess(productA, risk, 102_450);
    expect(result.outcome).toBe("accept");
    expect(result.hits.map((h) => [h.ruleId, h.outcome])).toEqual([["licence-date-missing", "warn"]]);
  });

  it("refers and reports the highest authority needed", () => {
    const risk = { ...cleanRisk, vehicle: { value: 900_000, use: "private" }, driver: { ...cleanRisk.driver, claimsLast3Years: 3 } };
    const result = assess(productA, risk, 500_000);
    expect(result.outcome).toBe("refer");
    expect(result.hits.map((h) => h.ruleId)).toEqual(["claims-3-in-3", "high-value-vehicle"]);
    expect(requiredAuthority(result.hits)).toBe(2);
  });

  it("lets a decline win over a referral", () => {
    const risk = { ...cleanRisk, vehicle: { value: 2_000_000, use: "private" } };
    const result = assess(productA, risk, 500_000);
    expect(result.outcome).toBe("decline");
    expect(result.hits.map((h) => h.ruleId)).toEqual(["vehicle-value-max", "high-value-vehicle"]);
  });

  it("only fires an all-condition when every part holds", () => {
    const youngBusiness = { ...cleanRisk, vehicle: { value: 300_000, use: "business" }, driver: { ...cleanRisk.driver, age: 22 } };
    const youngPrivate = { ...youngBusiness, vehicle: { value: 300_000, use: "private" } };
    expect(assess(productA, youngBusiness, 0).hits.map((h) => h.ruleId)).toEqual(["young-driver-business-use"]);
    expect(assess(productA, youngPrivate, 0).hits).toEqual([]);
  });

  it("can test the quoted premium in rand", () => {
    expect(assess(productB, cleanRisk, 300_000).outcome).toBe("accept"); // exactly R3 000
    expect(assess(productB, cleanRisk, 300_001).hits.map((h) => h.ruleId)).toEqual(["premium-over-3000"]);
  });

  it("supports any-conditions and in-lists", () => {
    const product = withRules([
      {
        id: "coastal-or-old",
        message: "Coastal territory or older driver",
        outcome: "warn",
        when: { any: [{ field: "territory", op: "in", value: ["western_cape", "kwazulu_natal"] }, { field: "driver.age", op: "gte", value: 70 }] },
      },
    ]);
    expect(assess(product, cleanRisk, 0).hits).toEqual([]);
    expect(assess(product, { ...cleanRisk, territory: "western_cape" }, 0).hits).toHaveLength(1);
    expect(assess(product, { ...cleanRisk, driver: { ...cleanRisk.driver, age: 72 } }, 0).hits).toHaveLength(1);
  });
});

describe("underwriting rule schema", () => {
  it("requires an authority grade on refer rules", () => {
    expect(() =>
      withRules([{ id: "r", message: "m", outcome: "refer", when: { field: "territory", op: "eq", value: "gauteng" } }]),
    ).toThrow(/authority is required/);
  });

  it("rejects duplicate rule ids", () => {
    const rule = { id: "r", message: "m", outcome: "warn", when: { field: "territory", op: "missing" } };
    expect(() => withRules([rule, rule])).toThrow(/Duplicate rule id "r"/);
  });

  it("requires a list for the in operator", () => {
    expect(() =>
      withRules([{ id: "r", message: "m", outcome: "warn", when: { field: "territory", op: "in", value: "gauteng" } }]),
    ).toThrow(/takes a list/);
  });
});
