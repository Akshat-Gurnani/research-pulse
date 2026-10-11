// Minimal in-memory stand-in for the slice of supabase-js that src/lib/pipeline.ts uses.
// Each query executes atomically when awaited, which matches how a single SQL statement behaves,
// so concurrent callers interleave only at `await` boundaries (like two real requests would).
type Row = Record<string, any>;
type Result = { data: any; error: { message: string } | null; count?: number | null };

const PK: Record<string, string[]> = {
  papers: ["arxiv_id"], source_health: ["source"], heartbeats: ["name"], brief_runs: ["week_key"],
  paper_scores: ["arxiv_id", "prompt_version"], summaries: ["arxiv_id", "prompt_version"], featured: ["arxiv_id"],
  signals: ["arxiv_id", "source"], send_log: ["week_key", "recipient_id", "channel"], domains: ["slug"],
};
const DEFAULTS: Record<string, () => Row> = {
  brief_runs: () => ({ status: "pending", lease_expires: null, snapshot: null, published_at: null }),
  send_log: () => ({ status: "pending", attempts: 0, created_at: new Date().toISOString() }),
};

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
function cond(s: string): (r: Row) => boolean {
  if (s.startsWith("and(") && s.endsWith(")")) { const fs = splitTop(s.slice(4, -1)).map(cond); return (r) => fs.every((f) => f(r)); }
  const m = /^(\w+)\.(eq|lt|gt|in)\.(.*)$/.exec(s);
  if (!m) throw new Error(`fakedb: unsupported or() clause: ${s}`);
  const [, col, op, val] = m;
  if (op === "in") { const set = val.replace(/^\(|\)$/g, "").split(","); return (r) => set.includes(String(r[col])); }
  if (op === "eq") return (r) => String(r[col]) === val;
  if (op === "lt") return (r) => r[col] != null && String(r[col]) < val;
  return (r) => r[col] != null && String(r[col]) > val;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  private seq = 0;
  rows(name: string): Row[] { return (this.tables[name] ??= []); }
  nextId() { return ++this.seq; }
  from(name: string) { return new Query(this, name); }
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" | null = null;
  private filters: ((r: Row) => boolean)[] = [];
  private payload: any; private opts: any = {};
  private wantRows = false; private head = false; private wantCount = false;
  private lim?: number; private ord?: { col: string; asc: boolean }; private mode: "many" | "maybe" | "single" = "many";
  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, o?: { count?: string; head?: boolean }) {
    if (this.op === null) this.op = "select"; else this.wantRows = true;
    if (o?.count) this.wantCount = true;
    if (o?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = rows; this.opts = o; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: null) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  match(o: Row) { this.filters.push((r) => Object.entries(o).every(([k, v]) => r[k] === v)); return this; }
  or(s: string) { const fs = splitTop(s).map(cond); this.filters.push((r) => fs.some((f) => f(r))); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.ord = { col, asc: o.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }

  private run(): Result {
    const t = this.db.rows(this.table);
    const matches = () => t.filter((r) => this.filters.every((f) => f(r)));
    const shape = (rows: Row[]): Result => {
      let out = rows.map((r) => ({ ...r }));
      if (this.ord) { const { col, asc } = this.ord; out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.lim != null) out = out.slice(0, this.lim);
      if (this.mode === "many") return { data: out, error: null, count: this.wantCount ? rows.length : null };
      if (this.mode === "single" && out.length !== 1) return { data: null, error: { message: "single row expected" } };
      return { data: out[0] ?? null, error: null };
    };
    switch (this.op) {
      case "select": {
        const r = shape(matches());
        return this.head ? { data: null, error: null, count: r.count } : r;
      }
      case "insert": {
        const rows = ([] as Row[]).concat(this.payload);
        const key = PK[this.table];
        const made: Row[] = [];
        for (const row of rows) {
          if (key && t.some((x) => key.every((k) => x[k] === row[k]))) return { data: null, error: { message: `duplicate key on ${this.table}` } };
          const r = { id: this.db.nextId(), ...(DEFAULTS[this.table]?.() ?? {}), ...row };
          t.push(r); made.push(r);
        }
        return this.wantRows ? shape(made) : { data: null, error: null };
      }
      case "upsert": {
        const rows = ([] as Row[]).concat(this.payload);
        const key = this.opts.onConflict ? String(this.opts.onConflict).split(",") : PK[this.table];
        if (!key) throw new Error(`fakedb: no conflict key known for ${this.table}`);
        const touched: Row[] = [];
        for (const row of rows) {
          const ex = t.find((x) => key.every((k) => String(x[k]) === String(row[k])));
          if (ex) { if (!this.opts.ignoreDuplicates) { Object.assign(ex, row); touched.push(ex); } }
          else { const r = { id: this.db.nextId(), ...(DEFAULTS[this.table]?.() ?? {}), ...row }; t.push(r); touched.push(r); }
        }
        return this.wantRows ? shape(touched) : { data: null, error: null };
      }
      case "update": {
        const hit = matches();
        hit.forEach((r) => Object.assign(r, this.payload));
        return this.wantRows ? shape(hit) : { data: null, error: null };
      }
      case "delete": {
        const hit = new Set(matches());
        this.db.tables[this.table] = t.filter((r) => !hit.has(r));
        return { data: null, error: null };
      }
      default: throw new Error("fakedb: query has no operation");
    }
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, no);
  }
}
