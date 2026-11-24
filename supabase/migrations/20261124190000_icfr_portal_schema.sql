-- ICFR portal (current app): processes, narratives, RCM controls, tests and evidence.
-- Uses its own icfr_* tables next to the older, unused tables in this project, and the existing profiles table.
-- Every signed-in user can read and edit (roles are an open point); submitted tests are locked by triggers.

create table public.icfr_processes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  owner text not null default '',
  pushed text[] not null default array['PN','RCM','TOC'],
  rcm_columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.icfr_narratives (
  process_id uuid primary key references public.icfr_processes (id) on delete cascade,
  html text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.icfr_controls (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.icfr_processes (id) on delete cascade,
  position integer not null default 0,
  "values" jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index icfr_controls_process_idx on public.icfr_controls (process_id, position);

create table public.icfr_tests (
  control_id uuid primary key references public.icfr_controls (id) on delete cascade,
  procedure text not null default '',
  exceptions text not null default '',
  conclusion text not null default 'Not tested' check (conclusion in ('Not tested', 'Effective', 'Exception')),
  submitted boolean not null default false,
  submitted_at timestamptz,
  submitted_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.icfr_evidence (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.icfr_controls (id) on delete cascade,
  attribute text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  storage_path text not null unique,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index icfr_evidence_control_idx on public.icfr_evidence (control_id);

-- Admin check for the portal (profiles.role is 'admin' or 'assignee').
create or replace function public.icfr_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

-- Only admins may change anyone's role (the existing "update own profile" rule would otherwise allow it).
create or replace function public.icfr_protect_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role and (select auth.uid()) is not null and not public.icfr_is_admin() then
    raise exception 'Only an admin can change roles.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger icfr_protect_role before update on public.profiles for each row execute function public.icfr_protect_role();

-- Keep updated_at / updated_by current.
create or replace function public.icfr_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
create trigger icfr_processes_touch before update on public.icfr_processes for each row execute function public.icfr_touch();
create trigger icfr_narratives_touch before update on public.icfr_narratives for each row execute function public.icfr_touch();
create trigger icfr_controls_touch before update on public.icfr_controls for each row execute function public.icfr_touch();
create trigger icfr_tests_touch before update on public.icfr_tests for each row execute function public.icfr_touch();

-- Submitted tests are locked: no edits, no un-submitting, no evidence changes (admins excepted).
-- Deleting the control itself still cascades, because then the parent row is already gone.
create or replace function public.icfr_lock_test() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.submitted and not public.icfr_is_admin() then
      raise exception 'This test is submitted and locked.' using errcode = 'check_violation';
    end if;
    if new.submitted and not old.submitted then
      if new.conclusion = 'Not tested' then
        raise exception 'Choose Effective or Exception before submitting.' using errcode = 'check_violation';
      end if;
      new.submitted_at := now();
      new.submitted_by := (select auth.uid());
    end if;
    return new;
  end if;
  if old.submitted and not public.icfr_is_admin()
     and exists (select 1 from public.icfr_controls c where c.id = old.control_id) then
    raise exception 'This test is submitted and locked.' using errcode = 'check_violation';
  end if;
  return old;
end $$;
create trigger icfr_tests_lock before update or delete on public.icfr_tests for each row execute function public.icfr_lock_test();

create or replace function public.icfr_lock_evidence() returns trigger
language plpgsql set search_path = '' as $$
declare cid uuid := coalesce(new.control_id, old.control_id);
begin
  if not public.icfr_is_admin() and exists (select 1 from public.icfr_tests t where t.control_id = cid and t.submitted) then
    if tg_op = 'DELETE' and not exists (select 1 from public.icfr_controls c where c.id = cid) then
      return old; -- the control was deleted: let the cascade through
    end if;
    raise exception 'This test is submitted and locked.' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger icfr_evidence_lock before insert or update or delete on public.icfr_evidence for each row execute function public.icfr_lock_evidence();

-- Row level security: signed-in users only.
alter table public.icfr_processes enable row level security;
alter table public.icfr_narratives enable row level security;
alter table public.icfr_controls enable row level security;
alter table public.icfr_tests enable row level security;
alter table public.icfr_evidence enable row level security;
create policy "icfr processes for signed-in users" on public.icfr_processes for all to authenticated using (true) with check (true);
create policy "icfr narratives for signed-in users" on public.icfr_narratives for all to authenticated using (true) with check (true);
create policy "icfr controls for signed-in users" on public.icfr_controls for all to authenticated using (true) with check (true);
create policy "icfr tests for signed-in users" on public.icfr_tests for all to authenticated using (true) with check (true);
create policy "icfr evidence for signed-in users" on public.icfr_evidence for all to authenticated using (true) with check (true);

-- Private bucket for evidence files (50 MB per file).
insert into storage.buckets (id, name, public, file_size_limit)
values ('icfr-portal-evidence', 'icfr-portal-evidence', false, 52428800)
on conflict (id) do nothing;
create policy "icfr portal evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'icfr-portal-evidence');
create policy "icfr portal evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'icfr-portal-evidence');
-- A file can be deleted only after its evidence row is gone, so locked evidence cannot be removed through Storage.
create policy "icfr portal evidence delete" on storage.objects for delete to authenticated
  using (bucket_id = 'icfr-portal-evidence' and not exists (select 1 from public.icfr_evidence e where e.storage_path = name));
