import { addDays, addMonths } from "../dates.js";
import type { Client } from "../parties.js";
import { versionOn, type Policy, type PolicyTransaction } from "../policy/policy.js";
import type { Quote } from "../quote/quote.js";

/**
 * A broker's book at a glance, computed from their policies and quotes. Pure,
 * like the rest of the domain code, so every number is unit-tested and the
 * same figures feed the dashboard and the CSV reports.
 *
 * Amounts are monthly cents, VAT included unless named otherwise.
 */

export interface InsurerSummary {
  insurer: string;
  policies: number;
  premium: number;
  commission: number;
}

export interface MonthActivity {
  /** YYYY-MM, by the date the transaction was processed. */
  month: string;
  newPolicies: number;
  newPremium: number;
  endorsements: number;
  cancellations: number;
  /** Net change in monthly premium from all transactions that month. */
  premiumChange: number;
}

export interface Dashboard {
  asOf: string;
  inForce: { policies: number; premium: number; commission: number };
  /** Bound but cover has not started yet. */
  startingSoon: number;
  byInsurer: InsurerSummary[];
  quotes: {
    /** Quotes created in the last 30 days and how many of those were bound. */
    last30Days: number;
    boundLast30Days: number;
    conversionRate: number | null;
    /** Open quotes that expire within 7 days. */
    expiringSoon: { id: string; clientName: string; expiresOn: string }[];
    awaitingUnderwriter: number;
  };
  /** Terms ending within 60 days that have not been cancelled. */
  renewalsDue: { policyNumber: string; clientName: string; insurer: string; endsOn: string; premium: number }[];
  months: MonthActivity[];
  recent: (PolicyTransaction & { policyNumber: string; clientName: string })[];
}

export function brokerDashboard(policies: Policy[], quotes: Quote[], clients: Client[], asOf: string): Dashboard {
  const clientName = nameLookup(clients);
  const inForce = policies.flatMap((p) => {
    const version = versionOn(p, asOf);
    return version ? [{ policy: p, version }] : [];
  });

  const byInsurer = new Map<string, InsurerSummary>();
  for (const { policy, version } of inForce) {
    const row = byInsurer.get(policy.insurer) ?? { insurer: policy.insurer, policies: 0, premium: 0, commission: 0 };
    row.policies += 1;
    row.premium += version.rating.totalPremium;
    row.commission += version.rating.commission;
    byInsurer.set(policy.insurer, row);
  }

  const since = addDays(asOf, -30);
  const recentQuotes = quotes.filter((q) => q.createdAt.slice(0, 10) > since);
  const bound = recentQuotes.filter((q) => q.status === "bound").length;
  const soon = addDays(asOf, 7);

  const renewalHorizon = addDays(asOf, 60);
  const renewalsDue = policies.flatMap((p) => {
    const term = p.terms.at(-1)!;
    const lastDay = addDays(term.end, -1);
    if (p.status !== "in_force" || lastDay < asOf || term.end > renewalHorizon) return [];
    return [
      {
        policyNumber: p.policyNumber,
        clientName: clientName(p.clientId),
        insurer: p.insurer,
        endsOn: lastDay,
        premium: term.versions.at(-1)!.rating.totalPremium,
      },
    ];
  });

  const transactions = policies.flatMap((p) =>
    p.transactions.map((t) => ({ ...t, policyNumber: p.policyNumber, clientName: clientName(p.clientId) })),
  );

  return {
    asOf,
    inForce: {
      policies: inForce.length,
      premium: sum(inForce.map((x) => x.version.rating.totalPremium)),
      commission: sum(inForce.map((x) => x.version.rating.commission)),
    },
    startingSoon: policies.filter((p) => p.status === "in_force" && p.terms[0]!.start > asOf).length,
    byInsurer: [...byInsurer.values()].sort((a, b) => b.premium - a.premium || a.insurer.localeCompare(b.insurer)),
    quotes: {
      last30Days: recentQuotes.length,
      boundLast30Days: bound,
      conversionRate: recentQuotes.length ? bound / recentQuotes.length : null,
      expiringSoon: quotes
        .filter((q) => q.status === "open" && q.expiresOn >= asOf && q.expiresOn <= soon)
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
        .map((q) => ({ id: q.id, clientName: clientName(q.clientId), expiresOn: q.expiresOn })),
      awaitingUnderwriter: quotes.filter(
        (q) => q.status === "open" && q.expiresOn >= asOf && q.options.some((o) => o.referral?.status === "pending"),
      ).length,
    },
    renewalsDue: renewalsDue.sort((a, b) => a.endsOn.localeCompare(b.endsOn)),
    months: monthlyActivity(transactions, asOf, 12),
    recent: transactions.sort((a, b) => b.processedAt.localeCompare(a.processedAt)).slice(0, 10),
  };
}

/** The last `count` calendar months up to and including the one containing `asOf`, oldest first. */
export function monthlyActivity(transactions: PolicyTransaction[], asOf: string, count: number): MonthActivity[] {
  const first = `${asOf.slice(0, 7)}-01`;
  const months = Array.from({ length: count }, (_, i) => addMonths(first, i - count + 1).slice(0, 7));
  const byMonth = new Map(
    months.map((month): [string, MonthActivity] => [
      month,
      { month, newPolicies: 0, newPremium: 0, endorsements: 0, cancellations: 0, premiumChange: 0 },
    ]),
  );
  for (const t of transactions) {
    const row = byMonth.get(t.processedAt.slice(0, 7));
    if (!row) continue;
    row.premiumChange += t.premiumDelta;
    if (t.type === "new_business") {
      row.newPolicies += 1;
      row.newPremium += t.premiumDelta;
    } else if (t.type === "endorsement") {
      row.endorsements += 1;
    } else {
      row.cancellations += 1;
    }
  }
  return [...byMonth.values()];
}

export function nameLookup(clients: Client[]): (id: string) => string {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  return (id) => names.get(id) ?? "Unknown client";
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
