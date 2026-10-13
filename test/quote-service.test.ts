import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.js";
import { migrate } from "../src/db/migrate.js";
import { ConflictError, NotFoundError, QuoteService } from "../src/service/quote-service.js";
import { testDatabase } from "./db.js";
import { catalog, cleanRisk } from "./fixtures.js";

const clock = { now: () => new Date("2026-10-13T10:00:00Z") };
const details = { line: "motor" as const, effectiveDate: "2026-11-01", risk: cleanRisk, coverages: [] };
const claimsRisk = { ...cleanRisk, driver: { ...cleanRisk.driver, claimsLast3Years: 3 } };

let db: Database;
let service: QuoteService;

beforeEach(async () => {
  db = await testDatabase();
  service = new QuoteService(db, catalog, clock);
});

async function setup() {
  const broker = await service.addBroker({ name: "Leetile Brokers", fspNumber: "51234" });
  const client = await service.addClient(broker.id, { name: "T. Mokoena" });
  return { broker, client };
}

describe("migrations", () => {
  it("apply once and are skipped on the next run", async () => {
    expect(await migrate(db)).toEqual([]);
    const { rows } = await db.query<{ version: number }>("select version from schema_migrations");
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
  });
});

describe("QuoteService", () => {
  it("stores a quote and binds it into a numbered policy", async () => {
    const { broker, client } = await setup();
    const quote = await service.createQuote(broker.id, client.id, details);
    expect(await service.getQuote(broker.id, quote.id)).toEqual(quote);

    const policy = await service.bind(broker.id, quote.id, "example-b-motor");
    expect(policy.policyNumber).toBe("POL-0000001");
    expect(await service.getPolicy(broker.id, policy.policyNumber)).toEqual(policy);
    expect((await service.getQuote(broker.id, quote.id)).status).toBe("bound");

    const { rows } = await db.query<{ type: string; premium_delta: unknown }>(
      "select type, premium_delta from policy_transactions where policy_number = $1",
      [policy.policyNumber],
    );
    // bigint comes back as a string from node-postgres and a number from PGlite.
    expect(rows.map((r) => [r.type, Number(r.premium_delta)])).toEqual([["new_business", 93_450]]);

    const second = await service.createQuote(broker.id, client.id, details);
    expect((await service.bind(broker.id, second.id, "example-a-motor")).policyNumber).toBe("POL-0000002");
  });

  it("keeps each broker's clients, quotes and policies to themselves", async () => {
    const { broker, client } = await setup();
    const other = await service.addBroker({ name: "Other Brokers", fspNumber: "40000" });
    await expect(service.createQuote(other.id, client.id, details)).rejects.toThrow(NotFoundError);

    const quote = await service.createQuote(broker.id, client.id, details);
    await expect(service.getQuote(other.id, quote.id)).rejects.toThrow(NotFoundError);
    await expect(service.bind(other.id, quote.id, "example-b-motor")).rejects.toThrow(NotFoundError);
    expect(await service.listQuotes(other.id)).toEqual([]);
    expect((await service.listQuotes(broker.id)).map((q) => q.id)).toEqual([quote.id]);

    const policy = await service.bind(broker.id, quote.id, "example-b-motor");
    await expect(service.getPolicy(other.id, policy.policyNumber)).rejects.toThrow(NotFoundError);
  });

  it("runs a referral through an underwriter and then binds", async () => {
    const { broker, client } = await setup();
    const uw = await service.addUnderwriter({ name: "Senior UW", insurer: "Example Insurer A", authority: 2 });
    const quote = await service.createQuote(broker.id, client.id, { ...details, risk: claimsRisk });

    await expect(service.bind(broker.id, quote.id, "example-a-motor")).rejects.toThrow(/needs_referral/);
    await service.refer(broker.id, quote.id, "example-a-motor");
    expect((await service.listPendingReferrals(uw.id)).map((q) => q.id)).toEqual([quote.id]);
    const otherUw = await service.addUnderwriter({ name: "B UW", insurer: "Example Insurer B", authority: 2 });
    expect(await service.listPendingReferrals(otherUw.id)).toEqual([]);
    const decided = await service.decide(uw.id, quote.id, "example-a-motor", "approved", "Hail claims only");
    expect(decided.options.find((o) => o.productId === "example-a-motor")!.referral?.status).toBe("approved");

    const policy = await service.bind(broker.id, quote.id, "example-a-motor");
    expect(policy.insurer).toBe("Example Insurer A");
  });

  it("rolls back a failed bind without using up the quote", async () => {
    const { broker, client } = await setup();
    const quote = await service.createQuote(broker.id, client.id, { ...details, risk: claimsRisk });
    await expect(service.bind(broker.id, quote.id, "example-a-motor")).rejects.toThrow();
    const { rows } = await db.query("select * from policies");
    expect(rows).toEqual([]);
    expect((await service.getQuote(broker.id, quote.id)).status).toBe("open");
  });

  it("refuses to overwrite a quote someone else changed", async () => {
    const { broker, client } = await setup();
    const quote = await service.createQuote(broker.id, client.id, { ...details, risk: claimsRisk });
    // Simulate a concurrent writer bumping the revision between read and write.
    const sneaky = new QuoteService(
      {
        ...db,
        transaction: (fn) =>
          db.transaction(async (tx) => {
            const value = await fn({
              query: async (sql, params) => {
                if (sql.trim().startsWith("update quotes")) {
                  await tx.query("update quotes set revision = revision + 1 where id = $1", [quote.id]);
                }
                return tx.query(sql, params);
              },
            });
            return value;
          }),
      },
      catalog,
      clock,
    );
    await expect(sneaky.refer(broker.id, quote.id, "example-a-motor")).rejects.toThrow(ConflictError);
  });

  it("rejects an invalid FSP number", async () => {
    await expect(service.addBroker({ name: "No Licence", fspNumber: "abc" })).rejects.toThrow(/FSP/);
  });
});
