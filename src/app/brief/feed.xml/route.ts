import { loadBrief } from "@/lib/brief";
export const dynamic = "force-dynamic";
const x = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
export async function GET() {
  const { brief } = await loadBrief();
  const base = process.env.PUBLIC_BASE_URL ?? "";
  const body = brief.domains.map((d) => `<h3>${x(d.name)}</h3>` + d.items.map((c) => `<p><a href="${c.url}">${x(c.title)}</a>: ${x(c.claims.map((k) => k.claim).join(" "))}</p>`).join("")).join("");
  return new Response(`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Research Pulse</title><id>${base}/brief/feed.xml</id><updated>${brief.generated_at}</updated><entry><title>Research Pulse ${x(brief.week_key)}</title><id>${base}/brief/${x(brief.week_key)}</id><updated>${brief.generated_at}</updated><link href="${base}/brief/${x(brief.week_key)}"/><content type="html">${x(body)}</content></entry></feed>`, { headers: { "content-type": "application/atom+xml; charset=utf-8" } });
}
