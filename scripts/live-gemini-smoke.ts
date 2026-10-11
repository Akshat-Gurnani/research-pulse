// One real Gemini call through the app's own code path (callJson -> realGenerate).
// Run: npx tsx --env-file=.env.local scripts/live-gemini-smoke.ts
// Prints the model that answered, the fallback depth, and the parsed result. Never prints the API key.
import { z } from "zod";
import { callJson } from "../src/lib/gemini";
import { modelChain } from "../src/lib/config";

const Score = z.object({ results: z.array(z.object({ id: z.string(), merit: z.number().int().min(1).max(5) })) });

async function main() {
  console.log("chain:", modelChain().join(", "));
  const r = await callJson({
    purpose: "live-smoke",
    system: "Score each paper's merit 1-5 from its abstract. Return one result per id, echoing the id exactly.",
    user: "id: 2610.00001\ntitle: A\nabstract: We report a 12% gain on a benchmark.\nid: 2610.00002\ntitle: B\nabstract: Vague.",
    schema: Score,
  });
  console.log(JSON.stringify({ model: r.model, modelVersion: r.modelVersion, fallbackDepth: r.fallbackDepth, data: r.data }, null, 2));
}

main().catch((e) => {
  console.error("FAILED:", e?.status ?? "", String(e?.message ?? e).slice(0, 500));
  process.exit(1);
});
