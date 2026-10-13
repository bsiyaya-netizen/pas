import { describe, expect, it } from "vitest";
import { cancel, endorse } from "../src/policy/changes.js";
import type { Policy } from "../src/policy/policy.js";
import type { Broker, Client } from "../src/parties.js";
import { bindQuote, createQuote, referOption, type Quote } from "../src/quote/quote.js";
import { brokerDashboard, monthlyActivity } from "../src/reporting/dashboard.js";
import { policyRegister, toCsv, transactionReport } from "../src/reporting/reports.js";
import { catalog, cleanRisk, productA } from "./fixtures.js";

const broker: Broker = { id: "brk-1", name: "Leetile Brokers", fspNumber: "51234" };
const clients: Client[] = [
  { id: "c1", name: "T. Mokoena", idNumber: "8001015009087" },
  { id: "c2", name: "=SUM(A1)" },
  { id: "c3", name: "Smith, J" },
];
const at = (iso: string) => ({ now: () => new Date(iso) });
const risk = { ...cleanRisk, vehicle: { ...cleanRisk.vehicle, make: "Toyota", model: "Corolla", year: 2023, registration: "CA 1" } };

function quote(id: string, clientId: string, createdAt: string, effectiveDate: string, r: Record<string, unknown> = risk): Quote {
  return createQuote(
    catalog,
    { broker, client: clients.find((c) => c.id === clientId)!, line: "motor", effectiveDate, risk: r, coverages: [] },
    { ...at(createdAt), quoteId: id },
  );
}

function bind(q: Quote, productId: string, n: string, when: string): Policy {
  return bindQuote(q, productId, broker, { ...at(when), policyNumber: n, transactionId: `${n}-1` }).policy;
}

/**
 * The book on 15 March 2027:
 * - POL-1 (A, R1 024.50) from 1 Sep 2026, endorsed with car hire from 1 Feb 2027 (R1 109.50).
 * - POL-2 (B, R934.50) from 1 Nov 2026, cancelled from 1 Mar 2027.
 * - POL-3 (A) starts 1 Apr 2027, ends in the future.
 * - POL-4 (B) from 1 May 2026, so its term ends 30 Apr 2027: due for renewal.
 * Plus an open quote expiring soon and a referred one.
 */
function book() {
  const q1 = quote("q1", "c1", "2026-08-20T09:00:00Z", "2026-09-01");
  let p1 = bind(q1, "example-a-motor", "POL-1", "2026-08-21T09:00:00Z");
  p1 = endorse(p1, productA, { effectiveDate: "2027-02-01", risk, coverages: ["car_hire"] }, broker, {
    ...at("2027-01-25T09:00:00Z"),
    transactionId: "POL-1-2",
  }).policy;

  const q2 = quote("q2", "c2", "2026-10-20T09:00:00Z", "2026-11-01");
  let p2 = bind(q2, "example-b-motor", "POL-2", "2026-10-21T09:00:00Z");
  p2 = cancel(p2, { effectiveDate: "2027-03-01", reason: "vehicle_sold" }, broker, {
    ...at("2027-02-27T09:00:00Z"),
    transactionId: "POL-2-2",
  }).policy;

  const q3 = quote("q3", "c3", "2027-03-01T09:00:00Z", "2027-04-01");
  const p3 = bind(q3, "example-a-motor", "POL-3", "2027-03-02T09:00:00Z");
  const q4 = quote("q4", "c1", "2026-04-20T09:00:00Z", "2026-05-01");
  const p4 = bind(q4, "example-b-motor", "POL-4", "2026-04-21T09:00:00Z");

  const open = quote("q5", "c3", "2027-02-17T09:00:00Z", "2027-03-20");
  const claims = { ...risk, driver: { ...risk.driver, claimsLast3Years: 3 } };
  const referred = referOption(quote("q6", "c1", "2027-03-10T09:00:00Z", "2027-04-01", claims), "example-a-motor", at("2027-03-10T10:00:00Z"));
  const quotes = [
    { ...q1, status: "bound" as const },
    { ...q2, status: "bound" as const },
    { ...q3, status: "bound" as const },
    { ...q4, status: "bound" as const },
    open,
    referred,
  ];
  return { policies: [p1, p2, p3, p4], quotes };
}

describe("brokerDashboard", () => {
  const { policies, quotes } = book();
  const d = brokerDashboard(policies, quotes, clients, "2027-03-15");

  it("totals the cover in force today, by insurer", () => {
    expect(d.inForce.policies).toBe(2);
    expect(d.inForce.premium).toBe(110_950 + 93_450);
    expect(d.byInsurer.map((r) => [r.insurer, r.policies, r.premium])).toEqual([
      ["Example Insurer A", 1, 110_950],
      ["Example Insurer B", 1, 93_450],
    ]);
    expect(d.inForce.commission).toBe(d.byInsurer[0]!.commission + d.byInsurer[1]!.commission);
    expect(d.startingSoon).toBe(1);
  });

  it("tracks quotes, conversion and referrals", () => {
    expect(d.quotes).toMatchObject({ last30Days: 3, boundLast30Days: 1, awaitingUnderwriter: 1 });
    expect(d.quotes.conversionRate).toBeCloseTo(1 / 3);
    expect(d.quotes.expiringSoon).toEqual([{ id: "q5", clientName: "Smith, J", expiresOn: "2027-03-19" }]);
  });

  it("lists renewals due within 60 days, skipping cancelled policies", () => {
    expect(d.renewalsDue.map((r) => [r.policyNumber, r.endsOn])).toEqual([["POL-4", "2027-04-30"]]);
  });

  it("counts activity per month by processing date and lists the latest first", () => {
    const months = Object.fromEntries(d.months.map((m) => [m.month, m]));
    expect(d.months).toHaveLength(12);
    expect(d.months[0]!.month).toBe("2026-04");
    expect(d.months.at(-1)!.month).toBe("2027-03");
    expect(months["2027-01"]).toMatchObject({ endorsements: 1, premiumChange: 8_500 });
    expect(months["2027-02"]).toMatchObject({ cancellations: 1, premiumChange: -93_450 });
    expect(months["2027-03"]).toMatchObject({ newPolicies: 1, newPremium: 102_450 });
    expect(d.recent.map((t) => t.id).slice(0, 3)).toEqual(["POL-3-1", "POL-2-2", "POL-1-2"]);
  });

  it("handles an empty book", () => {
    const empty = brokerDashboard([], [], [], "2027-03-15");
    expect(empty.inForce).toEqual({ policies: 0, premium: 0, commission: 0 });
    expect(empty.quotes.conversionRate).toBeNull();
    expect(monthlyActivity([], "2027-01-31", 3).map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("reports", () => {
  const { policies } = book();

  it("lists every policy with its status and cover on the date", () => {
    const r = policyRegister(policies, clients, "2027-03-15");
    const rows = Object.fromEntries(r.rows.map((row) => [row[0], row]));
    expect(r.header).toContain("Monthly premium (R)");
    expect(rows["POL-1"]).toEqual([
      "POL-1",
      "T. Mokoena",
      "8001015009087",
      "Example Insurer A",
      "Motor",
      "In force",
      "2026-09-01",
      "2027-08-31",
      "1109.50",
      "144.72",
      "119.29",
      "2023 Toyota Corolla",
      "CA 1",
      "300000.00",
    ]);
    expect(rows["POL-2"]!.slice(5, 9)).toEqual(["Cancelled", "2026-11-01", "2027-02-28", "934.50"]);
    expect(rows["POL-3"]![5]).toBe("Not started");
  });

  it("lists transactions processed in a date range", () => {
    const r = transactionReport(policies, clients, "2027-01-01", "2027-02-28");
    expect(r.rows.map((row) => [row[0], row[2], row[5], row[7], row[8]])).toEqual([
      ["2027-01-25", "POL-1", "Change", "85.00", expect.any(String)],
      ["2027-02-27", "POL-2", "Cancellation", "-934.50", expect.stringMatching(/^-\d+\.\d\d$/)],
    ]);
  });

  it("writes CSV that spreadsheets read safely", () => {
    const csv = toCsv({ header: ["Name", "Amount"], rows: [["Smith, J", "-12.50"], ["=SUM(A1)", null], ['Say "hi"', "1.00"]] });
    expect(csv).toBe('﻿Name,Amount\r\n"Smith, J",-12.50\r\n\'=SUM(A1),\r\n"Say ""hi""",1.00\r\n');
  });
});
