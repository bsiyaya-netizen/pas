export { LINES, ProductSchema, parseProduct } from "./product/schema.js";
export type { Line, Product } from "./product/schema.js";
export { loadProducts } from "./product/load.js";
export { ProductCatalog } from "./product/catalog.js";
export { rate, RatingError } from "./rating/engine.js";
export type { RatingRequest, RatingResult, CoverageResult, WorksheetLine } from "./rating/engine.js";
export { compareInsurers } from "./rating/compare.js";
export type { InsurerQuote } from "./rating/compare.js";
