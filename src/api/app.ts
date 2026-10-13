import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { ProductCatalog } from "../product/catalog.js";
import { LINES } from "../product/schema.js";
import { PolicyChangeError } from "../policy/changes.js";
import { CANCELLATION_REASONS } from "../policy/policy.js";
import { QuoteError } from "../quote/quote.js";
import { RatingError } from "../rating/engine.js";
import { isoDate } from "../dates.js";
import { renderCertificate, renderSchedule } from "../documents/render.js";
import { toCsv, type Report } from "../reporting/reports.js";
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
const Optional = (schema: z.ZodString) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());
const ClientBody = z
  .object({
    name: Name,
    idNumber: Optional(z.string().trim().regex(/^\d{13}$/, "Use the 13-digit ID number")),
    email: Optional(z.string().trim().email()),
    phone: Optional(z.string().trim().regex(/^\+?[\d ]{9,15}$/, "Use digits, e.g. 082 123 4567")),
    address: z
      .object({
        line1: Name,
        line2: Optional(z.string().trim().max(200)),
        suburb: Optional(z.string().trim().max(200)),
        city: Name,
        postalCode: z.string().trim().regex(/^\d{4}$/, "Use the 4-digit postal code"),
      })
      .strict()
      .optional(),
  })
  .strict();
const NewQuote = z
  .object({
    clientId: z.string().min(1),
    line: z.enum(LINES),
    effectiveDate: IsoDate,
    risk: z.record(z.unknown()),
    coverages: z.array(z.string()).default([]),
  })
  .strict();
const Endorsement = z
  .object({
    effectiveDate: IsoDate,
    risk: z.record(z.unknown()),
    coverages: z.array(z.string()).default([]),
    description: z.string().trim().max(500).optional(),
  })
  .strict();
const Cancellation = z
  .object({ effectiveDate: IsoDate, reason: z.enum(CANCELLATION_REASONS), note: z.string().trim().max(500).optional() })
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
    if (error instanceof QuoteError || error instanceof RatingError || error instanceof PolicyChangeError) {
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
    return reply.code(201).send(await service.addClient(brokerId, ClientBody.parse(request.body)));
  });
  app.get("/clients", async (request) => service.listClients(requireRole(request, "broker").brokerId));
  app.put("/clients/:clientId", async (request) => {
    const { clientId } = z.object({ clientId: z.string() }).parse(request.params);
    return service.updateClient(requireRole(request, "broker").brokerId, clientId, ClientBody.parse(request.body));
  });
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

  const PolicyParams = z.object({ policyNumber: z.string() });
  app.post("/policies/:policyNumber/endorsements/preview", async (request) => {
    const { policyNumber } = PolicyParams.parse(request.params);
    return service.previewEndorsement(requireRole(request, "broker").brokerId, policyNumber, Endorsement.parse(request.body));
  });
  app.post("/policies/:policyNumber/endorsements", async (request, reply) => {
    const { policyNumber } = PolicyParams.parse(request.params);
    const policy = await service.endorse(requireRole(request, "broker").brokerId, policyNumber, Endorsement.parse(request.body));
    return reply.code(201).send(policy);
  });
  app.post("/policies/:policyNumber/cancellation/preview", async (request) => {
    const { policyNumber } = PolicyParams.parse(request.params);
    const { effectiveDate } = z.object({ effectiveDate: IsoDate }).strict().parse(request.body);
    return service.previewCancellation(requireRole(request, "broker").brokerId, policyNumber, effectiveDate);
  });
  app.post("/policies/:policyNumber/cancellation", async (request, reply) => {
    const { policyNumber } = PolicyParams.parse(request.params);
    const policy = await service.cancel(requireRole(request, "broker").brokerId, policyNumber, Cancellation.parse(request.body));
    return reply.code(201).send(policy);
  });

  app.get("/policies/:policyNumber/documents/:kind", async (request, reply) => {
    const { policyNumber, kind } = z
      .object({ policyNumber: z.string(), kind: z.enum(["schedule", "certificate"]) })
      .parse(request.params);
    const doc = await service.getPolicyDocument(requireRole(request, "broker").brokerId, policyNumber);
    if (kind === "certificate" && doc.cancelledFrom && doc.issuedOn >= doc.cancelledFrom) {
      throw new PolicyChangeError(`Policy ${policyNumber} was cancelled from ${doc.cancelledFrom}; there is no cover to certify`);
    }
    const pdf = kind === "schedule" ? await renderSchedule(doc) : await renderCertificate(doc);
    return reply
      .type("application/pdf")
      .header("content-disposition", `inline; filename="${policyNumber}-${kind}.pdf"`)
      .header("cache-control", "no-store")
      .send(Buffer.from(pdf));
  });

  // Broker: dashboard and spreadsheet reports.
  app.get("/dashboard", async (request) => service.dashboard(requireRole(request, "broker").brokerId));
  const csv = (reply: FastifyReply, name: string, report: Report) =>
    reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${name}.csv"`)
      .header("cache-control", "no-store")
      .send(toCsv(report));
  app.get("/reports/policies", async (request, reply) => {
    const { asOf } = z.object({ asOf: IsoDate.optional() }).parse(request.query);
    const report = await service.policyRegister(requireRole(request, "broker").brokerId, asOf);
    return csv(reply, `policy-register-${asOf ?? isoDate(now())}`, report);
  });
  app.get("/reports/transactions", async (request, reply) => {
    const { from, to } = z
      .object({ from: IsoDate, to: IsoDate })
      .refine((r) => r.from <= r.to, { message: "from must be on or before to", path: ["to"] })
      .parse(request.query);
    const report = await service.transactionReport(requireRole(request, "broker").brokerId, from, to);
    return csv(reply, `transactions-${from}-to-${to}`, report);
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
