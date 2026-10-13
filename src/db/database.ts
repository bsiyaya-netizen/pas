import type { Pool, PoolClient } from "pg";

/** The one query method the storage code needs, served by node-postgres and by PGlite in tests. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Queryable {
  /** Runs fn inside BEGIN/COMMIT, rolling back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** Wraps a node-postgres pool for production use. */
export function fromPool(pool: Pool): Database {
  return {
    query: async <T>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
    transaction: async (fn) => {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("begin");
        const tx: Queryable = {
          query: async <T>(sql: string, params?: unknown[]) => {
            const result = await client.query(sql, params);
            return { rows: result.rows as T[] };
          },
        };
        const value = await fn(tx);
        await client.query("commit");
        return value;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
