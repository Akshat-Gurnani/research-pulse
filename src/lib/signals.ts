// Attention signals are optional. Any failure returns nothing; the scorer treats missing as neutral (50), never 0.
export interface Signal { arxiv_id: string; source: "hf" | "hn"; upvotes?: number; points?: number; linked_repos?: number }

async function inBatches<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

export async function hfDaily(dates: string[]): Promise<Signal[]> {
  const perDate = await inBatches(dates, 7, async (d): Promise<Signal[]> => {
    try {
      const r = await fetch(`https://huggingface.co/api/daily_papers?date=${d}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      const arr = (await r.json()) as any[];
      return arr.filter((it) => it?.paper?.id).map((it) => ({ arxiv_id: String(it.paper.id), source: "hf" as const, upvotes: it.paper.upvotes ?? 0, linked_repos: it.paper.githubRepo ? 1 : 0 }));
    } catch { return []; /* undocumented endpoint: ignore */ }
  });
  return perDate.flat();
}

export async function hnFor(ids: string[], max = 40): Promise<Signal[]> {
  const found = await inBatches(ids.slice(0, max), 8, async (id): Promise<Signal | null> => {
    try {
      const r = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`arxiv.org/abs/${id}`)}&tags=story&restrictSearchableAttributes=url&hitsPerPage=3`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const j = (await r.json()) as any;
      const best = Math.max(0, ...(j.hits ?? []).filter((h: any) => String(h.url ?? "").includes(id)).map((h: any) => h.points ?? 0));
      return best > 0 ? { arxiv_id: id, source: "hn", points: best } : null;
    } catch { return null; }
  });
  return found.filter((x): x is Signal => x !== null);
}
