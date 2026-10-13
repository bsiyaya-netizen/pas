import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { formatDate, formatRand, policyDocument } from "../src/documents/policy-document.js";
import { renderCertificate, renderSchedule } from "../src/documents/render.js";
import type { Broker } from "../src/parties.js";
import { bindQuote, createQuote } from "../src/quote/quote.js";
import { catalog, cleanRisk, productB } from "./fixtures.js";

const broker: Broker = { id: "brk-1", name: "Leetile Brokers", fspNumber: "51234" };
const client = { id: "cli-1", name: "T. Mokoena" };
const fullClient = {
  ...client,
  idNumber: "8001015009087",
  phone: "082 123 4567",
  email: "t.mokoena@example.com",
  address: { line1: "12 Jacaranda Street", suburb: "Rosebank", city: "Johannesburg", postalCode: "2196" },
};
const vehicle = { ...cleanRisk.vehicle, make: "Toyota", model: "Corolla Cross 1.8 XS", year: 2023, registration: "CA 123-456" };
const today = { now: () => new Date("2026-10-13T10:00:00Z") };

function issuedPolicy(coverages: string[] = [], risk: Record<string, unknown> = cleanRisk) {
  const quote = createQuote(
    catalog,
    { broker, client, line: "motor", effectiveDate: "2026-11-01", risk, coverages },
    { ...today, quoteId: "q-1" },
  );
  return bindQuote(quote, "example-b-motor", broker, { ...today, policyNumber: "POL-0000001", transactionId: "t-1" })
    .policy;
}

const doc = (coverages?: string[]) =>
  policyDocument(issuedPolicy(coverages), { broker, client, product: productB, issuedOn: "2026-10-13" });

describe("policyDocument", () => {
  it("collects the parties, period and premium for the current version", () => {
    const d = doc([]);
    expect(d).toMatchObject({
      policyNumber: "POL-0000001",
      issuedOn: "2026-10-13",
      lineName: "Motor",
      insured: { name: "T. Mokoena" },
      broker: { name: "Leetile Brokers", fspNumber: "51234" },
      insurer: { name: "Example Insurer B", registeredName: "Example Insurer B Limited (fictional)", fspNumber: "99902" },
      term: { number: 1, from: "2026-11-01", to: "2027-10-31" },
      version: { number: 1, effectiveFrom: "2026-11-01" },
      premium: { total: 93_450, vatRate: 0.15 },
      sumInsured: 30_000_000,
    });
    expect(d.premium.vat + d.premium.excludingVat).toBe(d.premium.total);
    expect(d.sections.reduce((sum, s) => sum + s.premium, 0) + d.minimumPremiumAdjustment).toBe(d.premium.total);
    expect(d.commission.excludedSections).toEqual(["SASRIA special risks"]);
  });

  it("describes a motor risk in plain words", () => {
    expect(doc().risk).toEqual([
      {
        heading: "Vehicle",
        rows: [
          ["Sum insured", "R300 000"],
          ["Use", "Private"],
          ["Kept overnight in", "Gauteng"],
        ],
      },
      {
        heading: "Regular driver",
        rows: [
          ["Age", "35"],
          ["Claims in the last 3 years", "0"],
          ["Licence issued", "1 March 2010"],
        ],
      },
      { heading: "Excess", rows: [["Basic excess per claim", "R5 000"]] },
    ]);
  });
});

describe("client and vehicle details", () => {
  it("prints the policyholder's ID, address and contact details and identifies the vehicle", () => {
    const d = policyDocument(issuedPolicy([], { ...cleanRisk, vehicle }), {
      broker,
      client: fullClient,
      product: productB,
      issuedOn: "2026-10-13",
    });
    expect(d.insured).toEqual({
      name: "T. Mokoena",
      idNumber: "8001015009087",
      address: "12 Jacaranda Street, Rosebank, Johannesburg, 2196",
      contact: "082 123 4567, t.mokoena@example.com",
    });
    expect(d.risk[0]!.rows.slice(0, 2)).toEqual([
      ["Vehicle", "2023 Toyota Corolla Cross 1.8 XS"],
      ["Registration", "CA 123-456"],
    ]);
  });

  it("leaves out details that were never captured", () => {
    expect(doc().insured).toEqual({ name: "T. Mokoena" });
    expect(doc().risk[0]!.rows[0]![0]).toBe("Sum insured");
  });
});

describe("formatting", () => {
  it("writes rand and dates the South African way", () => {
    expect(formatRand(101_250)).toBe("R1 012.50");
    expect(formatRand(123_456_789)).toBe("R1 234 567.89");
    expect(formatRand(30_000_000, { cents: false })).toBe("R300 000");
    expect(formatRand(5)).toBe("R0.05");
    expect(formatDate("2027-10-31")).toBe("31 October 2027");
  });
});

describe("PDF rendering", () => {
  it("renders the schedule and the certificate as A4 PDFs", async () => {
    for (const [render, title] of [
      [renderSchedule, "Policy schedule POL-0000001"],
      [renderCertificate, "Certificate of insurance POL-0000001"],
    ] as const) {
      const bytes = await render(doc());
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getTitle()).toBe(title);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.28);
    }
  });

  it("does not fail on names the standard fonts cannot draw", async () => {
    const d = { ...doc(), insured: { name: "Nguyễn Thị Ŋ 李" } };
    await expect(renderSchedule(d)).resolves.toBeInstanceOf(Uint8Array);
  });
});
