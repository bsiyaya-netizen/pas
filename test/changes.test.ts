import { describe, expect, it } from "vitest";
import { addMonths, daysBetween } from "../src/dates.js";
import { billingPeriod, cancel, endorse, previewCancellation, previewEndorsement } from "../src/policy/changes.js";
import { versionOn, type Policy } from "../src/policy/policy.js";
import type { Broker } from "../src/parties.js";
import { bindQuote, createQuote } from "../src/quote/quote.js";
import { catalog, cleanRisk, productA } from "./fixtures.js";

const broker: Broker = { id: "brk-1", name: "Leetile Brokers", fspNumber: "51234" };
const at = (iso: string) => ({ now: () => new Date(iso) });
const today = at("2026-10-13T10:00:00Z");
const deps = (id: string, clock = today) => ({ ...clock, transactionId: id });

/** Insurer A, cover from 1 November 2026 at R1 024.50 a month (comprehensive and SASRIA). */
function policy(): Policy {
  const quote = createQuote(
    catalog,
    { broker, client: { id: "c", name: "T. Mokoena" }, line: "motor", effectiveDate: "2026-11-01", risk: cleanRisk, coverages: [] },
    { ...today, quoteId: "q" },
  );
  return bindQuote(quote, "example-a-motor", broker, { ...today, policyNumber: "POL-0000001", transactionId: "t-1" }).policy;
}

const withCarHire = { effectiveDate: "2026-11-16", risk: cleanRisk, coverages: ["car_hire"] };

describe("dates", () => {
  it("adds months without drifting past short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(daysBetween("2026-11-16", "2026-12-01")).toBe(15);
  });

  it("finds the monthly period a date falls in, counted from the term start", () => {
    const term = policy().terms[0]!;
    expect(billingPeriod(term, "2026-11-01")).toEqual({ start: "2026-11-01", end: "2026-12-01" });
    expect(billingPeriod(term, "2027-02-28")).toEqual({ start: "2027-02-01", end: "2027-03-01" });
  });
});

describe("endorsements", () => {
  it("prices a change with the policy's own rates and a pro-rata charge for the rest of the month", () => {
    const preview = previewEndorsement(policy(), productA, withCarHire, today);
    expect(preview).toMatchObject({ premiumBefore: 102_450, premiumAfter: 110_950, proRataAdjustment: 4_250 });
  });

  it("adds a version and an endorsement transaction, keeping the old version for its dates", () => {
    const { policy: changed } = endorse(policy(), productA, withCarHire, broker, deps("t-2"));
    expect(changed.terms[0]!.versions.map((v) => [v.number, v.effectiveFrom, v.coverages])).toEqual([
      [1, "2026-11-01", ["comprehensive", "sasria"]],
      [2, "2026-11-16", ["comprehensive", "car_hire", "sasria"]],
    ]);
    expect(versionOn(changed, "2026-11-15")!.number).toBe(1);
    expect(versionOn(changed, "2026-11-16")!.number).toBe(2);
    expect(changed.transactions.at(-1)).toMatchObject({
      id: "t-2",
      type: "endorsement",
      premiumDelta: 8_500,
      proRataAdjustment: 4_250,
      description: "Added Car hire (30 days)",
      processedBy: "brk-1",
    });
  });

  it("describes risk changes and returns premium when cover goes down", () => {
    const cheaper = { ...cleanRisk, vehicle: { ...cleanRisk.vehicle, value: 200_000, registration: "CA 1" } };
    const { policy: changed, preview } = endorse(
      policy(),
      productA,
      { effectiveDate: "2026-11-01", risk: cheaper, coverages: [] },
      broker,
      deps("t-2"),
    );
    expect(preview.premiumAfter).toBeLessThan(preview.premiumBefore);
    expect(preview.proRataAdjustment).toBe(preview.premiumAfter - preview.premiumBefore);
    expect(changed.transactions.at(-1)!.description).toBe("Changed vehicle.value, vehicle.registration");
  });

  it("refuses backdated changes, dates outside the term, and dates before an earlier change", () => {
    expect(() => previewEndorsement(policy(), productA, { ...withCarHire, effectiveDate: "2026-10-12" }, today)).toThrow(
      /cannot be backdated/,
    );
    expect(() => previewEndorsement(policy(), productA, { ...withCarHire, effectiveDate: "2027-11-01" }, today)).toThrow(
      /within the current period/,
    );
    const changed = endorse(policy(), productA, withCarHire, broker, deps("t-2")).policy;
    expect(() => previewEndorsement(changed, productA, { ...withCarHire, effectiveDate: "2026-11-10" }, today)).toThrow(
      /already made from 2026-11-16/,
    );
  });

  it("refuses changes the insurer declines or must refer, and covers it does not offer", () => {
    const refer = { ...cleanRisk, driver: { ...cleanRisk.driver, claimsLast3Years: 3 } };
    expect(() => previewEndorsement(policy(), productA, { ...withCarHire, risk: refer }, today)).toThrow(
      /needs Example Insurer A's underwriters/,
    );
    const decline = { ...cleanRisk, vehicle: { ...cleanRisk.vehicle, value: 2_000_000 } };
    expect(() => previewEndorsement(policy(), productA, { ...withCarHire, risk: decline }, today)).toThrow(
      /will not cover this change/,
    );
    expect(() => previewEndorsement(policy(), productA, { ...withCarHire, coverages: ["jet_ski"] }, today)).toThrow(
      /does not offer the "jet_ski" cover/,
    );
  });

  it("only lets the policy's broker change it", () => {
    expect(() => endorse(policy(), productA, withCarHire, { ...broker, id: "other" }, deps("t-2"))).toThrow(/policy's broker/);
  });
});

describe("cancellations", () => {
  it("returns the unused part of the month's premium", () => {
    expect(previewCancellation(policy(), { effectiveDate: "2026-11-16" }, today)).toEqual({
      effectiveDate: "2026-11-16",
      lastDayOfCover: "2026-11-15",
      refund: 51_225,
    });
    // Before cover starts, the whole first month comes back.
    expect(previewCancellation(policy(), { effectiveDate: "2026-11-01" }, today).refund).toBe(102_450);
  });

  it("uses the premium in force before the cancellation date", () => {
    const changed = endorse(policy(), productA, withCarHire, broker, deps("t-2")).policy;
    expect(previewCancellation(changed, { effectiveDate: "2026-11-21" }, today).refund).toBe(Math.round((110_950 * 10) / 30));
    expect(previewCancellation(changed, { effectiveDate: "2026-11-16" }, today).refund).toBe(51_225);
  });

  it("ends cover from the date and blocks any further change", () => {
    const { policy: cancelled } = cancel(
      policy(),
      { effectiveDate: "2026-11-16", reason: "vehicle_sold", note: " Sold to a dealer " },
      broker,
      deps("t-2"),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellation).toEqual({ effectiveDate: "2026-11-16", reason: "vehicle_sold", note: "Sold to a dealer", transactionId: "t-2" });
    expect(cancelled.transactions.at(-1)).toMatchObject({
      type: "cancellation",
      premiumDelta: -102_450,
      proRataAdjustment: -51_225,
      description: "Cancelled because the vehicle was sold (Sold to a dealer)",
    });
    expect(versionOn(cancelled, "2026-11-15")!.number).toBe(1);
    expect(versionOn(cancelled, "2026-11-16")).toBeUndefined();
    expect(() => previewEndorsement(cancelled, productA, withCarHire, today)).toThrow(/cancelled and cannot be changed/);
    expect(() => previewCancellation(cancelled, { effectiveDate: "2026-12-01" }, today)).toThrow(/cancelled/);
  });
});
