export function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env var ${name}`);
}
export const opt = (n: string) => process.env[n]?.trim() || undefined;

export function modelChain(): string[] {
  let chain = env("GEMINI_MODEL_CHAIN", "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.ALLOW_FLASH_LITE === "0") chain = chain.filter((m) => !/lite/i.test(m));
  return chain;
}
export const limits = () => ({
  perRun: +(opt("MAX_LLM_CALLS_PER_RUN") ?? 80),
  perWeek: +(opt("MAX_LLM_CALLS_PER_WEEK") ?? 150),
});
// Words in the plain-text brief. 225 wpm * 8 min = 1800; keep headroom under the 10 minute rule.
export const WORD_BUDGET = 1900;
export const WPM = 225;
export const MAX_PER_DOMAIN = 5;
export const MERIT_FLOOR = 3;
