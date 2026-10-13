import type { Operand, Product, RateTable, Step } from "../product/schema.js";

/**
 * The rating engine is a pure function: product + risk data in, premium and a
 * step-by-step worksheet out. It writes nothing, so the same call prices quotes,
 * endorsements and renewals, and can be replayed for audit.
 *
 * Amounts in the result are integer cents. Each coverage is rounded to the cent
 * once, at the end of its steps.
 */

export interface RatingRequest {
  /** Requested optional coverage codes; mandatory coverages are always added. */
  coverages: string[];
  /** Line-specific risk data, read by dotted input paths (e.g. "vehicle.value"). */
  risk: Record<string, unknown>;
  /** Broker commission as a fraction; defaults to the product's regulatory cap. */
  commissionRate?: number;
}

export interface WorksheetLine {
  label: string;
  op: Step["op"];
  operand: number;
  result: number;
}

export interface CoverageResult {
  code: string;
  name: string;
  /** Monthly premium in cents, VAT included. */
  premium: number;
  worksheet: WorksheetLine[];
}

export interface RatingResult {
  productId: string;
  productVersion: number;
  insurer: string;
  coverages: CoverageResult[];
  /** Cents added to reach the product's minimum premium (0 when not needed). */
  minimumPremiumAdjustment: number;
  /** Monthly totals in cents. */
  totalPremium: number;
  vat: number;
  totalExcludingVat: number;
  commissionRate: number;
  commission: number;
}

export class RatingError extends Error {
  constructor(
    message: string,
    readonly detail: { coverage?: string; step?: string; path?: string } = {},
  ) {
    super(message);
    this.name = "RatingError";
  }
}

export function rate(product: Product, request: RatingRequest): RatingResult {
  const known = new Set(product.coverages.map((c) => c.code));
  for (const code of request.coverages) {
    if (!known.has(code)) {
      throw new RatingError(`${product.insurer} does not offer the "${code}" cover`, {
        coverage: code,
      });
    }
  }

  const commissionRate = request.commissionRate ?? product.commission.maxRate;
  if (commissionRate < 0 || commissionRate > product.commission.maxRate) {
    throw new RatingError(
      `Commission rate ${commissionRate} exceeds the cap of ${product.commission.maxRate} for ${product.line}`,
    );
  }

  const requested = new Set(request.coverages);
  const coverages = product.coverages
    .filter((c) => c.mandatory || requested.has(c.code))
    .map((coverage): CoverageResult => {
      const worksheet: WorksheetLine[] = [];
      let value = 0;
      for (const step of coverage.steps) {
        const ctx = { coverage: coverage.code, step: step.label };
        const operand = resolveOperand(product, step.operand, request.risk, ctx);
        value = apply(step.op, value, operand, ctx);
        worksheet.push({ label: step.label, op: step.op, operand, result: value });
      }
      return { code: coverage.code, name: coverage.name, premium: toCents(value), worksheet };
    });

  const subtotal = sum(coverages.map((c) => c.premium));
  const minimum = toCents(product.minimumPremium);
  const minimumPremiumAdjustment = Math.max(0, minimum - subtotal);
  const charged = subtotal + minimumPremiumAdjustment;

  const { vatRate, premiumsIncludeVat } = product.tax;
  const totalPremium = premiumsIncludeVat ? charged : roundCents(charged * (1 + vatRate));
  const totalExcludingVat = excludeVat(totalPremium, vatRate);

  const excluded = new Set(product.commission.excludedCoverages);
  const commissionable =
    sum(coverages.filter((c) => !excluded.has(c.code)).map((c) => c.premium)) +
    minimumPremiumAdjustment;
  const commissionableExcludingVat = premiumsIncludeVat
    ? excludeVat(commissionable, vatRate)
    : commissionable;
  const commission = roundCents(commissionableExcludingVat * commissionRate);

  return {
    productId: product.id,
    productVersion: product.version,
    insurer: product.insurer,
    coverages,
    minimumPremiumAdjustment,
    totalPremium,
    vat: totalPremium - totalExcludingVat,
    totalExcludingVat,
    commissionRate,
    commission,
  };
}

function resolveOperand(
  product: Product,
  operand: Operand,
  risk: Record<string, unknown>,
  ctx: { coverage: string; step: string },
): number {
  if ("const" in operand) return operand.const;
  if ("input" in operand) {
    const value = readPath(risk, operand.input);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RatingError(`Input "${operand.input}" must be a number`, {
        ...ctx,
        path: operand.input,
      });
    }
    return value;
  }
  const table = product.tables[operand.table];
  if (!table) {
    throw new RatingError(`Unknown table "${operand.table}"`, ctx);
  }
  const lookup: Record<string, unknown> = {};
  for (const [dimension, path] of Object.entries(operand.keys)) {
    const value = readPath(risk, path);
    if (value === undefined) {
      throw new RatingError(`Missing input "${path}"`, { ...ctx, path });
    }
    lookup[dimension] = value;
  }
  return lookupTable(operand.table, table, lookup, ctx);
}

export function lookupTable(
  name: string,
  table: RateTable,
  lookup: Record<string, unknown>,
  ctx: { coverage?: string; step?: string } = {},
): number {
  const row = table.rows.find((r) =>
    table.dimensions.every((dim) => {
      const want = r.match[dim.name];
      const have = lookup[dim.name];
      if (want === undefined) return true; // wildcard
      if (dim.kind === "exact") return want === have;
      if (typeof have !== "number" || typeof want !== "object") return false;
      return (want.min === undefined || have >= want.min) && (want.max === undefined || have < want.max);
    }),
  );
  if (!row) {
    throw new RatingError(`No row in table "${name}" matches ${JSON.stringify(lookup)}`, ctx);
  }
  return row.value;
}

function apply(
  op: Step["op"],
  value: number,
  operand: number,
  ctx: { coverage: string; step: string },
): number {
  switch (op) {
    case "set":
      return operand;
    case "add":
      return value + operand;
    case "subtract":
      return value - operand;
    case "multiply":
      return value * operand;
    case "divide":
      if (operand === 0) throw new RatingError("Division by zero", ctx);
      return value / operand;
    case "atLeast":
      return Math.max(value, operand);
    case "atMost":
      return Math.min(value, operand);
  }
}

export function readPath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function excludeVat(cents: number, vatRate: number): number {
  return roundCents(cents / (1 + vatRate));
}

function toCents(rand: number): number {
  return roundCents(rand * 100);
}

/**
 * Rounds half up to a whole cent. Trimming to 12 significant digits first stops
 * binary float noise (102 450 x 1.15 = 117 817.49999...) from rounding the wrong way.
 */
function roundCents(cents: number): number {
  return Math.round(Number(cents.toPrecision(12)));
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
