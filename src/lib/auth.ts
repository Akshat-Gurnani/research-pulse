import { createHmac, timingSafeEqual } from "node:crypto";
import { opt } from "./config";
import { db } from "./db";

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Bearer-secret check for cron routes. Fails closed if no secret is configured. Accepts the previous secret during rotation. */
export function checkBearer(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok) return false;
  const secrets = [opt("CRON_SECRET"), opt("CRON_SECRET_PREVIOUS")].filter(Boolean) as string[];
  return secrets.some((s) => safeEq(tok, s));
}

export function triggerSource(req: Request): string {
  const ua = req.headers.get("user-agent") ?? "";
  if (/vercel-cron/i.test(ua)) return "vercel";
  const s = req.headers.get("x-trigger-source");
  if (s && /^[a-z0-9_-]{1,20}$/i.test(s)) return s;
  return "unknown";
}

export async function logTrigger(source: string, route: string, accepted: boolean, reason?: string, weekKey?: string) {
  try { await db().from("trigger_events").insert({ source, route, accepted, reject_reason: reason ?? null, week_key: weekKey ?? null }); } catch { /* logging must never break a run */ }
}

// ---- admin session: HMAC-signed cookie, checked in middleware AND in every mutating handler ----
const COOKIE = "rp_admin";
const sign = (v: string) => createHmac("sha256", opt("SESSION_SECRET") ?? "").update(v).digest("hex");

export function makeSession(): string {
  const exp = Date.now() + 8 * 3600_000;
  return `${exp}.${sign(String(exp))}`;
}
export function verifySession(cookieHeader: string | null): boolean {
  if (!opt("SESSION_SECRET")) return false;
  const m = new RegExp(`${COOKIE}=([^;]+)`).exec(cookieHeader ?? "");
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  return !!exp && !!sig && +exp > Date.now() && safeEq(sig, sign(exp));
}
export const sessionCookie = (v: string) => `${COOKIE}=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${8 * 3600}`;
export function checkAdmin(req: Request): boolean { return verifySession(req.headers.get("cookie")); }
export function checkPassword(pw: string): boolean { const p = opt("ADMIN_PASSWORD"); return !!p && safeEq(pw, p); }
export function sameOrigin(req: Request): boolean {
  const o = req.headers.get("origin"); if (!o) return false;
  try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
}
