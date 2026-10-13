import type { Line } from "../product/schema.js";
import type { RatingResult } from "../rating/engine.js";

export type TransactionType = "new_business";

/** Every change to a policy is one dated, immutable transaction that creates one version. */
export interface PolicyTransaction {
  id: string;
  type: TransactionType;
  /** When the change applies to cover. */
  effectiveDate: string;
  /** When it was entered (ISO timestamp). */
  processedAt: string;
  /** Change in monthly premium, cents. */
  premiumDelta: number;
  processedBy: string;
}

/** A full snapshot of the cover from its effective date. */
export interface PolicyVersion {
  number: number;
  transactionId: string;
  effectiveFrom: string;
  risk: Record<string, unknown>;
  coverages: string[];
  rating: RatingResult;
}

export interface PolicyTerm {
  number: number;
  start: string;
  /** Exclusive: cover ends at the start of this day. */
  end: string;
  versions: PolicyVersion[];
}

export interface Policy {
  policyNumber: string;
  quoteId: string;
  productId: string;
  insurer: string;
  line: Line;
  brokerId: string;
  clientId: string;
  status: "in_force";
  terms: PolicyTerm[];
  transactions: PolicyTransaction[];
}

/** The version in force on a date, or undefined if the policy gave no cover then. */
export function versionOn(policy: Policy, date: string): PolicyVersion | undefined {
  const term = policy.terms.find((t) => t.start <= date && date < t.end);
  return term?.versions.filter((v) => v.effectiveFrom <= date).at(-1);
}
