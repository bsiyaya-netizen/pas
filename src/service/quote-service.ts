import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../db/database.js";
import { isValidFspNumber, isValidSaIdNumber, type Broker, type Client, type Underwriter } from "../parties.js";
import { isoDate } from "../dates.js";
import { policyDocument, type PolicyDocument } from "../documents/policy-document.js";
import {
  cancel,
  endorse,
  previewCancellation,
  previewEndorsement,
  ratedProduct,
  type CancellationPreview,
  type CancellationRequest,
  type EndorsementPreview,
  type EndorsementRequest,
} from "../policy/changes.js";
import type { Policy, PolicyTransaction } from "../policy/policy.js";
import { brokerDashboard, type Dashboard } from "../reporting/dashboard.js";
import { policyRegister, transactionReport, type Report } from "../reporting/reports.js";
import type { ProductCatalog } from "../product/catalog.js";
import {
  bindQuote,
  createQuote,
  decideReferral,
  QuoteError,
  referOption,
  type Clock,
  type NewQuote,
  type Quote,
} from "../quote/quote.js";

/**
 * Stores parties, quotes and policies in PostgreSQL around the pure quote
 * functions. Every broker-facing call takes the broker's id and only sees that
 * broker's clients, quotes and policies.
 */

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** Someone else changed the quote between our read and our write; reload and retry. */
export class ConflictError extends Error {
  constructor(what: string) {
    super(`${what} was changed by someone else; reload and try again`);
    this.name = "ConflictError";
  }
}

export interface QuoteServiceDeps extends Clock {
  newId?: () => string;
}

export class QuoteService {
  private readonly newId: () => string;

  constructor(
    private readonly db: Database,
    private readonly catalog: ProductCatalog,
    private readonly deps: QuoteServiceDeps,
  ) {
    this.newId = deps.newId ?? randomUUID;
  }

  async addBroker(input: Omit<Broker, "id">): Promise<Broker> {
    if (!isValidFspNumber(input.fspNumber)) throw new QuoteError(`Invalid FSP number "${input.fspNumber}"`);
    const broker = { id: this.newId(), ...input };
    await this.db.query("insert into brokers (id, name, fsp_number) values ($1, $2, $3)", [
      broker.id,
      broker.name,
      broker.fspNumber,
    ]);
    return broker;
  }

  async addClient(brokerId: string, input: Omit<Client, "id">): Promise<Client> {
    await this.broker(brokerId);
    const client = { id: this.newId(), ...checkClient(input) };
    await this.db.query(
      "insert into clients (id, broker_id, name, id_number, email, phone, address) values ($1, $2, $3, $4, $5, $6, $7)",
      [client.id, brokerId, client.name, client.idNumber ?? null, client.email ?? null, client.phone ?? null, client.address ?? null],
    );
    return client;
  }

  /** Replaces a client's details; documents issued afterwards show the new ones. */
  async updateClient(brokerId: string, clientId: string, input: Omit<Client, "id">): Promise<Client> {
    const client = { id: clientId, ...checkClient(input) };
    const { rows } = await this.db.query(
      `update clients set name = $3, id_number = $4, email = $5, phone = $6, address = $7
       where id = $1 and broker_id = $2 returning id`,
      [clientId, brokerId, client.name, client.idNumber ?? null, client.email ?? null, client.phone ?? null, client.address ?? null],
    );
    if (!rows[0]) throw new NotFoundError(`Client ${clientId}`);
    return client;
  }

  /** Links an identity-provider user to the broker or underwriter they act for (replacing any old link). */
  async linkUser(subject: string, link: { brokerId: string } | { underwriterId: string }): Promise<void> {
    const brokerId = "brokerId" in link ? link.brokerId : null;
    const underwriterId = "underwriterId" in link ? link.underwriterId : null;
    if (brokerId) await this.broker(brokerId);
    if (underwriterId) await this.underwriter(underwriterId);
    await this.db.query(
      `insert into user_links (subject, broker_id, underwriter_id) values ($1, $2, $3)
       on conflict (subject) do update set broker_id = excluded.broker_id, underwriter_id = excluded.underwriter_id`,
      [subject, brokerId, underwriterId],
    );
  }

  async resolveLink(subject: string): Promise<{ brokerId?: string; underwriterId?: string } | undefined> {
    const { rows } = await this.db.query<{ broker_id: string | null; underwriter_id: string | null }>(
      "select broker_id, underwriter_id from user_links where subject = $1",
      [subject],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      ...(row.broker_id && { brokerId: row.broker_id }),
      ...(row.underwriter_id && { underwriterId: row.underwriter_id }),
    };
  }

  async listClients(brokerId: string): Promise<Client[]> {
    const { rows } = await this.db.query<ClientRow>(
      `select ${CLIENT_COLUMNS} from clients where broker_id = $1 order by name`,
      [brokerId],
    );
    return rows.map(toClient);
  }

  async addUnderwriter(input: Omit<Underwriter, "id">): Promise<Underwriter> {
    const underwriter = { id: this.newId(), ...input };
    await this.db.query("insert into underwriters (id, name, insurer, authority) values ($1, $2, $3, $4)", [
      underwriter.id,
      underwriter.name,
      underwriter.insurer,
      underwriter.authority,
    ]);
    return underwriter;
  }

  async createQuote(
    brokerId: string,
    clientId: string,
    details: Omit<NewQuote, "broker" | "client">,
  ): Promise<Quote> {
    const broker = await this.broker(brokerId);
    const { rows } = await this.db.query<ClientRow>(
      `select ${CLIENT_COLUMNS} from clients where id = $1 and broker_id = $2`,
      [clientId, brokerId],
    );
    if (!rows[0]) throw new NotFoundError(`Client ${clientId}`);
    const client = toClient(rows[0]);

    const quote = createQuote(this.catalog, { ...details, broker, client }, { ...this.deps, quoteId: this.newId() });
    await this.db.query(
      `insert into quotes (id, broker_id, client_id, line, status, expires_on, document, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [quote.id, brokerId, clientId, quote.line, quote.status, quote.expiresOn, quote, quote.createdAt],
    );
    return quote;
  }

  async getQuote(brokerId: string, quoteId: string): Promise<Quote> {
    return (await this.loadQuote(this.db, quoteId, brokerId)).quote;
  }

  async listQuotes(brokerId: string): Promise<Quote[]> {
    const { rows } = await this.db.query<{ document: Quote }>(
      "select document from quotes where broker_id = $1 order by created_at desc",
      [brokerId],
    );
    return rows.map((r) => r.document);
  }

  async refer(brokerId: string, quoteId: string, productId: string): Promise<Quote> {
    return this.db.transaction(async (tx) => {
      const { quote, revision } = await this.loadQuote(tx, quoteId, brokerId, true);
      return this.saveQuote(tx, referOption(quote, productId, this.deps), revision);
    });
  }

  /** Open quotes with an option from this underwriter's insurer awaiting a decision, oldest first. */
  async listPendingReferrals(underwriterId: string): Promise<Quote[]> {
    const underwriter = await this.underwriter(underwriterId);
    const { rows } = await this.db.query<{ document: Quote }>(
      `select document from quotes
       where status = 'open'
         and exists (
           select 1 from jsonb_array_elements(document -> 'options') as o
           where o -> 'referral' ->> 'status' = 'pending' and o ->> 'insurer' = $1
         )
       order by created_at`,
      [underwriter.insurer],
    );
    return rows.map((r) => r.document);
  }

  /** Underwriters see referrals from every broker, so this call is scoped by insurer, not broker. */
  async decide(
    underwriterId: string,
    quoteId: string,
    productId: string,
    decision: "approved" | "declined",
    note: string,
  ): Promise<Quote> {
    const underwriter = await this.underwriter(underwriterId);
    return this.db.transaction(async (tx) => {
      const { quote, revision } = await this.loadQuote(tx, quoteId, undefined, true);
      return this.saveQuote(tx, decideReferral(quote, productId, underwriter, decision, note, this.deps), revision);
    });
  }

  /** Binds an option and issues the policy in one database transaction. */
  async bind(brokerId: string, quoteId: string, productId: string): Promise<Policy> {
    const broker = await this.broker(brokerId);
    return this.db.transaction(async (tx) => {
      const { quote, revision } = await this.loadQuote(tx, quoteId, brokerId, true);
      const { rows } = await tx.query<{ n: string }>("select nextval('policy_number_seq') as n");
      const policyNumber = `POL-${String(rows[0]!.n).padStart(7, "0")}`;
      const result = bindQuote(quote, productId, broker, {
        ...this.deps,
        policyNumber,
        transactionId: this.newId(),
      });
      await this.saveQuote(tx, result.quote, revision);

      const policy = result.policy;
      await tx.query(
        `insert into policies (policy_number, quote_id, broker_id, client_id, product_id, insurer, line, status, document)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          policy.policyNumber,
          policy.quoteId,
          policy.brokerId,
          policy.clientId,
          policy.productId,
          policy.insurer,
          policy.line,
          policy.status,
          policy,
        ],
      );
      for (const t of policy.transactions) await this.insertTransaction(tx, policy.policyNumber, t);
      return policy;
    });
  }

  async getPolicy(brokerId: string, policyNumber: string): Promise<Policy> {
    const { rows } = await this.db.query<{ document: Policy }>(
      "select document from policies where policy_number = $1 and broker_id = $2",
      [policyNumber, brokerId],
    );
    if (!rows[0]) throw new NotFoundError(`Policy ${policyNumber}`);
    return rows[0].document;
  }

  async previewEndorsement(brokerId: string, policyNumber: string, request: EndorsementRequest): Promise<EndorsementPreview> {
    const policy = await this.getPolicy(brokerId, policyNumber);
    return previewEndorsement(policy, ratedProduct(this.catalog, policy), request, this.deps);
  }

  /** Applies a mid-term change as a new policy version, in one transaction. */
  async endorse(brokerId: string, policyNumber: string, request: EndorsementRequest): Promise<Policy> {
    const broker = await this.broker(brokerId);
    return this.changePolicy(brokerId, policyNumber, (policy, transactionId) =>
      endorse(policy, ratedProduct(this.catalog, policy), request, broker, { ...this.deps, transactionId }).policy,
    );
  }

  async previewCancellation(brokerId: string, policyNumber: string, effectiveDate: string): Promise<CancellationPreview> {
    return previewCancellation(await this.getPolicy(brokerId, policyNumber), { effectiveDate }, this.deps);
  }

  async cancel(brokerId: string, policyNumber: string, request: CancellationRequest): Promise<Policy> {
    const broker = await this.broker(brokerId);
    return this.changePolicy(brokerId, policyNumber, (policy, transactionId) =>
      cancel(policy, request, broker, { ...this.deps, transactionId }).policy,
    );
  }

  /** Locks the policy, applies a change that adds one transaction, and saves both. */
  private async changePolicy(
    brokerId: string,
    policyNumber: string,
    change: (policy: Policy, transactionId: string) => Policy,
  ): Promise<Policy> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ document: Policy; revision: number }>(
        "select document, revision from policies where policy_number = $1 and broker_id = $2 for update",
        [policyNumber, brokerId],
      );
      if (!rows[0]) throw new NotFoundError(`Policy ${policyNumber}`);
      const policy = change(rows[0].document, this.newId());
      const saved = await tx.query(
        "update policies set document = $1, status = $2, revision = revision + 1 where policy_number = $3 and revision = $4 returning policy_number",
        [policy, policy.status, policyNumber, rows[0].revision],
      );
      if (saved.rows.length === 0) throw new ConflictError(`Policy ${policyNumber}`);
      await this.insertTransaction(tx, policyNumber, policy.transactions.at(-1)!);
      return policy;
    });
  }

  private async insertTransaction(q: Queryable, policyNumber: string, t: PolicyTransaction): Promise<void> {
    await q.query(
      `insert into policy_transactions
         (id, policy_number, type, effective_date, processed_at, premium_delta, pro_rata_adjustment, description, processed_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        t.id,
        policyNumber,
        t.type,
        t.effectiveDate,
        t.processedAt,
        t.premiumDelta,
        t.proRataAdjustment ?? 0,
        t.description ?? null,
        t.processedBy,
      ],
    );
  }

  async listPolicies(brokerId: string): Promise<Policy[]> {
    const { rows } = await this.db.query<{ document: Policy }>(
      "select document from policies where broker_id = $1 order by policy_number",
      [brokerId],
    );
    return rows.map((r) => r.document);
  }

  async dashboard(brokerId: string): Promise<Dashboard> {
    const [policies, quotes, clients] = await Promise.all([
      this.listPolicies(brokerId),
      this.listQuotes(brokerId),
      this.listClients(brokerId),
    ]);
    return brokerDashboard(policies, quotes, clients, isoDate(this.deps.now()));
  }

  async policyRegister(brokerId: string, asOf?: string): Promise<Report> {
    const [policies, clients] = await Promise.all([this.listPolicies(brokerId), this.listClients(brokerId)]);
    return policyRegister(policies, clients, asOf ?? isoDate(this.deps.now()));
  }

  async transactionReport(brokerId: string, from: string, to: string): Promise<Report> {
    const [policies, clients] = await Promise.all([this.listPolicies(brokerId), this.listClients(brokerId)]);
    return transactionReport(policies, clients, from, to);
  }

  /** What the policy's schedule and certificate print, as of today. */
  async getPolicyDocument(brokerId: string, policyNumber: string): Promise<PolicyDocument> {
    const policy = await this.getPolicy(brokerId, policyNumber);
    const broker = await this.broker(brokerId);
    const { rows } = await this.db.query<ClientRow>(`select ${CLIENT_COLUMNS} from clients where id = $1`, [
      policy.clientId,
    ]);
    if (!rows[0]) throw new NotFoundError(`Client ${policy.clientId}`);
    const rating = policy.terms.at(-1)?.versions.at(-1)?.rating;
    const product = rating && this.catalog.get(rating.productId, rating.productVersion);
    if (!product) throw new Error(`Product ${policy.productId} for policy ${policyNumber} is not loaded`);
    return policyDocument(policy, { broker, client: toClient(rows[0]), product, issuedOn: isoDate(this.deps.now()) });
  }

  private async underwriter(underwriterId: string): Promise<Underwriter> {
    const { rows } = await this.db.query<Underwriter>(
      "select id, name, insurer, authority from underwriters where id = $1",
      [underwriterId],
    );
    if (!rows[0]) throw new NotFoundError(`Underwriter ${underwriterId}`);
    return rows[0];
  }

  private async broker(brokerId: string): Promise<Broker> {
    const { rows } = await this.db.query<{ id: string; name: string; fsp_number: string }>(
      "select id, name, fsp_number from brokers where id = $1",
      [brokerId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError(`Broker ${brokerId}`);
    return { id: row.id, name: row.name, fspNumber: row.fsp_number };
  }

  /** Reads a quote, optionally scoped to one broker and locked for update. */
  private async loadQuote(
    q: Queryable,
    quoteId: string,
    brokerId: string | undefined,
    lock = false,
  ): Promise<{ quote: Quote; revision: number }> {
    const { rows } = await q.query<{ document: Quote; revision: number }>(
      `select document, revision from quotes where id = $1 ${brokerId ? "and broker_id = $2" : ""} ${lock ? "for update" : ""}`,
      brokerId ? [quoteId, brokerId] : [quoteId],
    );
    if (!rows[0]) throw new NotFoundError(`Quote ${quoteId}`);
    return { quote: rows[0].document, revision: rows[0].revision };
  }

  private async saveQuote(q: Queryable, quote: Quote, revision: number): Promise<Quote> {
    const { rows } = await q.query(
      `update quotes set document = $1, status = $2, revision = revision + 1, updated_at = now()
       where id = $3 and revision = $4 returning id`,
      [quote, quote.status, quote.id, revision],
    );
    if (rows.length === 0) throw new ConflictError(`Quote ${quote.id}`);
    return quote;
  }
}

const CLIENT_COLUMNS = "id, name, id_number, email, phone, address";

interface ClientRow {
  id: string;
  name: string;
  id_number: string | null;
  email: string | null;
  phone: string | null;
  address: Client["address"] | null;
}

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    ...(row.id_number && { idNumber: row.id_number }),
    ...(row.email && { email: row.email }),
    ...(row.phone && { phone: row.phone }),
    ...(row.address && { address: row.address }),
  };
}

function checkClient(input: Omit<Client, "id">): Omit<Client, "id"> {
  if (input.idNumber !== undefined && !isValidSaIdNumber(input.idNumber)) {
    throw new QuoteError(`"${input.idNumber}" is not a valid South African ID number`);
  }
  return input;
}
