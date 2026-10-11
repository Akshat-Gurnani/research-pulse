export interface BriefCard {
  arxiv_id: string; title: string; url: string; authors: string[]; published: string;
  claims: { claim: string; quote: string }[]; why_it_matters: string; caveat: string;
  evidence_type: string; action: string; score?: number; carried_over?: boolean; flagged?: boolean;
}
export interface BriefDomain { id: number; name: string; items: BriefCard[]; note?: string }
export interface Brief {
  week_key: string; label: string; generated_at: string; ladder_level: 0 | 1 | 2 | 3;
  partial: boolean; late_batch?: boolean; domains: BriefDomain[];
  word_count: number; reading_minutes: number; models: string[]; notes: string[];
  origin?: "db" | "blob" | "seed";
}
export interface DomainRow {
  id: number; slug: string; name: string; arxiv_categories: string[]; phrases: string[]; exclude_phrases: string[]; active: boolean; sort: number;
}
export const arxivUrl = (id: string) => `https://arxiv.org/abs/${id}`;
