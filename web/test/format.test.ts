import { describe, expect, it } from "vitest";
import type { QuoteOption } from "../src/api";
import { formatDate, formatRand, optionStatus } from "../src/format";

const priced: QuoteOption = {
  productId: "p",
  insurer: "I",
  rating: { coverages: [], totalPremium: 101_250, vat: 0, commission: 0, minimumPremiumAdjustment: 0 },
  underwriting: { outcome: "refer", hits: [] },
};

describe("formatRand", () => {
  it("formats cents as South African rand", () => {
    expect(formatRand(101_250)).toBe("R1\u00a0012.50");
    expect(formatRand(1_234_567_801)).toBe("R12\u00a0345\u00a0678.01");
    expect(formatRand(5)).toBe("R0.05");
    expect(formatRand(-8_500)).toBe("-R85.00");
  });
});

describe("formatDate", () => {
  it("writes ISO dates as day, month and year", () => {
    expect(formatDate("2026-11-01")).toBe("1 Nov 2026");
    expect(formatDate("2027-11-01", -1)).toBe("31 Oct 2027");
  });
});

describe("optionStatus", () => {
  it("follows the referral through to bindable", () => {
    expect(optionStatus({ productId: "p", insurer: "I", error: "x" })).toBe("unpriceable");
    expect(optionStatus(priced)).toBe("needs_referral");
    expect(optionStatus({ ...priced, referral: { status: "pending", requiredAuthority: 1 } })).toBe("referred");
    expect(optionStatus({ ...priced, referral: { status: "declined", requiredAuthority: 1 } })).toBe("referral_declined");
    expect(optionStatus({ ...priced, referral: { status: "approved", requiredAuthority: 1 } })).toBe("bindable");
    expect(optionStatus({ ...priced, underwriting: { outcome: "decline", hits: [] } })).toBe("declined");
  });
});
