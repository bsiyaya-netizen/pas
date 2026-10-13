import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.js";

export const MIGRATIONS_DIR = new URL("../../db/migrations/", import.meta.url);

/**
 * Applies every db/migrations/NNN_name.sql file not yet recorded, in order,
 * each in its own transaction. Returns the versions applied.
 */
export async function migrate(db: Database, dir: string | URL = MIGRATIONS_DIR): Promise<number[]> {
  await db.query(
    "create table if not exists schema_migrations (version integer primary key, name text not null, applied_at timestamptz not null default now())",
  );
  const { rows } = await db.query<{ version: number }>("select version from schema_migrations");
  const done = new Set(rows.map((r) => Number(r.version)));
  const path = typeof dir === "string" ? dir : fileURLToPath(dir);

  const applied: number[] = [];
  for (const file of readdirSync(path).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
    const version = Number(file.split("_")[0]);
    if (done.has(version)) continue;
    const sql = readFileSync(join(path, file), "utf8");
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(sql)) await tx.query(statement);
      await tx.query("insert into schema_migrations (version, name) values ($1, $2)", [version, file]);
    });
    applied.push(version);
  }
  return applied;
}

/** Splits a migration on semicolons at line ends; migrations avoid function bodies for this reason. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}
