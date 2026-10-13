import type { Condition, Product, UnderwritingRule } from "../product/schema.js";
import { readPath } from "../rating/engine.js";

export interface RuleHit {
  ruleId: string;
  outcome: UnderwritingRule["outcome"];
  message: string;
  /** Authority grade needed to clear it; set for refer hits only. */
  authority?: number;
}

export type UnderwritingOutcome = "accept" | "refer" | "decline";

/**
 * Runs a product's underwriting rules against a risk and its quoted premium
 * (monthly cents, VAT included). Warnings never block; any decline wins over
 * any referral.
 */
export function assess(
  product: Product,
  risk: Record<string, unknown>,
  monthlyPremiumCents: number,
): { outcome: UnderwritingOutcome; hits: RuleHit[] } {
  const context = { risk, premium: monthlyPremiumCents / 100 };
  const hits = product.underwriting.rules
    .filter((rule) => matches(rule.when, context))
    .map((rule): RuleHit => ({
      ruleId: rule.id,
      outcome: rule.outcome,
      message: rule.message,
      ...(rule.authority !== undefined && { authority: rule.authority }),
    }));
  const outcome: UnderwritingOutcome = hits.some((h) => h.outcome === "decline")
    ? "decline"
    : hits.some((h) => h.outcome === "refer")
      ? "refer"
      : "accept";
  return { outcome, hits };
}

/** Highest authority grade among the referral hits (0 when nothing refers). */
export function requiredAuthority(hits: RuleHit[]): number {
  return Math.max(0, ...hits.map((h) => h.authority ?? 0));
}

function matches(
  condition: Condition,
  context: { risk: Record<string, unknown>; premium: number },
): boolean {
  if ("all" in condition) return condition.all.every((c) => matches(c, context));
  if ("any" in condition) return condition.any.some((c) => matches(c, context));

  const actual = condition.field === "$premium" ? context.premium : readPath(context.risk, condition.field);
  const expected = condition.value;
  switch (condition.op) {
    case "missing":
      return actual === undefined || actual === null || actual === "";
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && (expected as unknown[]).includes(actual);
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      // A missing or non-numeric value never satisfies a numeric comparison;
      // pair it with a "missing" rule when absence matters.
      if (typeof actual !== "number" || typeof expected !== "number") return false;
      if (condition.op === "lt") return actual < expected;
      if (condition.op === "lte") return actual <= expected;
      if (condition.op === "gt") return actual > expected;
      return actual >= expected;
    }
  }
}
