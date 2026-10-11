// Real Postgres (PGlite, in-process WASM) running the project's own migration.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Exec } from "../../src/lib/db";

export async function makePg(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(readFileSync(path.resolve(__dirname, "../../db/migrations/0001_init.sql"), "utf8"));
  return pg;
}
export const pgExec = (pg: PGlite): Exec => async (text, params) => (await pg.query(text, params as any[])).rows as any[];
export async function truncateAll(pg: PGlite) {
  const t = (await pg.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => `"${r.tablename}"`);
  await pg.exec(`truncate ${t.join(", ")} restart identity cascade`);
}
