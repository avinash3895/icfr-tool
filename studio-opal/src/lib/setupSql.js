// Runs in the USER's own Supabase project. Safe to run more than once.
export const SCHEMA_VERSION = "2";

export const SETUP_SQL = `
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.studio_conversations (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_messages (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  conversation_id uuid not null references public.studio_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists studio_messages_conv_idx on public.studio_messages (conversation_id, created_at);

create table if not exists public.studio_agents (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  name text not null default 'New agent',
  graph jsonb not null default '{}'::jsonb,
  chat jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_settings (
  owner uuid primary key default auth.uid(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_meta (
  key text primary key,
  value text
);
insert into public.studio_meta (key, value) values ('schema_version', '${SCHEMA_VERSION}')
  on conflict (key) do update set value = excluded.value;

alter table public.studio_conversations enable row level security;
alter table public.studio_messages enable row level security;
alter table public.studio_agents enable row level security;
alter table public.studio_settings enable row level security;
alter table public.studio_meta enable row level security;

grant select, insert, update, delete on public.studio_conversations, public.studio_messages,
  public.studio_agents, public.studio_settings to authenticated;
grant select on public.studio_meta to authenticated;

drop policy if exists "studio own rows" on public.studio_conversations;
create policy "studio own rows" on public.studio_conversations for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "studio own rows" on public.studio_messages;
create policy "studio own rows" on public.studio_messages for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "studio own rows" on public.studio_agents;
create policy "studio own rows" on public.studio_agents for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "studio own rows" on public.studio_settings;
create policy "studio own rows" on public.studio_settings for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "studio read meta" on public.studio_meta;
create policy "studio read meta" on public.studio_meta for select to authenticated using (true);

create table if not exists public.studio_chat_counters (
  owner uuid primary key,
  chat_seq integer not null default 0
);
alter table public.studio_chat_counters enable row level security;
revoke all on public.studio_chat_counters from anon, authenticated;

alter table public.studio_conversations add column if not exists chat_no integer;

with numbered as (
  select id, row_number() over (partition by owner order by created_at, id) as n
  from public.studio_conversations
  where chat_no is null
)
update public.studio_conversations c set chat_no = numbered.n
from numbered where c.id = numbered.id;

insert into public.studio_chat_counters (owner, chat_seq)
select owner, max(chat_no) from public.studio_conversations
group by owner
on conflict (owner) do update set chat_seq = greatest(public.studio_chat_counters.chat_seq, excluded.chat_seq);

create or replace function public.studio_set_chat_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.chat_no is null then
    insert into public.studio_chat_counters (owner, chat_seq) values (new.owner, 1)
    on conflict (owner) do update set chat_seq = public.studio_chat_counters.chat_seq + 1
    returning chat_seq into new.chat_no;
  end if;
  return new;
end $$;
revoke execute on function public.studio_set_chat_no() from public, anon, authenticated;

drop trigger if exists studio_chat_no on public.studio_conversations;
create trigger studio_chat_no before insert on public.studio_conversations
for each row execute function public.studio_set_chat_no();

create unique index if not exists studio_conversations_owner_chat_no on public.studio_conversations (owner, chat_no);

insert into storage.buckets (id, name, public) values ('studio-assets', 'studio-assets', false)
  on conflict (id) do nothing;
drop policy if exists "studio assets read" on storage.objects;
create policy "studio assets read" on storage.objects for select to authenticated
  using (bucket_id = 'studio-assets' and owner = auth.uid());
drop policy if exists "studio assets write" on storage.objects;
create policy "studio assets write" on storage.objects for insert to authenticated
  with check (bucket_id = 'studio-assets');
drop policy if exists "studio assets delete" on storage.objects;
create policy "studio assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'studio-assets' and owner = auth.uid());
`;
