import { describe, expect, it } from "vitest";
import type { Broker, Underwriter } from "../src/parties.js";
import { versionOn } from "../src/policy/policy.js";
import {
  bindQuote,
  createQuote,
  decideReferral,
  optionStatus,
  referOption,
  type NewQuote,
} from "../src/quote/quote.js";
import { catalog, cleanRisk } from "./fixtures.js";

const broker: Broker = { id: "brk-1", name: "Leetile Brokers", fspNumber: "51234" };
const otherBroker: Broker = { id: "brk-2", name: "Other Brokers", fspNumber: "40000" };
const junior: Underwriter = { id: "uw-1", name: "Junior UW", authority: 1 };
const senior: Underwriter = { id: "uw-2", name: "Senior UW", authority: 2 };

const at = (iso: string) => ({ now: () => new Date(iso) });
const today = at("2026-10-13T10:00:00Z");
const bindDeps = { ...today, policyNumber: "POL-000001", transactionId: "txn-1" };

const request = (risk: Record<string, unknown> = cleanRisk): NewQuote => ({
  broker,
  client: { id: "cli-1", name: "T. Mokoena" },
  line: "motor",
  effectiveDate: "2026-11-01",
  risk,
  coverages: [],
});
const quote = (risk?: Record<string, unknown>) => createQuote(catalog, request(risk), { ...today, quoteId: "q-1" });

describe("createQuote", () => {
  it("prices every insurer, cheapest first, valid for 30 days", () => {
    const q = quote();
    expect(q.expiresOn).toBe("2026-11-12");
    expect(q.options.map((o) => [o.insurer, o.rating?.totalPremium, optionStatus(o)])).toEqual([
      ["Example Insurer B", 93_450, "bindable"],
      ["Example Insurer A", 102_450, "bindable"],
    ]);
  });

  it("keeps insurers that cannot price or decline the risk, with the reason", () => {
    const young = quote({ ...cleanRisk, driver: { ...cleanRisk.driver, age: 19 } });
    expect(young.options.map((o) => [o.insurer, optionStatus(o)])).toEqual([
      ["Example Insurer A", "bindable"],
      ["Example Insurer B", "unpriceable"],
    ]);
    expect(young.options[1]!.error).toMatch(/driverAge/);

    const pricey = quote({ ...cleanRisk, vehicle: { value: 1_200_000, use: "private" } });
    expect(pricey.options.map((o) => [o.insurer, optionStatus(o)])).toEqual([
      ["Example Insurer B", "declined"],
      ["Example Insurer A", "needs_referral"],
    ]);
  });

  it("refuses a broker without a valid FSP number and backdated cover", () => {
    expect(() => createQuote(catalog, { ...request(), broker: { ...broker, fspNumber: "" } }, { ...today, quoteId: "q" })).toThrow(/FSP/);
    expect(() => createQuote(catalog, { ...request(), effectiveDate: "2026-10-01" }, { ...today, quoteId: "q" })).toThrow(/before today/);
  });
});

describe("bindQuote", () => {
  it("issues a policy with term 1, version 1 and a new-business transaction", () => {
    const { quote: bound, policy } = bindQuote(quote(), "example-b-motor", broker, bindDeps);
    expect(bound.status).toBe("bound");
    expect(policy).toMatchObject({
      policyNumber: "POL-000001",
      insurer: "Example Insurer B",
      status: "in_force",
      terms: [{ number: 1, start: "2026-11-01", end: "2027-11-01" }],
      transactions: [
        { id: "txn-1", type: "new_business", effectiveDate: "2026-11-01", premiumDelta: 93_450, processedBy: "brk-1" },
      ],
    });
    expect(policy.terms[0]!.versions[0]!.coverages).toEqual(["comprehensive", "sasria"]);
    expect(versionOn(policy, "2027-05-01")?.number).toBe(1);
    expect(versionOn(policy, "2026-10-31")).toBeUndefined();
    expect(versionOn(policy, "2027-11-01")).toBeUndefined();
    expect(() => bindQuote(bound, "example-a-motor", broker, bindDeps)).toThrow(/already bound/);
  });

  it("only lets the owning broker bind, before expiry", () => {
    expect(() => bindQuote(quote(), "example-b-motor", otherBroker, bindDeps)).toThrow(/owns the quote/);
    expect(() => bindQuote(quote(), "example-b-motor", broker, { ...bindDeps, ...at("2026-11-13T08:00:00Z") })).toThrow(
      /expired on 2026-11-12/,
    );
  });

  it("refuses to bind a cover start date that has passed", () => {
    const late = { ...bindDeps, ...at("2026-11-02T08:00:00Z") };
    expect(() => bindQuote(quote(), "example-b-motor", broker, late)).toThrow(/start date has passed/);
  });
});

describe("referrals", () => {
  const claimsRisk = { ...cleanRisk, driver: { ...cleanRisk.driver, claimsLast3Years: 3 } };

  it("blocks binding until an underwriter with enough authority approves", () => {
    let q = quote(claimsRisk);
    expect(() => bindQuote(q, "example-a-motor", broker, bindDeps)).toThrow(/needs_referral/);

    q = referOption(q, "example-a-motor", today);
    expect(optionStatus(q.options.find((o) => o.productId === "example-a-motor")!)).toBe("referred");
    expect(() => bindQuote(q, "example-a-motor", broker, bindDeps)).toThrow(/referred/);

    q = decideReferral(q, "example-a-motor", junior, "approved", "Claims were all hail damage", today);
    const option = q.options.find((o) => o.productId === "example-a-motor")!;
    expect(option.referral).toMatchObject({ status: "approved", decidedBy: "uw-1", requiredAuthority: 1 });

    const { policy } = bindQuote(q, "example-a-motor", broker, bindDeps);
    expect(policy.insurer).toBe("Example Insurer A");
  });

  it("refuses a decision from an underwriter below the required authority", () => {
    const highValue = { ...cleanRisk, vehicle: { value: 900_000, use: "private" } };
    const q = referOption(quote(highValue), "example-a-motor", today);
    expect(() => decideReferral(q, "example-a-motor", junior, "approved", "ok", today)).toThrow(/needs 2/);
    expect(optionStatus(decideReferral(q, "example-a-motor", senior, "approved", "Tracker fitted", today).options[1]!)).toBe(
      "bindable",
    );
  });

  it("keeps a declined referral unbindable and requires a note", () => {
    const q = referOption(quote(claimsRisk), "example-a-motor", today);
    expect(() => decideReferral(q, "example-a-motor", junior, "declined", " ", today)).toThrow(/needs a note/);
    const declined = decideReferral(q, "example-a-motor", junior, "declined", "Claims pattern", today);
    expect(() => bindQuote(declined, "example-a-motor", broker, bindDeps)).toThrow(/referral_declined/);
    expect(() => decideReferral(declined, "example-a-motor", senior, "approved", "x", today)).toThrow(/no pending referral/);
  });

  it("does not refer an option the rules accepted", () => {
    expect(() => referOption(quote(), "example-b-motor", today)).toThrow(/bindable, not awaiting referral/);
  });
});
