import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../db/database.js";
import { isValidFspNumber, type Broker, type Client, type Underwriter } from "../parties.js";
import type { Policy } from "../policy/policy.js";
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
    const client = { id: this.newId(), ...input };
    await this.db.query("insert into clients (id, broker_id, name) values ($1, $2, $3)", [
      client.id,
      brokerId,
      client.name,
    ]);
    return client;
  }

  async addUnderwriter(input: Omit<Underwriter, "id">): Promise<Underwriter> {
    const underwriter = { id: this.newId(), ...input };
    await this.db.query("insert into underwriters (id, name, authority) values ($1, $2, $3)", [
      underwriter.id,
      underwriter.name,
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
    const { rows } = await this.db.query<{ id: string; name: string }>(
      "select id, name from clients where id = $1 and broker_id = $2",
      [clientId, brokerId],
    );
    const client = rows[0];
    if (!client) throw new NotFoundError(`Client ${clientId}`);

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

  /** Insurer underwriters see referrals from every broker, so this call is not broker-scoped. */
  async decide(
    underwriterId: string,
    quoteId: string,
    productId: string,
    decision: "approved" | "declined",
    note: string,
  ): Promise<Quote> {
    const { rows } = await this.db.query<{ id: string; name: string; authority: number }>(
      "select id, name, authority from underwriters where id = $1",
      [underwriterId],
    );
    const underwriter = rows[0];
    if (!underwriter) throw new NotFoundError(`Underwriter ${underwriterId}`);
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
      for (const t of policy.transactions) {
        await tx.query(
          `insert into policy_transactions (id, policy_number, type, effective_date, processed_at, premium_delta, processed_by)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [t.id, policy.policyNumber, t.type, t.effectiveDate, t.processedAt, t.premiumDelta, t.processedBy],
        );
      }
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
