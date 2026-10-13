import { z } from "zod";

/**
 * A product is one insurer's version of one line of business, valid from a date.
 * Everything the rating engine needs (tables, steps, tax and commission settings)
 * lives here as data, so a new insurer or a rate change is a new product file,
 * not new code.
 */

export const LINES = ["motor", "home", "commercial_property"] as const;
export type Line = (typeof LINES)[number];

/** Dotted path into the rating input, e.g. "vehicle.value" or "driver.age". */
const InputPath = z.string().min(1);

const ExactDimension = z.object({
  name: z.string().min(1),
  kind: z.literal("exact"),
});

/** Range dimension: a row matches when min <= value < max (either bound optional). */
const RangeDimension = z.object({
  name: z.string().min(1),
  kind: z.literal("range"),
});

const Dimension = z.discriminatedUnion("kind", [ExactDimension, RangeDimension]);

const RangeMatch = z
  .object({ min: z.number().optional(), max: z.number().optional() })
  .strict();

const RateTable = z.object({
  description: z.string().optional(),
  dimensions: z.array(Dimension).min(1),
  rows: z
    .array(
      z.object({
        match: z.record(z.union([z.string(), z.number(), z.boolean(), RangeMatch])),
        value: z.number(),
      }),
    )
    .min(1),
});

/** Where a step gets its number from. */
const Operand = z.union([
  z.object({ const: z.number() }).strict(),
  z.object({ input: InputPath }).strict(),
  z
    .object({
      table: z.string().min(1),
      /** Table dimension name -> input path supplying the lookup value. */
      keys: z.record(InputPath),
    })
    .strict(),
]);

const Step = z.object({
  /** Shown on the rating worksheet, e.g. "Driver age factor". */
  label: z.string().min(1),
  op: z.enum(["set", "add", "subtract", "multiply", "divide", "atLeast", "atMost"]),
  operand: Operand,
});

const Coverage = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  /** Included on every quote, without being requested. */
  mandatory: z.boolean().default(false),
  /** Ordered calculation; result is the monthly premium in rand, VAT included. */
  steps: z.array(Step).min(1),
});

/**
 * One test inside an underwriting rule. `field` is a dotted path into the risk
 * data, or "$premium" for the quoted monthly premium in rand (VAT included).
 */
const Comparison = z
  .object({
    field: z.string().min(1),
    op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "missing"]),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  })
  .strict()
  .refine((c) => c.op === "missing" || c.value !== undefined, {
    message: "value is required unless op is \"missing\"",
  })
  .refine((c) => (c.op === "in") === Array.isArray(c.value) || c.op === "missing", {
    message: "op \"in\" takes a list; other ops take a single value",
  });

export type Condition =
  | z.infer<typeof Comparison>
  | { all: Condition[] }
  | { any: Condition[] };

const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    Comparison,
    z.object({ all: z.array(Condition).min(1) }).strict(),
    z.object({ any: z.array(Condition).min(1) }).strict(),
  ]),
);

const UnderwritingRule = z
  .object({
    id: z.string().min(1),
    /** Shown to the broker and underwriter when the rule fires. */
    message: z.string().min(1),
    outcome: z.enum(["decline", "refer", "warn"]),
    /** Authority grade an underwriter needs to clear a referral (1 = junior). */
    authority: z.number().int().positive().optional(),
    when: Condition,
  })
  .refine((r) => (r.outcome === "refer") === (r.authority !== undefined), {
    message: "authority is required for refer rules and only allowed on them",
  });

export const ProductSchema = z
  .object({
    id: z.string().min(1),
    insurer: z.string().min(1),
    line: z.enum(LINES),
    name: z.string().min(1),
    version: z.number().int().positive(),
    /** ISO date (YYYY-MM-DD) from which this version applies to new and renewing business. */
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.literal("ZAR"),
    premiumFrequency: z.literal("monthly"),
    tax: z.object({
      vatRate: z.number().min(0).max(1),
      /** South African short-term premiums are normally quoted VAT-inclusive. */
      premiumsIncludeVat: z.boolean(),
    }),
    commission: z.object({
      /** Regulatory cap for this line, as a fraction of premium excluding VAT. */
      maxRate: z.number().min(0).max(1),
      /** Coverage codes that carry no broker commission (e.g. SASRIA). */
      excludedCoverages: z.array(z.string()).default([]),
    }),
    /** Monthly minimum for the whole policy in rand, VAT included. */
    minimumPremium: z.number().min(0).default(0),
    tables: z.record(RateTable),
    coverages: z.array(Coverage).min(1),
    underwriting: z.object({ rules: z.array(UnderwritingRule) }).default({ rules: [] }),
  })
  .superRefine((product, ctx) => {
    const codes = new Set<string>();
    product.coverages.forEach((coverage, ci) => {
      if (codes.has(coverage.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coverages", ci, "code"],
          message: `Duplicate coverage code "${coverage.code}"`,
        });
      }
      codes.add(coverage.code);
      coverage.steps.forEach((step, si) => {
        if (!("table" in step.operand)) return;
        const table = product.tables[step.operand.table];
        const path = ["coverages", ci, "steps", si, "operand"];
        if (!table) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Unknown table "${step.operand.table}"`,
          });
          return;
        }
        for (const dim of table.dimensions) {
          if (!(dim.name in step.operand.keys)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: `Missing key for dimension "${dim.name}" of table "${step.operand.table}"`,
            });
          }
        }
      });
    });
    const ruleIds = new Set<string>();
    product.underwriting.rules.forEach((rule, ri) => {
      if (ruleIds.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["underwriting", "rules", ri, "id"],
          message: `Duplicate rule id "${rule.id}"`,
        });
      }
      ruleIds.add(rule.id);
    });
    for (const code of product.commission.excludedCoverages) {
      if (!codes.has(code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commission", "excludedCoverages"],
          message: `Unknown coverage "${code}"`,
        });
      }
    }
  });

export type Product = z.infer<typeof ProductSchema>;
export type RateTable = z.infer<typeof RateTable>;
export type Step = z.infer<typeof Step>;
export type Operand = z.infer<typeof Operand>;
export type UnderwritingRule = z.infer<typeof UnderwritingRule>;

/** Validates product data, throwing one readable line per problem. */
export function parseProduct(data: unknown): Product {
  const parsed = ProductSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid product:\n${lines.join("\n")}`);
}
