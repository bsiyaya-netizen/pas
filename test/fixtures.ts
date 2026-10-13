import { fileURLToPath } from "node:url";
import { ProductCatalog } from "../src/product/catalog.js";
import { loadProducts } from "../src/product/load.js";

export const products = loadProducts(fileURLToPath(new URL("../products", import.meta.url)));
export const catalog = new ProductCatalog(products);
export const productA = products.find((p) => p.id === "example-a-motor")!;
export const productB = products.find((p) => p.id === "example-b-motor")!;

/** Gauteng, private use, R300 000 car, 35-year-old driver with no claims, R5 000 excess. */
export const cleanRisk = {
  territory: "gauteng",
  excessOption: 5000,
  vehicle: { value: 300_000, use: "private" },
  driver: { age: 35, claimsLast3Years: 0, licenceDate: "2010-03-01" },
};
