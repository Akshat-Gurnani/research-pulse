import { NextResponse } from "next/server";
import { checkAdmin, sameOrigin } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { DomainList, ALLOWED_CATEGORIES } from "@/lib/schemas";

export const dynamic = "force-dynamic";
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export async function GET(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(must(await db().from("domains").select("*").order("sort"), "domains"));
}

/** Replace the domain list. Never triggers processing; only validates and stores. */
export async function PUT(req: Request) {
  if (!checkAdmin(req) || !sameOrigin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = DomainList.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const bad = parsed.data.flatMap((d) => d.arxiv_categories).filter((c) => !ALLOWED_CATEGORIES.has(c));
  if (bad.length) return NextResponse.json({ error: `unknown categories: ${[...new Set(bad)].join(", ")}`, allowed: [...ALLOWED_CATEGORIES] }, { status: 400 });
  const slugs = parsed.data.map((d) => slugify(d.name));
  if (new Set(slugs).size !== slugs.length) return NextResponse.json({ error: "duplicate domain names" }, { status: 400 });
  const before = (await db().from("domains").select("*")).data ?? [];
  await db().from("settings_history").insert({ domains_snapshot: before, actor: "admin" });
  const rows = parsed.data.map((d, i) => ({ slug: slugs[i], name: d.name, arxiv_categories: d.arxiv_categories, phrases: d.phrases, exclude_phrases: d.exclude_phrases, active: d.active, sort: i + 1, updated_at: new Date().toISOString() }));
  must(await db().from("domains").upsert(rows, { onConflict: "slug" }), "save domains");
  const stale = (before as any[]).map((b) => b.slug).filter((s) => !slugs.includes(s));
  if (stale.length) await db().from("domains").update({ active: false }).in("slug", stale); // soft-remove, history stays valid
  return NextResponse.json({ ok: true, count: rows.length });
}
