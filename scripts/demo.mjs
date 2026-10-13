// Demo: the API on an in-memory database filled with sample clients, quotes and
// policies, plus the broker portal, with a "sign in as" choice instead of
// Microsoft Entra. Nothing is saved: stopping it throws the data away.
//
//   npm run demo        (then open http://localhost:5173)
//
// Never use this in production.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { SignJWT } from "jose";
import { buildApp, jwtAuthenticator, loadProducts, migrate, ProductCatalog, QuoteService } from "../dist/src/index.js";

const pg = new PGlite();
const db = {
  query: async (sql, params) => ({ rows: (await pg.query(sql, params)).rows }),
  transaction: (fn) =>
    pg.transaction((tx) => fn({ query: async (sql, params) => ({ rows: (await tx.query(sql, params)).rows }) })),
};
await migrate(db, new URL("../db/migrations/", import.meta.url));
const catalog = new ProductCatalog(loadProducts(fileURLToPath(new URL("../products/", import.meta.url))));

const DAY = 864e5;
const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(now.getTime() + n * DAY);
/** A service whose clock reads `when`, to back-date sample activity. */
const at = (when) => new QuoteService(db, catalog, { now: () => when });
const live = new QuoteService(db, catalog, { now: () => new Date() });
// The example products start on 1 January 2026; nothing is back-dated before that.
const earliest = new Date(Math.max(Date.UTC(2026, 0, 2), now.getTime() - 330 * DAY));

const broker = await live.addBroker({ name: "Demo Brokers", fspNumber: "51234" });
await live.linkUser("demo-broker", { brokerId: broker.id });
const underwriter = await live.addUnderwriter({ name: "Demo Underwriter", insurer: "Example Insurer A", authority: 2 });
await live.linkUser("demo-underwriter", { underwriterId: underwriter.id });

const people = [
  ["Thandi Dlamini", "8001015009087", "082 555 1234", "12 Jacaranda Street", "Rosebank", "Johannesburg", "2196"],
  ["Pieter van Wyk", null, "083 222 0101", "4 Kloof Road", "Gardens", "Cape Town", "8001"],
  ["Ayesha Patel", null, "071 444 9090", "88 Florida Road", "Morningside", "Durban", "4001"],
  ["Sipho Nkosi"], ["Lerato Molefe"], ["Johan Botha"], ["Nomsa Zulu"], ["Kabelo Mahlangu"],
  ["Fatima Khan"], ["Zanele Mthembu"], ["Andile Ndlovu"], ["Megan Adams"],
];
const clients = [];
for (const [name, idNumber, phone, line1, suburb, city, postalCode] of people) {
  clients.push(
    await live.addClient(broker.id, {
      name,
      ...(idNumber && { idNumber }),
      ...(phone && { phone }),
      ...(line1 && { address: { line1, suburb, city, postalCode } }),
    }),
  );
}

const cars = [
  ["Toyota", "Corolla Cross 1.8 XS", 2023, 380_000],
  ["Volkswagen", "Polo Vivo 1.4", 2021, 210_000],
  ["Suzuki", "Swift 1.2 GL", 2022, 180_000],
  ["Ford", "Ranger 2.0 XLT", 2020, 450_000],
  ["Hyundai", "Grand i10 1.2", 2019, 140_000],
  ["Kia", "Sonet 1.5 EX", 2024, 330_000],
];
const risk = (i, extra = {}) => {
  const [make, model, year, value] = cars[i % cars.length];
  return {
    territory: ["gauteng", "western_cape", "kwazulu_natal", "other"][i % 4],
    excessOption: 5000,
    vehicle: { value, use: "private", make, model, year, registration: `CA ${100 + i}-${200 + i * 7}` },
    driver: { age: 28 + ((i * 7) % 35), claimsLast3Years: 0, licenceDate: "2010-03-01" },
    ...extra,
  };
};

// About 18 policies spread over the last eleven months.
const policies = [];
let i = 0;
for (let when = new Date(earliest); when < daysFromNow(-3); when = new Date(when.getTime() + 18 * DAY)) {
  const service = at(when);
  const client = clients[i % clients.length];
  const quote = await service.createQuote(broker.id, client.id, {
    line: "motor",
    effectiveDate: iso(new Date(when.getTime() + 2 * DAY)),
    risk: risk(i),
    coverages: i % 3 === 0 ? ["car_hire"] : [],
  });
  const product = i % 3 === 0 ? "example-a-motor" : quote.options[0].productId;
  policies.push(await service.bind(broker.id, quote.id, product));
  i++;
}

// A change and a cancellation, made a couple of weeks ago.
if (policies.length > 3) {
  const changed = policies[2];
  const version = changed.terms[0].versions.at(-1);
  await at(daysFromNow(-14))
    .endorse(broker.id, changed.policyNumber, {
      effectiveDate: iso(daysFromNow(-13)),
      risk: { ...version.risk, excessOption: 7500 },
      coverages: version.coverages,
      description: "Client chose a higher excess",
    })
    .catch(() => {});
  await at(daysFromNow(-10))
    .cancel(broker.id, policies[1].policyNumber, { effectiveDate: iso(daysFromNow(-9)), reason: "vehicle_sold" })
    .catch(() => {});
}

// An open quote that expires soon, and one waiting on the underwriter.
await at(daysFromNow(-26)).createQuote(broker.id, clients[2].id, {
  line: "motor",
  effectiveDate: iso(daysFromNow(10)),
  risk: risk(4),
  coverages: [],
});
const risky = await live.createQuote(broker.id, clients[4].id, {
  line: "motor",
  effectiveDate: iso(daysFromNow(7)),
  risk: risk(5, { driver: { age: 41, claimsLast3Years: 3, licenceDate: "2004-06-01" } }),
  coverages: [],
});
await live.refer(broker.id, risky.id, "example-a-motor");

const secret = new TextEncoder().encode(`demo-${Math.random()}`);
const sign = (subject, role) =>
  new SignJWT({ oid: subject, roles: [role] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer("demo")
    .setAudience("pas-api")
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
const tokens = { broker: await sign("demo-broker", "Broker"), underwriter: await sign("demo-underwriter", "Underwriter") };

const app = buildApp({
  service: live,
  catalog,
  auth: jwtAuthenticator({ issuer: "demo", audience: "pas-api", key: secret, resolveLink: (s) => live.resolveLink(s) }),
});
await app.listen({ port: 3000, host: "127.0.0.1" });
console.log(`Demo API ready with ${policies.length} sample policies.`);

const portal = spawn("npm", ["run", "dev", "--", "--port", "5173", "--strictPort"], {
  cwd: fileURLToPath(new URL("../web/", import.meta.url)),
  env: { ...process.env, VITE_DEMO_TOKENS: JSON.stringify(tokens) },
  stdio: "inherit",
});
console.log("\nOpen the broker portal at http://localhost:5173 (in Codespaces it opens by itself).\n");
const stop = () => {
  portal.kill();
  void app.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
portal.on("exit", (code) => process.exit(code ?? 0));
