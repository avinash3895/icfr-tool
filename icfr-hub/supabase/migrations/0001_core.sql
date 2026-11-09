-- ICFR Hub: core schema
-- Entities -> Processes (each with its own RCM / walkthrough / test column templates) -> Controls (RCM rows)
-- Per fiscal year: one Walkthrough per control, Tests per testing period.
-- The RCM is maintained by admins (finance) only, no sign-off needed.
-- Walkthroughs and tests follow a sign-off flow:
--   draft/returned --(responsible submits)--> pending_manager --(manager)--> pending_finance --(admin)--> approved
--   the manager or an admin can send back (returned); an admin can reopen an approved record.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'user' check (role in ('admin','user','viewer')),
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

-- ---------------------------------------------------------------- settings
-- key 'sample_matrix': { "risks": ["Low","Medium","High"], "sizes": { "<frequency>": { "<risk>": n } } }
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.app_settings (key, value) values ('sample_matrix', '{
  "risks": ["Low", "Medium", "High"],
  "sizes": {
    "Annual":               {"Low": 1,  "Medium": 1,  "High": 1},
    "Semi-annual":          {"Low": 1,  "Medium": 1,  "High": 2},
    "Quarterly":            {"Low": 2,  "Medium": 3,  "High": 4},
    "Monthly":              {"Low": 2,  "Medium": 3,  "High": 5},
    "Weekly":               {"Low": 5,  "Medium": 10, "High": 15},
    "Daily":                {"Low": 25, "Medium": 40, "High": 60},
    "Multiple times a day": {"Low": 25, "Medium": 60, "High": 100},
    "Event-driven":         {"Low": 25, "Medium": 40, "High": 60}
  }
}');

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

-- Column templates of a process: sheet 'rcm', 'walkthrough' or 'test'.
-- `key` never changes (data is stored under it), `label` can be renamed.
-- System columns drive the app. They can be renamed and reordered but not deleted.
create table public.process_columns (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes(id) on delete cascade,
  sheet text not null default 'rcm' check (sheet in ('rcm','walkthrough','test')),
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
  unique (process_id, sheet, key)
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
  risk_level text,
  sample_size int,
  sample_size_manual boolean not null default false,  -- true = typed in by an admin, not from the master grid
  responsible_emails text[] not null default '{}',
  manager_emails text[] not null default '{}',
  is_key boolean,
  archived boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
-- a Control ID is unique among the active controls of a process (archived controls keep their old ID)
create unique index controls_ref_active on public.controls (process_id, lower(control_ref)) where not archived;
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
  sample_size_manual boolean not null default false,
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

-- ---------------------------------------------------------------- access, trail, files, email
-- A grant opens an entity (process_id null), one process (control_id null) or one control.
-- can_edit lets the user prepare/submit walkthroughs and tests in that scope like the responsible person.
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
  record_type text not null check (record_type in ('walkthrough','test')),
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

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities(id) on delete set null,
  to_emails text[] not null,
  cc_emails text[] not null default '{}',
  subject text not null,
  processes text[] not null default '{}',
  control_count int not null default 0,
  status text not null default 'sent',
  error text,
  sent_by uuid default auth.uid(),
  sent_at timestamptz not null default now()
);
create index on public.email_log (entity_id, sent_at desc);
