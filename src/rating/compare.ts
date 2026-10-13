import type { ProductCatalog } from "../product/catalog.js";
import type { Line } from "../product/schema.js";
import { rate, RatingError, type RatingRequest, type RatingResult } from "./engine.js";

export interface InsurerQuote {
  productId: string;
  insurer: string;
  result?: RatingResult;
  /** Why this insurer could not be priced (missing input, no matching rate, ...). */
  error?: string;
}

/**
 * Prices one risk with every insurer offering the line on the date, cheapest first.
 * Insurers that cannot price the risk are listed last with the reason.
 */
export function compareInsurers(
  catalog: ProductCatalog,
  line: Line,
  onDate: string,
  request: RatingRequest,
): InsurerQuote[] {
  const quotes = catalog.forLine(line, onDate).map((product): InsurerQuote => {
    try {
      return { productId: product.id, insurer: product.insurer, result: rate(product, request) };
    } catch (err) {
      if (!(err instanceof RatingError)) throw err;
      return { productId: product.id, insurer: product.insurer, error: err.message };
    }
  });
  return quotes.sort((a, b) => {
    if (a.result && b.result) return a.result.totalPremium - b.result.totalPremium;
    return a.result ? -1 : b.result ? 1 : a.insurer.localeCompare(b.insurer);
  });
}
