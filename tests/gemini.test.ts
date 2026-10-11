import { describe, it, expect } from "vitest";
import { z } from "zod";
import { callJson, classify, GeminiError, BudgetExceeded, type Generate } from "@/lib/gemini";

const schema = z.object({ ok: z.boolean() });
const base = { purpose: "t", system: "s", user: "u", schema, backoffBaseMs: 1 };

describe("classify", () => {
  it("daily quota skips, rate limit retries", () => {
    expect(classify(429, "Quota exceeded: RequestsPerDay")).toBe("skip-model");
    expect(classify(429, "Too many requests per minute")).toBe("retry");
  });
  it("404 skips; 503 retries; 403 fatal", () => { expect(classify(404, "")).toBe("skip-model"); expect(classify(503, "")).toBe("retry"); expect(classify(403, "")).toBe("fatal"); });
});

describe("callJson chain", () => {
  it("falls to the next model after exhausting retries", async () => {
    const seen: string[] = [];
    const gen: Generate = async (m) => { seen.push(m); if (m === "a") throw new GeminiError("retry", 503, "high demand"); return { text: '{"ok":true}' }; };
    const r = await callJson({ ...base, chain: ["a", "b"], generate: gen });
    expect(r.model).toBe("b"); expect(r.fallbackDepth).toBe(1); expect(seen.filter((m) => m === "a").length).toBe(3);
  });
  it("skips immediately on 404", async () => {
    const seen: string[] = [];
    const gen: Generate = async (m) => { seen.push(m); if (m === "a") throw new GeminiError("skip-model", 404, "nf"); return { text: '{"ok":true}' }; };
    await callJson({ ...base, chain: ["a", "b"], generate: gen });
    expect(seen).toEqual(["a", "b"]);
  });
  it("does not retry fatal errors", async () => {
    let n = 0; const gen: Generate = async () => { n++; throw new GeminiError("fatal", 403, "no"); };
    await expect(callJson({ ...base, chain: ["a", "b"], generate: gen })).rejects.toThrow();
    expect(n).toBe(1);
  });
  it("retries on invalid JSON and empty candidates", async () => {
    let n = 0; const gen: Generate = async () => (++n < 3 ? { text: "not json" } : { text: '{"ok":true}' });
    const r = await callJson({ ...base, chain: ["a"], generate: gen });
    expect(r.data.ok).toBe(true); expect(n).toBe(3);
  });
  it("enforces the per-run budget", async () => {
    const gen: Generate = async () => { throw new GeminiError("retry", 503, "x"); };
    const budget = { perRun: 2, used: 0, perWeekRemaining: async () => 100, log: async () => {} };
    await expect(callJson({ ...base, chain: ["a", "b"], generate: gen, budget })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(budget.used).toBe(2);
  });
});
