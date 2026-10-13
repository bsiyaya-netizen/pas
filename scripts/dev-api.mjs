// Local development server: the real API on an in-memory Postgres (PGlite),
// seeded with one broker, one underwriter per example insurer, and sign-in
// tokens signed with a local secret. Never use this in production.
//
//   npm run build && npm run dev:api
import { PGlite } from "@electric-sql/pglite";
import { SignJWT } from "jose";
import { buildApp, jwtAuthenticator, loadProducts, migrate, ProductCatalog, QuoteService } from "../dist/src/index.js";

const pg = new PGlite();
const db = {
  query: async (sql, params) => ({ rows: (await pg.query(sql, params)).rows }),
  transaction: (fn) => pg.transaction((tx) => fn({ query: async (sql, params) => ({ rows: (await tx.query(sql, params)).rows }) })),
};
await migrate(db, new URL("../db/migrations/", import.meta.url));

const catalog = new ProductCatalog(loadProducts(new URL("../products/", import.meta.url).pathname));
const service = new QuoteService(db, catalog, { now: () => new Date() });
const secret = new TextEncoder().encode("local-development-secret-not-for-production");
const issuer = "local-dev";
const audience = "pas-api";

const broker = await service.addBroker({ name: "Leetile Brokers", fspNumber: "51234" });
await service.linkUser("dev-broker", { brokerId: broker.id });
await service.addClient(broker.id, { name: "T. Mokoena" });
const uw = await service.addUnderwriter({ name: "Example A Underwriting", insurer: "Example Insurer A", authority: 2 });
await service.linkUser("dev-underwriter", { underwriterId: uw.id });

const sign = (oid, roles) =>
  new SignJWT({ oid, roles }).setProtectedHeader({ alg: "HS256" }).setSubject(oid).setIssuer(issuer)
    .setAudience(audience).setIssuedAt().setExpirationTime("12h").sign(secret);

const app = buildApp({
  service,
  catalog,
  auth: jwtAuthenticator({ issuer, audience, key: secret, resolveLink: (s) => service.resolveLink(s) }),
});
await app.listen({ port: Number(process.env.PORT ?? 3000) });

console.log(`API on http://localhost:${process.env.PORT ?? 3000} (data is lost on exit)\n`);
console.log("Broker token (put in web/.env.local as VITE_DEV_TOKEN):");
console.log(await sign("dev-broker", ["Broker"]), "\n");
console.log("Underwriter token (Example Insurer A):");
console.log(await sign("dev-underwriter", ["Underwriter"]));
