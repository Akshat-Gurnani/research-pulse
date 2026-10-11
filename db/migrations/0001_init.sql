-- Research Pulse schema (plain Postgres; developed against Neon). RLS is ON for every table with NO policies,
-- so any non-owner role reaches nothing. All reads and writes go through the server via DATABASE_URL.

create table domains (
  id bigint generated always as identity primary key,
  slug text unique not null,
  name text not null,
  arxiv_categories text[] not null,
  phrases text[] not null default '{}',
  exclude_phrases text[] not null default '{}',
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
create table settings_history (
  id bigint generated always as identity primary key,
  domains_snapshot jsonb not null, changed_at timestamptz not null default now(), actor text
);
create table recipients (
  id bigint generated always as identity primary key,
  email text unique not null, timezone text not null default 'Asia/Kolkata',
  unsubscribed_at timestamptz, suppressed boolean not null default false, consent_at timestamptz default now()
);
create table config_kv (key text primary key, value jsonb not null);

create table raw_fetch (
  id bigint generated always as identity primary key,
  source text not null, query_hash text, fetched_at timestamptz not null default now(),
  http_status int, n_items int, valid boolean not null default true, reject_reason text
);
create table papers (
  arxiv_id text primary key,
  title text not null, abstract text not null, authors text[] not null default '{}',
  categories text[] not null default '{}', primary_category text,
  published timestamptz not null, updated timestamptz, latest_version int not null default 1,
  first_seen_at timestamptz not null default now(),
  announce_slot timestamptz not null,
  injection_flag boolean not null default false, flag_reason text
);
create index papers_slot_idx on papers (announce_slot);
create table signals (
  arxiv_id text not null, source text not null, upvotes int, points int, linked_repos int,
  fetched_at timestamptz not null default now(), primary key (arxiv_id, source)
);
create table paper_scores (
  arxiv_id text not null, prompt_version text not null, model_id text, model_version text,
  merit int not null, best_domain text not null, evidence_quote text,
  created_at timestamptz not null default now(), primary key (arxiv_id, prompt_version)
);
create table summaries (
  arxiv_id text not null, prompt_version text not null, model_id text,
  json jsonb not null, verified boolean not null default false, created_at timestamptz not null default now(),
  primary key (arxiv_id, prompt_version)
);
create table featured (arxiv_id text primary key, first_week_key text not null, last_week_key text not null);

create table trigger_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(), source text not null, route text not null,
  accepted boolean not null, reject_reason text, week_key text
);
create table brief_runs (
  week_key text primary key, window_start timestamptz, window_end timestamptz, window_label text,
  status text not null default 'pending', ladder_level int not null default 0, partial boolean not null default false,
  late_batch boolean not null default false, started_at timestamptz, published_at timestamptz,
  lease_expires timestamptz, calls_used int not null default 0, word_count int, reading_minutes int,
  error_summary text, snapshot jsonb
);
create table domain_runs (
  week_key text not null, domain_id bigint not null, status text not null default 'pending', attempts int not null default 0,
  lease_expires timestamptz, error_class text, model_used text, finished_at timestamptz, result_json jsonb,
  primary key (week_key, domain_id)
);
create table llm_calls (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  week_key text, purpose text, model_id text, model_version text, status text, error_class text,
  prompt_tokens int, output_tokens int, thought_tokens int, latency_ms int
);
create index llm_calls_week_idx on llm_calls (week_key);
create table brief_items (
  week_key text not null, domain_id bigint not null, rank int not null, arxiv_id text not null,
  breakdown jsonb, card jsonb not null, carried_over boolean not null default false,
  primary key (week_key, arxiv_id)
);
create table send_log (
  id bigint generated always as identity primary key,
  week_key text not null, recipient_id bigint not null, channel text not null, provider text,
  provider_message_id text, status text not null default 'pending', attempts int not null default 0,
  last_error text, created_at timestamptz not null default now(), sent_at timestamptz,
  unique (week_key, recipient_id, channel)
);
create table source_health (
  source text primary key, last_ok_at timestamptz, last_fail_at timestamptz,
  consecutive_failures int not null default 0, last_error_class text, baseline_median int
);
create table heartbeats (name text primary key, at timestamptz not null default now());

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

insert into domains (slug, name, arxiv_categories, phrases, sort) values
 ('ai-agents','AI agents', '{cs.AI,cs.MA,cs.CL}', '{agent,agentic,tool use,multi-agent,planning}', 1),
 ('rag','Retrieval-augmented generation', '{cs.IR,cs.CL,cs.AI}', '{retrieval-augmented,RAG,retrieval,grounding,reranking}', 2),
 ('code-llms','LLMs for code', '{cs.SE,cs.CL,cs.LG}', '{code generation,code LLM,program synthesis,software engineering agent,SWE-bench}', 3),
 ('cv-industrial','Computer vision for industrial applications', '{cs.CV,eess.IV,cs.RO}', '{industrial,defect detection,manufacturing,inspection,anomaly detection}', 4)
on conflict do nothing;
