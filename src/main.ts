import { join } from "node:path";
import pg from "pg";
import { buildApp } from "./api/app.js";
import { oidcAuthenticator } from "./api/auth.js";
import { fromPool } from "./db/database.js";
import { migrate } from "./db/migrate.js";
import { ProductCatalog } from "./product/catalog.js";
import { loadProducts } from "./product/load.js";
import { QuoteService } from "./service/quote-service.js";

/** Starts the API. Run from the repository root after `npm run build`. */

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Set the ${name} environment variable`);
  return value;
}

const root = process.cwd();
const db = fromPool(new pg.Pool({ connectionString: env("DATABASE_URL") }));
await migrate(db, join(root, "db/migrations"));

const catalog = new ProductCatalog(loadProducts(env("PRODUCTS_DIR", join(root, "products"))));
const app = buildApp({
  service: new QuoteService(db, catalog, { now: () => new Date() }),
  catalog,
  auth: oidcAuthenticator(env("AUTH_ISSUER"), env("AUTH_AUDIENCE"), env("AUTH_JWKS_URL")),
  logger: true,
});

await app.listen({ host: "0.0.0.0", port: Number(env("PORT", "3000")) });
