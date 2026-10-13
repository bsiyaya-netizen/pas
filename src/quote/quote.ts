import { addDays, addYears, isoDate } from "../dates.js";
import { isValidFspNumber, type Broker, type Client, type Underwriter } from "../parties.js";
import type { Policy } from "../policy/policy.js";
import type { ProductCatalog } from "../product/catalog.js";
import type { Line } from "../product/schema.js";
import { compareInsurers } from "../rating/compare.js";
import type { RatingResult } from "../rating/engine.js";
import { assess, requiredAuthority, type RuleHit } from "../underwriting/rules.js";

/**
 * Quote to bind, as pure functions: each step takes a quote and returns a new
 * one, so persistence can be added later without touching the rules here.
 */

export const QUOTE_VALID_DAYS = 30;

export interface Referral {
  status: "pending" | "approved" | "declined";
  requiredAuthority: number;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export interface QuoteOption {
  productId: string;
  productVersion?: number;
  insurer: string;
  rating?: RatingResult;
  /** Set when the insurer could not price the risk. */
  error?: string;
  underwriting?: { outcome: "accept" | "refer" | "decline"; hits: RuleHit[] };
  referral?: Referral;
}

export type OptionStatus =
  | "unpriceable"
  | "declined"
  | "needs_referral"
  | "referred"
  | "referral_declined"
  | "bindable";

export interface Quote {
  id: string;
  brokerId: string;
  clientId: string;
  line: Line;
  /** Requested cover start date. */
  effectiveDate: string;
  risk: Record<string, unknown>;
  coverages: string[];
  createdAt: string;
  /** Last day the quote can be bound. */
  expiresOn: string;
  status: "open" | "bound";
  boundProductId?: string;
  options: QuoteOption[];
}

export interface Clock {
  now: () => Date;
}

export class QuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteError";
  }
}

export interface NewQuote {
  broker: Broker;
  client: Client;
  line: Line;
  effectiveDate: string;
  risk: Record<string, unknown>;
  coverages: string[];
}

/** Prices the risk with every insurer for the line and runs each insurer's underwriting rules. */
export function createQuote(
  catalog: ProductCatalog,
  input: NewQuote,
  deps: Clock & { quoteId: string },
): Quote {
  if (!isValidFspNumber(input.broker.fspNumber)) {
    throw new QuoteError(`Broker ${input.broker.name} has no valid FSP number`);
  }
  const now = deps.now();
  const today = isoDate(now);
  if (input.effectiveDate < today) {
    throw new QuoteError("New business cannot start before today");
  }

  const options = compareInsurers(catalog, input.line, input.effectiveDate, {
    coverages: input.coverages,
    risk: input.risk,
  }).map((q): QuoteOption => {
    if (!q.result) return { productId: q.productId, insurer: q.insurer, error: q.error };
    const product = catalog.resolve(q.productId, input.effectiveDate)!;
    return {
      productId: q.productId,
      productVersion: q.result.productVersion,
      insurer: q.insurer,
      rating: q.result,
      underwriting: assess(product, input.risk, q.result.totalPremium),
    };
  });
  if (options.length === 0) {
    throw new QuoteError(`No insurer offers ${input.line} cover on ${input.effectiveDate}`);
  }

  return {
    id: deps.quoteId,
    brokerId: input.broker.id,
    clientId: input.client.id,
    line: input.line,
    effectiveDate: input.effectiveDate,
    risk: input.risk,
    coverages: input.coverages,
    createdAt: now.toISOString(),
    expiresOn: addDays(today, QUOTE_VALID_DAYS),
    status: "open",
    options,
  };
}

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

/** Sends an option the insurer's rules referred to its underwriters. */
export function referOption(quote: Quote, productId: string, deps: Clock): Quote {
  assertOpen(quote, deps);
  const option = findOption(quote, productId);
  if (optionStatus(option) !== "needs_referral") {
    throw new QuoteError(`${option.insurer} option is ${optionStatus(option)}, not awaiting referral`);
  }
  return withOption(quote, productId, {
    ...option,
    referral: {
      status: "pending",
      requiredAuthority: requiredAuthority(option.underwriting!.hits),
      requestedAt: deps.now().toISOString(),
    },
  });
}

/** An insurer underwriter approves or declines a referred option. */
export function decideReferral(
  quote: Quote,
  productId: string,
  underwriter: Underwriter,
  decision: "approved" | "declined",
  note: string,
  deps: Clock,
): Quote {
  assertOpen(quote, deps);
  const option = findOption(quote, productId);
  const referral = option.referral;
  if (!referral || referral.status !== "pending") {
    throw new QuoteError(`${option.insurer} option has no pending referral`);
  }
  if (underwriter.authority < referral.requiredAuthority) {
    throw new QuoteError(
      `${underwriter.name} has authority ${underwriter.authority}; this referral needs ${referral.requiredAuthority}`,
    );
  }
  if (!note.trim()) throw new QuoteError("A decision needs a note");
  return withOption(quote, productId, {
    ...option,
    referral: {
      ...referral,
      status: decision,
      decidedAt: deps.now().toISOString(),
      decidedBy: underwriter.id,
      note,
    },
  });
}

/**
 * Binds one option: the quote closes and a policy is issued with term 1,
 * version 1 and a new-business transaction, all from the quoted snapshot.
 */
export function bindQuote(
  quote: Quote,
  productId: string,
  broker: Broker,
  deps: Clock & { policyNumber: string; transactionId: string },
): { quote: Quote; policy: Policy } {
  assertOpen(quote, deps);
  if (broker.id !== quote.brokerId) {
    throw new QuoteError("Only the broker who owns the quote can bind it");
  }
  const now = deps.now();
  if (quote.effectiveDate < isoDate(now)) {
    throw new QuoteError("Cover start date has passed; requote with a new date");
  }
  const option = findOption(quote, productId);
  const status = optionStatus(option);
  if (status !== "bindable") {
    throw new QuoteError(`${option.insurer} option is ${status} and cannot be bound`);
  }
  const rating = option.rating!;

  const policy: Policy = {
    policyNumber: deps.policyNumber,
    quoteId: quote.id,
    productId,
    insurer: option.insurer,
    line: quote.line,
    brokerId: quote.brokerId,
    clientId: quote.clientId,
    status: "in_force",
    terms: [
      {
        number: 1,
        start: quote.effectiveDate,
        end: addYears(quote.effectiveDate, 1),
        versions: [
          {
            number: 1,
            transactionId: deps.transactionId,
            effectiveFrom: quote.effectiveDate,
            risk: quote.risk,
            coverages: rating.coverages.map((c) => c.code),
            rating,
          },
        ],
      },
    ],
    transactions: [
      {
        id: deps.transactionId,
        type: "new_business",
        effectiveDate: quote.effectiveDate,
        processedAt: now.toISOString(),
        premiumDelta: rating.totalPremium,
        processedBy: broker.id,
      },
    ],
  };
  return { quote: { ...quote, status: "bound", boundProductId: productId }, policy };
}

function assertOpen(quote: Quote, deps: Clock): void {
  if (quote.status !== "open") throw new QuoteError(`Quote ${quote.id} is already ${quote.status}`);
  if (isoDate(deps.now()) > quote.expiresOn) {
    throw new QuoteError(`Quote ${quote.id} expired on ${quote.expiresOn}`);
  }
}

function findOption(quote: Quote, productId: string): QuoteOption {
  const option = quote.options.find((o) => o.productId === productId);
  if (!option) throw new QuoteError(`Quote ${quote.id} has no option from ${productId}`);
  return option;
}

function withOption(quote: Quote, productId: string, option: QuoteOption): Quote {
  return { ...quote, options: quote.options.map((o) => (o.productId === productId ? option : o)) };
}
