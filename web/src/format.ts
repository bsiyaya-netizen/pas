import type { QuoteOption } from "./api";

/**
 * Cents to rand, e.g. 101250 -> "R1 012.50": space between thousands, point for
 * cents. Built by hand because browsers disagree on the en-ZA locale format.
 */
export function formatRand(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${sign}R${whole}.${String(abs % 100).padStart(2, "0")}`;
}

export type OptionStatus =
  | "unpriceable"
  | "declined"
  | "needs_referral"
  | "referred"
  | "referral_declined"
  | "bindable";

/** Same rules as the server's optionStatus; the server re-checks on every action. */
export function optionStatus(option: QuoteOption): OptionStatus {
  if (!option.rating || !option.underwriting) return "unpriceable";
  if (option.underwriting.outcome === "decline") return "declined";
  if (option.underwriting.outcome === "accept") return "bindable";
  switch (option.referral?.status) {
    case undefined:
      return "needs_referral";
    case "pending":
      return "referred";
    case "declined":
      return "referral_declined";
    case "approved":
      return "bindable";
  }
}

export const STATUS_LABEL: Record<OptionStatus, string> = {
  unpriceable: "Cannot price",
  declined: "Declined by rules",
  needs_referral: "Needs referral",
  referred: "With underwriter",
  referral_declined: "Underwriter declined",
  bindable: "Ready to bind",
};
