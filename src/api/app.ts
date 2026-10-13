import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { ProductCatalog } from "../product/catalog.js";
import { LINES } from "../product/schema.js";
import { QuoteError } from "../quote/quote.js";
import { RatingError } from "../rating/engine.js";
import { ConflictError, NotFoundError, type QuoteService } from "../service/quote-service.js";
import { AuthError, type Actor, type Authenticator } from "./auth.js";

/**
 * The HTTP API the broker portal and underwriter screens call. Every route
 * except /health needs a bearer token; the token's role decides what the
 * caller may do, and a broker only ever reaches their own records.
 */

export interface AppDeps {
  service: QuoteService;
  catalog: ProductCatalog;
  auth: Authenticator;
  /** Today's date for "products on sale" listings; defaults to the real clock. */
  now?: () => Date;
  logger?: boolean;
}

class ForbiddenError extends Error {}

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Name = z.string().trim().min(1).max(200);

const NewBroker = z.object({ name: Name, fspNumber: z.string().trim() }).strict();
const NewUnderwriter = z
  .object({ name: Name, insurer: Name, authority: z.number().int().positive() })
  .strict();
const UserLinkBody = z.union([
  z.object({ subject: z.string().min(1), brokerId: z.string().min(1) }).strict(),
  z.object({ subject: z.string().min(1), underwriterId: z.string().min(1) }).strict(),
]);
const NewClient = z.object({ name: Name }).strict();
const NewQuote = z
  .object({
    clientId: z.string().min(1),
    line: z.enum(LINES),
    effectiveDate: IsoDate,
    risk: z.record(z.unknown()),
    coverages: z.array(z.string()).default([]),
  })
  .strict();
const Decision = z.object({ decision: z.enum(["approved", "declined"]), note: z.string().max(2000) }).strict();
const OptionParams = z.object({ quoteId: z.string(), productId: z.string() });

export function buildApp(deps: AppDeps): FastifyInstance {
  const { service, catalog, auth } = deps;
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 256 * 1024 });

  app.decorateRequest("actor", null);
  app.addHook("onRequest", async (request) => {
    if (request.routeOptions.url === "/health") return;
    request.actor = await auth.authenticate(request.headers.authorization);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof ForbiddenError) return reply.code(403).send({ error: error.message });
    if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof ConflictError) return reply.code(409).send({ error: error.message });
    if (error instanceof QuoteError || error instanceof RatingError) {
      return reply.code(422).send({ error: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Invalid request",
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    // Fastify's own client errors (bad JSON, body too large, ...).
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (error as Error).message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Internal error" });
  });

  app.get("/health", async () => ({ ok: true }));

  // Admin: onboarding brokers and underwriters.
  app.post("/brokers", async (request, reply) => {
    requireRole(request, "admin");
    return reply.code(201).send(await service.addBroker(NewBroker.parse(request.body)));
  });
  app.post("/underwriters", async (request, reply) => {
    requireRole(request, "admin");
    return reply.code(201).send(await service.addUnderwriter(NewUnderwriter.parse(request.body)));
  });

  app.put("/user-links", async (request, reply) => {
    requireRole(request, "admin");
    const { subject, ...link } = UserLinkBody.parse(request.body);
    await service.linkUser(subject, link);
    return reply.code(204).send();
  });

  // Anyone signed in may see what is on sale.
  app.get("/products", async (request) => {
    const { line, date } = z
      .object({ line: z.enum(LINES), date: IsoDate.optional() })
      .parse(request.query);
    return catalog.forLine(line, date ?? now().toISOString().slice(0, 10)).map((p) => ({
      id: p.id,
      insurer: p.insurer,
      name: p.name,
      version: p.version,
      coverages: p.coverages.map((c) => ({ code: c.code, name: c.name, mandatory: c.mandatory })),
    }));
  });

  // Broker: clients, quotes, referrals and binding.
  app.post("/clients", async (request, reply) => {
    const { brokerId } = requireRole(request, "broker");
    return reply.code(201).send(await service.addClient(brokerId, NewClient.parse(request.body)));
  });
  app.get("/clients", async (request) => service.listClients(requireRole(request, "broker").brokerId));
  app.post("/quotes", async (request, reply) => {
    const { brokerId } = requireRole(request, "broker");
    const { clientId, ...details } = NewQuote.parse(request.body);
    return reply.code(201).send(await service.createQuote(brokerId, clientId, details));
  });
  app.get("/quotes", async (request) => service.listQuotes(requireRole(request, "broker").brokerId));
  app.get("/quotes/:quoteId", async (request) => {
    const { quoteId } = z.object({ quoteId: z.string() }).parse(request.params);
    return service.getQuote(requireRole(request, "broker").brokerId, quoteId);
  });
  app.post("/quotes/:quoteId/options/:productId/refer", async (request) => {
    const { brokerId } = requireRole(request, "broker");
    const { quoteId, productId } = OptionParams.parse(request.params);
    return service.refer(brokerId, quoteId, productId);
  });
  app.post("/quotes/:quoteId/options/:productId/bind", async (request, reply) => {
    const { brokerId } = requireRole(request, "broker");
    const { quoteId, productId } = OptionParams.parse(request.params);
    return reply.code(201).send(await service.bind(brokerId, quoteId, productId));
  });
  app.get("/policies/:policyNumber", async (request) => {
    const { policyNumber } = z.object({ policyNumber: z.string() }).parse(request.params);
    return service.getPolicy(requireRole(request, "broker").brokerId, policyNumber);
  });

  // Underwriter: the referral queue and decisions.
  app.get("/referrals", async (request) => {
    return service.listPendingReferrals(requireRole(request, "underwriter").underwriterId);
  });
  app.post("/quotes/:quoteId/options/:productId/decision", async (request) => {
    const { underwriterId } = requireRole(request, "underwriter");
    const { quoteId, productId } = OptionParams.parse(request.params);
    const { decision, note } = Decision.parse(request.body);
    return service.decide(underwriterId, quoteId, productId, decision, note);
  });

  return app;
}

function requireRole<R extends Actor["role"]>(request: FastifyRequest, role: R): Extract<Actor, { role: R }> {
  const actor = request.actor;
  if (!actor || actor.role !== role) throw new ForbiddenError(`Only ${role}s can do this`);
  return actor as Extract<Actor, { role: R }>;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
