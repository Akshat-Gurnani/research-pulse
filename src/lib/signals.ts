// Attention signals are optional. Any failure returns nothing; the scorer treats missing as neutral (50), never 0.
export interface Signal { arxiv_id: string; source: "hf" | "hn"; upvotes?: number; points?: number; linked_repos?: number }

export async function hfDaily(dates: string[]): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const d of dates) {
    try {
      const r = await fetch(`https://huggingface.co/api/daily_papers?date=${d}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const arr = (await r.json()) as any[];
      for (const it of arr) if (it?.paper?.id) out.push({ arxiv_id: String(it.paper.id), source: "hf", upvotes: it.paper.upvotes ?? 0, linked_repos: it.paper.githubRepo ? 1 : 0 });
    } catch { /* undocumented endpoint: ignore */ }
  }
  return out;
}

export async function hnFor(ids: string[], max = 40): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const id of ids.slice(0, max)) {
    try {
      const r = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`arxiv.org/abs/${id}`)}&tags=story&restrictSearchableAttributes=url&hitsPerPage=3`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const j = (await r.json()) as any;
      const best = Math.max(0, ...(j.hits ?? []).filter((h: any) => String(h.url ?? "").includes(id)).map((h: any) => h.points ?? 0));
      if (best > 0) out.push({ arxiv_id: id, source: "hn", points: best });
    } catch { /* ignore */ }
  }
  return out;
}
