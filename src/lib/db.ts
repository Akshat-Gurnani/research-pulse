// Server-only Postgres access. Never import this from a client component.
// A small query builder that keeps the chainable surface the app already uses
// (from/select/insert/upsert/update/delete + filters) over plain SQL, so the pipeline
// and pages are independent of the hosting provider (Neon in production, PGlite in tests).
import { neon } from "@neondatabase/serverless";
import { env } from "./config";

export type Exec = (text: string, params: unknown[]) => Promise<any[]>;
export type DbResult = { data: any; error: { message: string } | null; count?: number | null };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (id: string) => { if (!IDENT.test(id)) throw new Error(`bad identifier: ${id}`); return `"${id}"`; };

interface Meta { types: Map<string, Map<string, string>>; pk: Map<string, string[]> }

async function loadMeta(exec: Exec): Promise<Meta> {
  const types = new Map<string, Map<string, string>>();
  for (const r of await exec("select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public'", [])) {
    if (!types.has(r.table_name)) types.set(r.table_name, new Map());
    types.get(r.table_name)!.set(r.column_name, r.udt_name);
  }
  const pk = new Map<string, string[]>();
  const rows = await exec(
    `select tc.table_name, kcu.column_name from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
     where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public' order by kcu.ordinal_position`, []);
  for (const r of rows) pk.set(r.table_name, [...(pk.get(r.table_name) ?? []), r.column_name]);
  return { types, pk };
}

function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

class Params {
  list: unknown[] = [];
  add(v: unknown, cast = ""): string { this.list.push(v); return `$${this.list.length}${cast}`; }
}
type Filter = (p: Params) => string;

const OPS: Record<string, string> = { eq: "=", neq: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };

function orClause(s: string): Filter {
  if (s.startsWith("and(") && s.endsWith(")")) {
    const fs = splitTop(s.slice(4, -1)).map(orClause);
    return (p) => `(${fs.map((f) => f(p)).join(" and ")})`;
  }
  const m = /^(\w+)\.(eq|neq|lt|lte|gt|gte|in|is)\.(.*)$/.exec(s);
  if (!m) throw new Error(`unsupported or() clause: ${s}`);
  const [, col, op, val] = m;
  if (op === "in") { const set = val.replace(/^\(|\)$/g, "").split(","); return (p) => `${q(col)} = any(${p.add(set)})`; }
  if (op === "is") return () => `${q(col)} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`;
  return (p) => `${q(col)} ${OPS[op]} ${p.add(val)}`;
}

export class Query implements PromiseLike<DbResult> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" | null = null;
  private filters: Filter[] = [];
  private cols = "*"; private payload: any; private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private wantRows = false; private head = false; private wantCount = false;
  private lim?: number; private ords: { col: string; asc: boolean }[] = []; private mode: "many" | "maybe" | "single" = "many";
  constructor(private exec: Exec, private metaP: () => Promise<Meta>, private table: string) { q(table); }

  select(cols = "*", o?: { count?: string; head?: boolean }) {
    if (this.op === null) { this.op = "select"; this.cols = cols; } else this.wantRows = true;
    if (o?.count) this.wantCount = true;
    if (o?.head) this.head = true;
    return this;
  }
  insert(rows: Record<string, any> | Record<string, any>[]) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows: Record<string, any> | Record<string, any>[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = rows; this.opts = o; return this; }
  update(patch: Record<string, any>) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }

  private cmp(c: string, op: string, v: unknown) { q(c); this.filters.push((p) => `${q(c)} ${OPS[op]} ${p.add(v)}`); return this; }
  eq(c: string, v: unknown) { return this.cmp(c, "eq", v); }
  neq(c: string, v: unknown) { return this.cmp(c, "neq", v); }
  gt(c: string, v: unknown) { return this.cmp(c, "gt", v); }
  gte(c: string, v: unknown) { return this.cmp(c, "gte", v); }
  lt(c: string, v: unknown) { return this.cmp(c, "lt", v); }
  lte(c: string, v: unknown) { return this.cmp(c, "lte", v); }
  in(c: string, vs: unknown[]) { q(c); this.filters.push((p) => `${q(c)} = any(${p.add(vs)})`); return this; }
  is(c: string, v: null | boolean) { q(c); this.filters.push(() => `${q(c)} is ${v === null ? "null" : v ? "true" : "false"}`); return this; }
  not(c: string, op: string, v: unknown) {
    q(c);
    if (op === "is") this.filters.push(() => `${q(c)} is not ${v === null ? "null" : v ? "true" : "false"}`);
    else if (op in OPS) this.filters.push((p) => `not (${q(c)} ${OPS[op]} ${p.add(v)})`);
    else throw new Error(`unsupported not() operator: ${op}`);
    return this;
  }
  match(o: Record<string, unknown>) { for (const [k, v] of Object.entries(o)) this.eq(k, v); return this; }
  or(s: string) { const fs = splitTop(s).map(orClause); this.filters.push((p) => `(${fs.map((f) => f(p)).join(" or ")})`); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { q(col); this.ords.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }

  private where(p: Params) { return this.filters.length ? ` where ${this.filters.map((f) => f(p)).join(" and ")}` : ""; }

  private normalise(rows: any[], types?: Map<string, string>): any[] {
    return rows.map((r) => {
      const o: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        if (v instanceof Date) o[k] = v.toISOString();
        else if (typeof v === "bigint") o[k] = Number(v);
        else if (typeof v === "string" && types?.get(k) === "int8") o[k] = Number(v);
        else o[k] = v;
      }
      return o;
    });
  }
  private cell(v: unknown, type: string | undefined, p: Params): string {
    if (v === undefined) return "default";
    if (type === "jsonb" || type === "json") return p.add(v === null ? null : JSON.stringify(v), "::jsonb");
    return p.add(v instanceof Date ? v.toISOString() : v);
  }

  private async run(): Promise<DbResult> {
    const meta = await this.metaP();
    const types = meta.types.get(this.table);
    if (!types) throw new Error(`unknown table: ${this.table}`);
    const t = q(this.table);
    const p = new Params();
    const shape = (raw: any[], count: number | null): DbResult => {
      const rows = this.normalise(raw, types);
      if (this.mode === "many") return { data: rows, error: null, count };
      if (this.mode === "single" && rows.length !== 1) return { data: null, error: { message: `single() expected 1 row, got ${rows.length}` } };
      return { data: rows[0] ?? null, error: null, count };
    };
    switch (this.op) {
      case "select": {
        const cols = this.cols.trim() === "*" ? "*" : this.cols.split(",").map((c) => q(c.trim())).join(", ");
        let count: number | null = null;
        if (this.wantCount) {
          const cp = new Params();
          const c = await this.exec(`select count(*) as n from ${t}${this.where(cp)}`, cp.list);
          count = Number(c[0]?.n ?? 0);
          if (this.head) return { data: null, error: null, count };
        }
        let sql = `select ${cols} from ${t}${this.where(p)}`;
        if (this.ords.length) sql += ` order by ${this.ords.map((o) => `${q(o.col)} ${o.asc ? "asc" : "desc"}`).join(", ")}`;
        const lim = this.mode === "many" ? this.lim : Math.min(this.lim ?? 2, 2);
        if (lim != null) sql += ` limit ${Math.max(0, Math.floor(lim))}`;
        return shape(await this.exec(sql, p.list), count);
      }
      case "insert":
      case "upsert": {
        const rows: Record<string, any>[] = ([] as Record<string, any>[]).concat(this.payload);
        if (rows.length === 0) return { data: this.wantRows ? [] : null, error: null };
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const values = rows.map((r) => `(${cols.map((c) => this.cell(r[c], types.get(c), p)).join(", ")})`).join(", ");
        let sql = `insert into ${t} (${cols.map(q).join(", ")}) values ${values}`;
        if (this.op === "upsert") {
          const target = this.opts.onConflict ? this.opts.onConflict.split(",").map((s) => s.trim()) : meta.pk.get(this.table);
          if (!target?.length) throw new Error(`upsert on ${this.table}: no conflict target`);
          const set = cols.filter((c) => !target.includes(c));
          sql += ` on conflict (${target.map(q).join(", ")}) ` +
            (this.opts.ignoreDuplicates || set.length === 0 ? "do nothing" : `do update set ${set.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ")}`);
        }
        if (this.wantRows) sql += " returning *";
        const out = await this.exec(sql, p.list);
        return this.wantRows ? shape(out, null) : { data: null, error: null };
      }
      case "update": {
        const keys = Object.keys(this.payload);
        if (!keys.length) return { data: null, error: null };
        const set = keys.map((k) => `${q(k)} = ${this.cell(this.payload[k], types.get(k), p)}`).join(", ");
        let sql = `update ${t} set ${set}${this.where(p)}`;
        if (this.wantRows) sql += " returning *";
        const out = await this.exec(sql, p.list);
        return this.wantRows ? shape(out, null) : { data: null, error: null };
      }
      case "delete": {
        if (!this.filters.length) throw new Error(`refusing unfiltered delete on ${this.table}`);
        await this.exec(`delete from ${t}${this.where(p)}`, p.list);
        return { data: null, error: null };
      }
      default: throw new Error("query has no operation");
    }
  }

  then<A = DbResult, B = never>(ok?: ((v: DbResult) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.run().catch((e: any): DbResult => ({ data: null, error: { message: String(e?.message ?? e) } })).then(ok, no);
  }
}

export interface Db { from(table: string): Query }

export function createDb(exec: Exec): Db {
  let meta: Promise<Meta> | null = null;
  const metaP = () => (meta ??= loadMeta(exec).catch((e) => { meta = null; throw e; }));
  return { from: (table) => new Query(exec, metaP, table) };
}

let _db: Db | null = null;
/** Server-only client. Reads DATABASE_URL (Neon pooled connection string). */
export function db(): Db {
  if (!_db) {
    const sql = neon(env("DATABASE_URL"));
    _db = createDb(async (text, params) => (await sql.query(text, params as any[])) as any[]);
  }
  return _db;
}

export function must<T>(r: { data: T | null; error: any }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}
