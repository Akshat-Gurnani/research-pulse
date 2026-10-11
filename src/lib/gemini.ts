import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env, modelChain } from "./config";
import { sleep } from "./time";

export interface GenRequest { system: string; user: string; jsonSchema: unknown; maxOutputTokens: number }
export interface GenResponse { text: string; modelVersion?: string; finishReason?: string; promptTokens?: number; outputTokens?: number; thoughtTokens?: number }
export type Generate = (model: string, req: GenRequest) => Promise<GenResponse>;

export type ErrClass = "retry" | "skip-model" | "fatal";
export class GeminiError extends Error { constructor(public cls: ErrClass, public status: number | undefined, msg: string) { super(msg); } }

/** 408/429(rate)/500/503 retry; daily-quota 429 and 404 skip to the next model; 400/401/402/403 are fatal. */
export function classify(status: number | undefined, message: string): ErrClass {
  const m = message.toLowerCase();
  if (status === 429) return /per ?day|daily|requestsperday|billing/.test(m) ? "skip-model" : "retry";
  if (status === 404) return "skip-model";
  if (status === 408 || (status !== undefined && status >= 500)) return "retry";
  if (status === 400 || status === 401 || status === 402 || status === 403) return "fatal";
  return "retry";
}

export const realGenerate: Generate = async (model, req) => {
  const ai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
  try {
    const r = await ai.models.generateContent({
      model,
      contents: req.user,
      config: {
        systemInstruction: req.system,
        responseMimeType: "application/json",
        responseJsonSchema: req.jsonSchema,
        maxOutputTokens: req.maxOutputTokens, // thinking tokens count toward this, so keep it generous
        thinkingConfig: { thinkingLevel: "low" },
        // No tools, no search grounding, no URL context. Do not set temperature/top_p/top_k (3.8 migration guide).
        abortSignal: AbortSignal.timeout(90_000),
      } as any,
    });
    const text = r.text ?? "";
    const fr = r.candidates?.[0]?.finishReason as string | undefined;
    return {
      text, finishReason: fr, modelVersion: (r as any).modelVersion,
      promptTokens: r.usageMetadata?.promptTokenCount, outputTokens: r.usageMetadata?.candidatesTokenCount,
      thoughtTokens: (r.usageMetadata as any)?.thoughtsTokenCount,
    };
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : undefined;
    throw new GeminiError(classify(status, String(e?.message ?? e)), status, String(e?.message ?? e));
  }
};

export interface Budget {
  perRun: number; perWeekRemaining: () => Promise<number>;
  used: number;
  log: (rec: { purpose: string; model: string; modelVersion?: string; status: string; errorClass?: string; promptTokens?: number; outputTokens?: number; thoughtTokens?: number; latencyMs: number }) => Promise<void>;
}

export class BudgetExceeded extends Error {}

export interface CallOpts<T> {
  purpose: string; system: string; user: string; schema: z.ZodType<T>; maxOutputTokens?: number;
  chain?: string[]; generate?: Generate; budget?: Budget; backoffBaseMs?: number;
}
export interface CallResult<T> { data: T; model: string; modelVersion?: string; fallbackDepth: number }

/** Try each model in the chain; per model up to N retries with jittered backoff; enforce the call budget. */
export async function callJson<T>(o: CallOpts<T>): Promise<CallResult<T>> {
  const chain = o.chain ?? modelChain();
  const gen = o.generate ?? realGenerate;
  const jsonSchema = z.toJSONSchema(o.schema);
  const base = o.backoffBaseMs ?? 1000;
  let lastErr: unknown;
  for (let depth = 0; depth < chain.length; depth++) {
    const model = chain[depth];
    const attempts = depth <= 1 ? 3 : depth === 2 ? 2 : 1;
    for (let a = 0; a < attempts; a++) {
      if (o.budget) {
        if (o.budget.used >= o.budget.perRun || (await o.budget.perWeekRemaining()) <= 0) throw new BudgetExceeded(`call budget exhausted at ${o.purpose}`);
        o.budget.used++;
      }
      const t0 = Date.now();
      try {
        const r = await gen(model, { system: o.system, user: o.user, jsonSchema, maxOutputTokens: o.maxOutputTokens ?? 8192 });
        if (!r.text) throw new GeminiError("retry", undefined, `empty candidate (finishReason=${r.finishReason})`);
        let parsed: T;
        try { parsed = o.schema.parse(JSON.parse(r.text)); }
        catch (pe) { throw new GeminiError("retry", undefined, `invalid JSON/schema: ${String(pe).slice(0, 200)}`); }
        await o.budget?.log({ purpose: o.purpose, model, modelVersion: r.modelVersion, status: "ok", promptTokens: r.promptTokens, outputTokens: r.outputTokens, thoughtTokens: r.thoughtTokens, latencyMs: Date.now() - t0 });
        return { data: parsed, model, modelVersion: r.modelVersion, fallbackDepth: depth };
      } catch (e: any) {
        lastErr = e;
        const cls: ErrClass = e instanceof GeminiError ? e.cls : "retry";
        await o.budget?.log({ purpose: o.purpose, model, status: "error", errorClass: `${cls}:${e.status ?? ""}`, latencyMs: Date.now() - t0 });
        if (cls === "fatal") throw e;
        if (cls === "skip-model") break;
        if (a < attempts - 1) await sleep(base * 2 ** a * (0.75 + Math.random() * 0.5));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all models failed");
}
