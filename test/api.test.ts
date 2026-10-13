import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/api/app.js";
import { jwtAuthenticator } from "../src/api/auth.js";
import { QuoteService } from "../src/service/quote-service.js";
import { testDatabase } from "./db.js";
import { catalog, cleanRisk } from "./fixtures.js";

const secret = new TextEncoder().encode("test-secret-at-least-32-bytes-long!!");
const issuer = "https://id.example.test";
const audience = "pas-api";

/** An Entra-style access token: app roles in `roles`, the user id in `oid`. */
function token(oid: string, roles: string[], opts: { expiresIn?: string; aud?: string } = {}) {
  return new SignJWT({ oid, roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`pairwise-${oid}`)
    .setIssuer(issuer)
    .setAudience(opts.aud ?? audience)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "5m")
    .sign(secret);
}

let app: FastifyInstance;
let service: QuoteService;
let admin: string;

beforeEach(async () => {
  const db = await testDatabase();
  const clock = { now: () => new Date("2026-10-13T10:00:00Z") };
  service = new QuoteService(db, catalog, clock);
  app = buildApp({
    service,
    catalog,
    auth: jwtAuthenticator({ issuer, audience, key: secret, resolveLink: (subject) => service.resolveLink(subject) }),
    now: clock.now,
  });
  admin = await token("admin-1", ["Admin"]);
});

async function call(method: "GET" | "POST" | "PUT", url: string, bearer?: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    ...(payload !== undefined && { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

/** Admin creates the broker firm and links a signed-in user to it. */
async function onboardBroker(fspNumber = "51234") {
  const broker = (await call("POST", "/brokers", admin, { name: "Leetile Brokers", fspNumber })).body;
  const user = `broker-user-${fspNumber}`;
  expect((await call("PUT", "/user-links", admin, { subject: user, brokerId: broker.id })).status).toBe(204);
  return { broker, bearer: await token(user, ["Broker"]) };
}

const quoteBody = (clientId: string, risk: Record<string, unknown> = cleanRisk) => ({
  clientId,
  line: "motor",
  effectiveDate: "2026-11-01",
  risk,
});

describe("authentication", () => {
  it("lets anyone check health but nothing else without a valid token", async () => {
    expect((await call("GET", "/health")).status).toBe(200);
    expect((await call("GET", "/quotes")).status).toBe(401);
    expect((await call("GET", "/quotes", "not-a-jwt")).status).toBe(401);
    expect((await call("GET", "/quotes", await token("u", ["Broker"], { aud: "other" }))).status).toBe(401);
    expect((await call("GET", "/quotes", await token("u", ["Broker"], { expiresIn: "-1m" }))).status).toBe(401);
  });

  it("refuses signed-in users with no role or no link yet", async () => {
    expect(await call("GET", "/quotes", await token("u", []))).toMatchObject({ status: 403, body: { error: expect.stringMatching(/no Broker/) } });
    expect(await call("GET", "/quotes", await token("unlinked", ["Broker"]))).toMatchObject({
      status: 403,
      body: { error: expect.stringMatching(/not linked to a broker/) },
    });
  });

  it("only lets admins link users", async () => {
    const { broker, bearer } = await onboardBroker();
    expect((await call("PUT", "/user-links", bearer, { subject: "x", brokerId: broker.id })).status).toBe(403);
    expect((await call("PUT", "/user-links", admin, { subject: "x", brokerId: "missing" })).status).toBe(404);
  });

  it("keeps each role to its own routes", async () => {
    const { bearer } = await onboardBroker();
    expect((await call("POST", "/brokers", bearer, { name: "X", fspNumber: "1" })).status).toBe(403);
    expect((await call("GET", "/referrals", bearer)).status).toBe(403);
    expect((await call("GET", "/quotes", admin)).status).toBe(403);
  });
});

describe("broker journey", () => {
  it("adds a client, quotes, and binds the cheapest insurer", async () => {
    const { bearer } = await onboardBroker();
    const client = await call("POST", "/clients", bearer, { name: "T. Mokoena" });
    expect(client.status).toBe(201);
    expect((await call("GET", "/clients", bearer)).body).toEqual([client.body]);

    const quote = await call("POST", "/quotes", bearer, quoteBody(client.body.id));
    expect(quote.status).toBe(201);
    expect(quote.body.options.map((o: { insurer: string }) => o.insurer)).toEqual(["Example Insurer B", "Example Insurer A"]);

    expect((await call("GET", "/quotes", bearer)).body).toHaveLength(1);
    const bound = await call("POST", `/quotes/${quote.body.id}/options/example-b-motor/bind`, bearer);
    expect(bound.status).toBe(201);
    expect(bound.body.policyNumber).toBe("POL-0000001");
    expect((await call("GET", `/policies/${bound.body.policyNumber}`, bearer)).body.insurer).toBe("Example Insurer B");

    const again = await call("POST", `/quotes/${quote.body.id}/options/example-a-motor/bind`, bearer);
    expect(again).toMatchObject({ status: 422, body: { error: expect.stringMatching(/already bound/) } });
  });

  it("hides one broker's records from another", async () => {
    const a = await onboardBroker("11111");
    const b = await onboardBroker("22222");
    const client = (await call("POST", "/clients", a.bearer, { name: "Client" })).body;
    expect((await call("GET", "/clients", b.bearer)).body).toEqual([]);
    expect((await call("POST", "/quotes", b.bearer, quoteBody(client.id))).status).toBe(404);
    const quote = (await call("POST", "/quotes", a.bearer, quoteBody(client.id))).body;
    expect((await call("GET", `/quotes/${quote.id}`, b.bearer)).status).toBe(404);
  });

  it("explains invalid requests", async () => {
    const { bearer } = await onboardBroker();
    const res = await call("POST", "/quotes", bearer, { clientId: "x", line: "boats", effectiveDate: "1 Nov" });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["line", "effectiveDate", "risk"]));
  });

  it("lists products on sale for a line", async () => {
    const { bearer } = await onboardBroker();
    const res = await call("GET", "/products?line=motor", bearer);
    expect(res.body.map((p: { id: string }) => p.id).sort()).toEqual(["example-a-motor", "example-b-motor"]);
  });
});

describe("referral journey", () => {
  it("routes a referral to the insurer's underwriter and back to the broker", async () => {
    const { bearer } = await onboardBroker();
    const uw = (await call("POST", "/underwriters", admin, { name: "Senior UW", insurer: "Example Insurer A", authority: 2 })).body;
    await call("PUT", "/user-links", admin, { subject: "uw-user", underwriterId: uw.id });
    const uwBearer = await token("uw-user", ["Underwriter"]);
    const client = (await call("POST", "/clients", bearer, { name: "Client" })).body;
    const risk = { ...cleanRisk, driver: { ...cleanRisk.driver, claimsLast3Years: 3 } };
    const quote = (await call("POST", "/quotes", bearer, quoteBody(client.id, risk))).body;

    expect((await call("POST", `/quotes/${quote.id}/options/example-a-motor/refer`, bearer)).status).toBe(200);
    expect((await call("GET", "/referrals", uwBearer)).body.map((q: { id: string }) => q.id)).toEqual([quote.id]);

    const decided = await call("POST", `/quotes/${quote.id}/options/example-a-motor/decision`, uwBearer, {
      decision: "approved",
      note: "Hail claims only",
    });
    expect(decided.status).toBe(200);
    expect((await call("GET", "/referrals", uwBearer)).body).toEqual([]);
    expect((await call("POST", `/quotes/${quote.id}/options/example-a-motor/bind`, bearer)).status).toBe(201);
  });
});
