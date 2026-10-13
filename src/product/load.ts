import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProduct, type Product } from "./schema.js";

/** Loads and validates every *.json product file in a directory. */
export function loadProducts(dir: string): Product[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      try {
        return parseProduct(JSON.parse(readFileSync(join(dir, f), "utf8")));
      } catch (err) {
        throw new Error(`Invalid product file ${f}: ${(err as Error).message}`);
      }
    });
}
