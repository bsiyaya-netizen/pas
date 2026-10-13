import { addMonths, daysBetween, isoDate } from "../dates.js";
import type { Broker } from "../parties.js";
import type { ProductCatalog } from "../product/catalog.js";
import type { Product } from "../product/schema.js";
import { rate, RatingError, type RatingResult } from "../rating/engine.js";
import { assess, type RuleHit } from "../underwriting/rules.js";
import type { Clock } from "../quote/quote.js";
import type { CancellationReason, Policy, PolicyTerm, PolicyVersion } from "./policy.js";

/**
 * Mid-term changes (endorsements) and cancellations. Like quoting, these are
 * pure: they take a policy and return a new one, plus what the change costs,
 * so the same functions price a preview and apply the change.
 *
 * Premiums are monthly and assumed paid in advance on the monthly anniversary
 * of the term start. A change part-way through a month carries a one-off
 * pro-rata adjustment for the rest of that month.
 */

export class PolicyChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyChangeError";
  }
}

export interface EndorsementRequest {
  effectiveDate: string;
  risk: Record<string, unknown>;
  coverages: string[];
  description?: string;
}

export interface EndorsementPreview {
  effectiveDate: string;
  /** Monthly premiums in cents before and after the change. */
  premiumBefore: number;
  premiumAfter: number;
  /** One-off amount for the rest of the current month, cents (negative is a refund). */
  proRataAdjustment: number;
  rating: RatingResult;
  warnings: RuleHit[];
}

export interface CancellationRequest {
  effectiveDate: string;
  reason: CancellationReason;
  note?: string;
}

export interface CancellationPreview {
  effectiveDate: string;
  /** Last day of cover. */
  lastDayOfCover: string;
  /** Premium returned for the unused part of the month, cents, if that month was paid. */
  refund: number;
}

interface ChangeDeps extends Clock {
  transactionId: string;
}

/** The product version a policy was rated on; changes use the same rates. */
export function ratedProduct(catalog: ProductCatalog, policy: Policy): Product {
  const { version } = latest(policy);
  const product = catalog.get(version.rating.productId, version.rating.productVersion);
  if (!product) {
    throw new Error(`Product ${version.rating.productId} v${version.rating.productVersion} is not loaded`);
  }
  return product;
}

export function previewEndorsement(
  policy: Policy,
  product: Product,
  request: EndorsementRequest,
  clock: Clock,
): EndorsementPreview {
  const { term, version } = changeableOn(policy, request.effectiveDate, clock);
  if (request.effectiveDate < version.effectiveFrom) {
    throw new PolicyChangeError(
      `A change was already made from ${version.effectiveFrom}; this change must start on or after that date`,
    );
  }

  let rating: RatingResult;
  try {
    rating = rate(product, { coverages: request.coverages, risk: request.risk, commissionRate: version.rating.commissionRate });
  } catch (e) {
    if (e instanceof RatingError) throw new PolicyChangeError(e.message);
    throw e;
  }
  const underwriting = assess(product, request.risk, rating.totalPremium);
  const blocking = underwriting.hits.filter((h) => h.outcome !== "warn");
  if (underwriting.outcome === "decline") {
    throw new PolicyChangeError(`${policy.insurer} will not cover this change: ${blocking.map((h) => h.message).join("; ")}`);
  }
  if (underwriting.outcome === "refer") {
    throw new PolicyChangeError(
      `This change needs ${policy.insurer}'s underwriters to approve it (${blocking.map((h) => h.message).join("; ")}). ` +
        "Ask the insurer directly; referring changes from the portal is not available yet.",
    );
  }

  const premiumBefore = version.rating.totalPremium;
  const premiumAfter = rating.totalPremium;
  return {
    effectiveDate: request.effectiveDate,
    premiumBefore,
    premiumAfter,
    proRataAdjustment: proRata(premiumAfter - premiumBefore, term, request.effectiveDate),
    rating,
    warnings: underwriting.hits,
  };
}

export function endorse(
  policy: Policy,
  product: Product,
  request: EndorsementRequest,
  broker: Broker,
  deps: ChangeDeps,
): { policy: Policy; preview: EndorsementPreview } {
  assertOwner(policy, broker);
  const preview = previewEndorsement(policy, product, request, deps);
  const { term, version } = latest(policy);
  const next: PolicyVersion = {
    number: version.number + 1,
    transactionId: deps.transactionId,
    effectiveFrom: request.effectiveDate,
    risk: request.risk,
    coverages: preview.rating.coverages.map((c) => c.code),
    rating: preview.rating,
  };
  return {
    preview,
    policy: {
      ...policy,
      terms: policy.terms.map((t) => (t === term ? { ...t, versions: [...t.versions, next] } : t)),
      transactions: [
        ...policy.transactions,
        {
          id: deps.transactionId,
          type: "endorsement",
          effectiveDate: request.effectiveDate,
          processedAt: deps.now().toISOString(),
          premiumDelta: preview.premiumAfter - preview.premiumBefore,
          proRataAdjustment: preview.proRataAdjustment,
          description: request.description?.trim() || describeChange(version, next),
          processedBy: broker.id,
        },
      ],
    },
  };
}

export function previewCancellation(policy: Policy, request: { effectiveDate: string }, clock: Clock): CancellationPreview {
  const { term } = changeableOn(policy, request.effectiveDate, clock);
  const lastDay = new Date(`${request.effectiveDate}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return {
    effectiveDate: request.effectiveDate,
    lastDayOfCover: isoDate(lastDay),
    refund: proRata(paidBefore(term, request.effectiveDate).rating.totalPremium, term, request.effectiveDate),
  };
}

export function cancel(
  policy: Policy,
  request: CancellationRequest,
  broker: Broker,
  deps: ChangeDeps,
): { policy: Policy; preview: CancellationPreview } {
  assertOwner(policy, broker);
  const preview = previewCancellation(policy, request, deps);
  const note = request.note?.trim();
  return {
    preview,
    policy: {
      ...policy,
      status: "cancelled",
      cancellation: {
        effectiveDate: request.effectiveDate,
        reason: request.reason,
        ...(note && { note }),
        transactionId: deps.transactionId,
      },
      transactions: [
        ...policy.transactions,
        {
          id: deps.transactionId,
          type: "cancellation",
          effectiveDate: request.effectiveDate,
          processedAt: deps.now().toISOString(),
          premiumDelta: -paidBefore(policy.terms.at(-1)!, request.effectiveDate).rating.totalPremium,
          proRataAdjustment: -preview.refund,
          description: `Cancelled ${REASON_TEXT[request.reason]}${note ? ` (${note})` : ""}`,
          processedBy: broker.id,
        },
      ],
    },
  };
}

/**
 * The version whose premium was paid for the month a cancellation falls in:
 * the one in force the day before, or the first if cover has not started.
 */
function paidBefore(term: PolicyTerm, date: string): PolicyVersion {
  return term.versions.filter((v) => v.effectiveFrom < date).at(-1) ?? term.versions[0]!;
}

export const REASON_TEXT: Record<CancellationReason, string> = {
  client_request: "at the client's request",
  vehicle_sold: "because the vehicle was sold",
  replaced_elsewhere: "because another policy replaced it",
  other: "for another reason",
};

/** The monthly period, counted from the term start, that contains a date. */
export function billingPeriod(term: PolicyTerm, date: string): { start: string; end: string } {
  let k = 0;
  while (addMonths(term.start, k + 1) <= date) k++;
  return { start: addMonths(term.start, k), end: addMonths(term.start, k + 1) };
}

/** A monthly amount scaled to the days left in the current month, rounded to the cent. */
function proRata(monthlyCents: number, term: PolicyTerm, from: string): number {
  const period = billingPeriod(term, from);
  const share = daysBetween(from, period.end) / daysBetween(period.start, period.end);
  return Math.round(monthlyCents * share);
}

function latest(policy: Policy): { term: PolicyTerm; version: PolicyVersion } {
  const term = policy.terms.at(-1)!;
  return { term, version: term.versions.at(-1)! };
}

/** Checks a change can take effect on a date and returns the term and latest version. */
function changeableOn(policy: Policy, date: string, clock: Clock): { term: PolicyTerm; version: PolicyVersion } {
  if (policy.status !== "in_force") {
    throw new PolicyChangeError(`Policy ${policy.policyNumber} is cancelled and cannot be changed`);
  }
  if (date < isoDate(clock.now())) {
    throw new PolicyChangeError("Changes cannot be backdated; use today's date or a later one");
  }
  const { term, version } = latest(policy);
  if (date < term.start || date >= term.end) {
    throw new PolicyChangeError(`The date must fall within the current period of insurance, ${term.start} to ${term.end}`);
  }
  return { term, version };
}

function assertOwner(policy: Policy, broker: Broker): void {
  if (policy.brokerId !== broker.id) throw new PolicyChangeError("Only the policy's broker can change it");
}

function describeChange(before: PolicyVersion, after: PolicyVersion): string {
  const added = after.coverages.filter((c) => !before.coverages.includes(c));
  const removed = before.coverages.filter((c) => !after.coverages.includes(c));
  const name = (code: string) =>
    [...before.rating.coverages, ...after.rating.coverages].find((c) => c.code === code)?.name ?? code;
  const changedRisk = changedPaths(before.risk, after.risk);
  const parts = [
    ...added.map((c) => `added ${name(c)}`),
    ...removed.map((c) => `removed ${name(c)}`),
    ...(changedRisk.length ? [`changed ${changedRisk.join(", ")}`] : []),
  ];
  return parts.length ? capitalise(parts.join("; ")) : "No change to cover or risk details";
}

function changedPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
