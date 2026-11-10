-- ICFR Hub: AI assistant providers. API keys live here and are read only by the icfr-ai edge function
-- (service role). Row-level security is on with no policies, so no browser can read this table.
create table public.icfr_ai_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('anthropic', 'openai')),  -- wire format: Anthropic Messages API or OpenAI-compatible chat completions
  base_url text,
  model text not null,
  api_key text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.icfr_ai_providers enable row level security;
revoke all on public.icfr_ai_providers from anon, authenticated;
create unique index icfr_ai_one_active on public.icfr_ai_providers (is_active) where is_active;
