import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb } from "../src/lib/db";
import { makePg, pgExec, truncateAll } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock("../src/lib/db", async (orig) => ({ ...(await orig<typeof import("../src/lib/db")>()), db: () => h.db }));
import { windowPapers } from "../src/lib/pipeline";

let pg: PGlite;
beforeAll(async () => { pg = await makePg(); h.db = createDb(pgExec(pg)); }, 60_000);
beforeEach(async () => { await truncateAll(pg); });

const START = new Date("2026-10-05T00:00:00Z"), END = new Date("2026-10-12T00:00:00Z");
async function seed(n: number, slot: string) {
  for (let i = 0; i < n; i += 400) {
    const rows = Array.from({ length: Math.min(400, n - i) }, (_, k) => ({
      arxiv_id: `${slot.slice(5, 10).replace("-", "")}.${String(i + k).padStart(5, "0")}`,
      title: "t", abstract: "a", published: "2026-10-06T00:00:00Z", announce_slot: slot,
    }));
    await h.db.from("papers").insert(rows);
  }
}

describe("windowPapers", () => {
  it("returns every in-window paper across page boundaries, with no duplicates", async () => {
    await seed(1337, "2026-10-07T00:00:00Z");
    await seed(10, "2026-10-12T00:00:00Z"); // exactly the inclusive end
    const got = await windowPapers({ startSlot: START, endSlot: END }, 500);
    expect(got).toHaveLength(1347);
    expect(new Set(got.map((p) => p.arxiv_id)).size).toBe(1347);
  });
  it("excludes the exclusive start slot and anything after the end", async () => {
    await seed(5, "2026-10-05T00:00:00Z");
    await seed(5, "2026-10-13T00:00:00Z");
    await seed(7, "2026-10-08T00:00:00Z");
    expect(await windowPapers({ startSlot: START, endSlot: END }, 3)).toHaveLength(7);
  });
  it("handles an exact multiple of the page size and an empty window", async () => {
    await seed(1000, "2026-10-07T00:00:00Z");
    expect(await windowPapers({ startSlot: START, endSlot: END }, 500)).toHaveLength(1000);
    await truncateAll(pg);
    expect(await windowPapers({ startSlot: START, endSlot: END })).toEqual([]);
  });
});
