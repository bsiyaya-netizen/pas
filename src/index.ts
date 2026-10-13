export { LINES, ProductSchema, parseProduct } from "./product/schema.js";
export type { Line, Product } from "./product/schema.js";
export { loadProducts } from "./product/load.js";
export { ProductCatalog } from "./product/catalog.js";
export { rate, RatingError } from "./rating/engine.js";
export type { RatingRequest, RatingResult, CoverageResult, WorksheetLine } from "./rating/engine.js";
export { compareInsurers } from "./rating/compare.js";
export type { InsurerQuote } from "./rating/compare.js";
export { assess, requiredAuthority } from "./underwriting/rules.js";
export type { RuleHit, UnderwritingOutcome } from "./underwriting/rules.js";
export {
  QUOTE_VALID_DAYS,
  QuoteError,
  bindQuote,
  createQuote,
  decideReferral,
  optionStatus,
  referOption,
} from "./quote/quote.js";
export type { NewQuote, OptionStatus, Quote, QuoteOption, Referral } from "./quote/quote.js";
export { versionOn } from "./policy/policy.js";
export type { Policy, PolicyTerm, PolicyTransaction, PolicyVersion } from "./policy/policy.js";
export { isValidFspNumber } from "./parties.js";
export type { Broker, Client, Underwriter } from "./parties.js";
export { fromPool } from "./db/database.js";
export type { Database, Queryable } from "./db/database.js";
export { migrate } from "./db/migrate.js";
export { ConflictError, NotFoundError, QuoteService } from "./service/quote-service.js";
export { buildApp } from "./api/app.js";
export type { AppDeps } from "./api/app.js";
export { AuthError, jwtAuthenticator, oidcAuthenticator } from "./api/auth.js";
export type { Actor, Authenticator } from "./api/auth.js";
