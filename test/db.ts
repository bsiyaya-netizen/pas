import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/db/database.js";
import { migrate } from "../src/db/migrate.js";

/** A fresh in-memory Postgres (PGlite) with migrations applied. */
export async function testDatabase(): Promise<Database> {
  const pg = new PGlite();
  const db: Database = {
    query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params)).rows }),
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await tx.query<T>(sql, params)).rows }) })),
  };
  await migrate(db);
  return db;
}
