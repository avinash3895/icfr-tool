-- ICFR Hub: core schema
-- Entities -> Processes (each with its own column template) -> Controls (RCM rows)
-- Per fiscal year: one Walkthrough per control, Tests per testing period.
-- Every RCM row, walkthrough and test follows the same sign-off flow:
--   draft/returned --(preparer submits)--> pending_manager --(manager)--> pending_finance --(finance)--> approved
--   managers and finance can send back (returned); finance can reopen an approved record.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'user' check (role in ('admin','finance','user','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    -- the very first account becomes admin; everyone else starts as 'user' (roles are set by an admin,
    -- never taken from sign-up metadata)
    case when not exists (select 1 from public.profiles where role = 'admin') then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- master data
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country text,
  currency text,
  fy_end_month int not null default 12 check (fy_end_month between 1 and 12),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  owner_name text,
  owner_email text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, code)
);

-- Column template of a process. `key` never changes (data is stored under it), `label` can be renamed.
-- System columns (system = true) drive the app: control_id, control_description, key_control,
-- frequency, test_frequency, responsible, manager. They can be renamed and reordered but not deleted.
create table public.process_columns (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null default 'text'
    check (type in ('text','longtext','number','date','select','multiselect','yesno','emails')),
  options text[] not null default '{}',
  required boolean not null default false,
  system boolean not null default false,
  help text,
  width int,
  sort int not null default 0,
  archived boolean not null default false,
  unique (process_id, key)
);

-- ---------------------------------------------------------------- RCM, walkthroughs, tests
create table public.controls (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  process_id uuid not null references public.processes(id) on delete cascade,
  control_ref text not null,
  data jsonb not null default '{}',
  -- denormalised from data for access checks, dashboards and test planning
  frequency text,
  test_frequency text,
  responsible_emails text[] not null default '{}',
  manager_emails text[] not null default '{}',
  is_key boolean,
  archived boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','pending_manager','pending_finance','approved','returned')),
  submitted_by uuid, submitted_at timestamptz,
  manager_by uuid, manager_at timestamptz,
  finance_by uuid, finance_at timestamptz,
  return_comment text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (process_id, control_ref)
);
create index on public.controls (entity_id);
create index on public.controls using gin (responsible_emails);
create index on public.controls using gin (manager_emails);

create table public.walkthroughs (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.controls(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  process_id uuid not null references public.processes(id) on delete cascade,
  fy int not null,
  data jsonb not null default '{}',
  conclusion text check (conclusion in ('Effective','Ineffective','Not concluded')),
  status text not null default 'draft'
    check (status in ('draft','pending_manager','pending_finance','approved','returned')),
  submitted_by uuid, submitted_at timestamptz,
  manager_by uuid, manager_at timestamptz,
  finance_by uuid, finance_at timestamptz,
  return_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (control_id, fy)
);
create index on public.walkthroughs (entity_id, fy);

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.controls(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  process_id uuid not null references public.processes(id) on delete cascade,
  fy int not null,
  period text not null,          -- FY, H1, H2, Q1..Q4, M01..M12
  period_start date not null,
  period_end date not null,
  sample_size int,
  exceptions int,
  data jsonb not null default '{}',
  conclusion text check (conclusion in ('Effective','Effective with exceptions','Ineffective','Not tested')),
  status text not null default 'draft'
    check (status in ('draft','pending_manager','pending_finance','approved','returned')),
  submitted_by uuid, submitted_at timestamptz,
  manager_by uuid, manager_at timestamptz,
  finance_by uuid, finance_at timestamptz,
  return_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (control_id, fy, period)
);
create index on public.tests (entity_id, fy);

-- ---------------------------------------------------------------- access, trail, files
-- A grant opens an entity (process_id null), one process (control_id null) or one control.
-- can_edit lets the user prepare/submit in that scope as if they were the responsible person.
create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  process_id uuid references public.processes(id) on delete cascade,
  control_id uuid references public.controls(id) on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.access_grants (user_id);

create table public.workflow_events (
  id bigserial primary key,
  record_type text not null check (record_type in ('control','walkthrough','test')),
  record_id uuid not null,
  control_id uuid not null,
  entity_id uuid not null,
  action text not null,
  from_status text,
  to_status text,
  comment text,
  actor uuid,
  actor_email text,
  at timestamptz not null default now()
);
create index on public.workflow_events (record_id);
create index on public.workflow_events (entity_id, at desc);

create table public.audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id uuid,
  entity_id uuid,
  action text not null,
  changed jsonb,                  -- {field: {from, to}}
  actor uuid,
  actor_email text,
  at timestamptz not null default now()
);
create index on public.audit_log (entity_id, at desc);
create index on public.audit_log (record_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('control','walkthrough','test')),
  record_id uuid not null,
  control_id uuid not null references public.controls(id) on delete cascade,
  entity_id uuid not null,
  path text not null unique,
  file_name text not null,
  size bigint,
  mime text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index on public.attachments (record_id);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  process_id uuid references public.processes(id) on delete set null,
  file_name text not null,
  path text,
  summary jsonb,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
