import type { Line, Product } from "./schema.js";

/**
 * Holds every version of every product. Old versions are never replaced, so a
 * policy can always be re-rated on the rates it was written on.
 */
export class ProductCatalog {
  private readonly products: Product[] = [];

  constructor(products: Product[] = []) {
    products.forEach((p) => this.add(p));
  }

  add(product: Product): void {
    const clash = this.products.find(
      (p) => p.id === product.id && p.version === product.version,
    );
    if (clash) {
      throw new Error(`Product ${product.id} v${product.version} is already loaded`);
    }
    this.products.push(product);
  }

  /** The version of a product in force on a date (ISO YYYY-MM-DD), or undefined. */
  resolve(productId: string, onDate: string): Product | undefined {
    return latestInForce(this.products.filter((p) => p.id === productId), onDate);
  }

  /** An exact product version, e.g. the one a policy was rated on. */
  get(productId: string, version: number): Product | undefined {
    return this.products.find((p) => p.id === productId && p.version === version);
  }

  /** One product per insurer for a line, each the version in force on the date. */
  forLine(line: Line, onDate: string): Product[] {
    const ids = new Set(this.products.filter((p) => p.line === line).map((p) => p.id));
    return [...ids]
      .map((id) => this.resolve(id, onDate))
      .filter((p): p is Product => p !== undefined);
  }
}

function latestInForce(versions: Product[], onDate: string): Product | undefined {
  return versions
    .filter((p) => p.effectiveFrom <= onDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
}
