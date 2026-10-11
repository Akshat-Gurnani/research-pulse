import nodemailer from "nodemailer";
import { Resend } from "resend";
import { opt } from "./config";
import type { Brief } from "./types";
import { tidyClaim } from "./format";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function renderEmail(b: Brief, baseUrl: string, stale: boolean) {
  const subject = `${stale ? "[stale] " : ""}Research Pulse - ${b.week_key} (${b.reading_minutes} min)`;
  const link = `${baseUrl}/brief/${b.week_key}`;
  const txt: string[] = [`Research Pulse ${b.week_key}`, b.label, `About ${b.reading_minutes} min read. View online: ${link}`, ""];
  let html = `<div style="max-width:600px;margin:0 auto;font:15px/1.5 Georgia,serif;color:#1d2a26"><h1 style="font-weight:400">Research Pulse <i>${esc(b.week_key)}</i></h1><p style="color:#4a5851">${esc(b.label)}. About ${b.reading_minutes} min read. <a href="${link}">View in browser</a></p>`;
  if (stale) html += `<p style="background:#fff3d6;padding:8px">This is the last good brief; this week's run did not complete.</p>`;
  for (const d of b.domains) {
    txt.push(d.name.toUpperCase());
    html += `<h2 style="font-size:17px;border-bottom:1px solid #ddd">${esc(d.name)}</h2>`;
    if (!d.items.length) { txt.push(d.note ?? "Nothing cleared the bar this week."); html += `<p><i>${esc(d.note ?? "Nothing cleared the bar this week.")}</i></p>`; }
    for (const c of d.items) {
      txt.push(`- ${c.title} [${c.action}]`, ...c.claims.map((x) => `  - ${tidyClaim(x.claim)}`), `  Why: ${c.why_it_matters}`, `  Caveat: ${c.caveat}`, `  ${c.url}`);
      html += `<p><b><a href="${c.url}">${esc(c.title)}</a></b> <span style="color:#7a5c3e">[${esc(c.action)}]</span><br>${c.claims.map((x) => `&bull; ${esc(tidyClaim(x.claim))}`).join("<br>")}<br><i>Why:</i> ${esc(c.why_it_matters)}<br><i>Caveat:</i> ${esc(c.caveat)}</p>`;
    }
    txt.push("");
  }
  html += `<p style="font-size:12px;color:#777">Summaries are generated from abstracts only by Gemini Flash and checked against them. Not peer reviewed.</p></div>`;
  return { subject, html, text: txt.join("\n") };
}

export interface Mail { to: string; subject: string; html: string; text: string }
export interface Provider { name: string; send: (m: Mail) => Promise<string> }

export function providers(): Provider[] {
  const out: Provider[] = [];
  if (opt("RESEND_API_KEY")) out.push({
    name: "resend",
    send: async (m) => {
      const r = await new Resend(opt("RESEND_API_KEY")).emails.send({ from: opt("MAIL_FROM") ?? "Research Pulse <onboarding@resend.dev>", to: m.to, subject: m.subject, html: m.html, text: m.text });
      if (r.error) throw new Error(`resend: ${r.error.name} ${r.error.message}`);
      return r.data?.id ?? "";
    },
  });
  if (opt("GMAIL_USER") && opt("GMAIL_APP_PASSWORD")) out.push({
    name: "gmail-smtp",
    send: async (m) => {
      const t = nodemailer.createTransport({ service: "gmail", auth: { user: opt("GMAIL_USER"), pass: opt("GMAIL_APP_PASSWORD") } });
      const r = await t.sendMail({ from: `Research Pulse <${opt("GMAIL_USER")}>`, to: m.to, subject: m.subject, html: m.html, text: m.text });
      return r.messageId;
    },
  });
  return out;
}

/** Try providers in order; return the first success. Failure of one provider never blocks the web brief. */
export async function sendWithFailover(m: Mail, ps: Provider[] = providers()): Promise<{ provider: string; id: string }> {
  const errs: string[] = [];
  for (const p of ps) {
    try { return { provider: p.name, id: await p.send(m) }; } catch (e: any) { errs.push(`${p.name}: ${e.message}`); }
  }
  throw new Error(errs.length ? errs.join(" | ") : "no email provider configured");
}
