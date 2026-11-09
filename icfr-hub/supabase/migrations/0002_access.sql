-- ICFR Hub: who can see and do what

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select email from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- admin + finance: see everything, edit everything, give the final sign-off
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','finance'), false)
$$;

-- Does any grant of mine cover this control? (edit_only: only grants with can_edit)
create or replace function public.grant_covers(p_entity uuid, p_process uuid, p_control uuid, edit_only boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_grants g
    where g.user_id = auth.uid()
      and g.entity_id = p_entity
      and (g.process_id is null or g.process_id = p_process)
      and (g.control_id is null or g.control_id = p_control)
      and (not edit_only or g.can_edit)
  )
$$;

create or replace function public.can_view_control(p_control uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and (
    public.is_staff() or exists (
      select 1 from public.controls c
      where c.id = p_control and (
        public.my_email() = any(c.responsible_emails)
        or public.my_email() = any(c.manager_emails)
        or public.grant_covers(c.entity_id, c.process_id, c.id)
      )
    )
  )
$$;

-- preparer = may edit while draft/returned and submit
create or replace function public.is_preparer(p_control uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and public.my_role() <> 'viewer' and (
    public.is_staff() or exists (
      select 1 from public.controls c
      where c.id = p_control and (
        public.my_email() = any(c.responsible_emails)
        or public.grant_covers(c.entity_id, c.process_id, c.id, true)
      )
    )
  )
$$;

create or replace function public.is_manager_of(p_control uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and public.my_role() <> 'viewer' and exists (
    select 1 from public.controls c
    where c.id = p_control and public.my_email() = any(c.manager_emails)
  )
$$;

create or replace function public.can_view_process(p_process uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and (
    public.is_staff()
    or exists (select 1 from public.processes p
               where p.id = p_process and public.grant_covers(p.entity_id, p.id, null))
    or exists (select 1 from public.access_grants g where g.user_id = auth.uid() and g.process_id = p_process)
    or exists (select 1 from public.controls c
               where c.process_id = p_process
                 and (public.my_email() = any(c.responsible_emails) or public.my_email() = any(c.manager_emails)))
  )
$$;

create or replace function public.can_view_entity(p_entity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and (
    public.is_staff()
    or exists (select 1 from public.access_grants g where g.user_id = auth.uid() and g.entity_id = p_entity)
    or exists (select 1 from public.controls c
               where c.entity_id = p_entity
                 and (public.my_email() = any(c.responsible_emails) or public.my_email() = any(c.manager_emails)))
  )
$$;

-- Can I add a brand-new control to this process? (staff, or an edit grant on the whole entity/process)
create or replace function public.can_add_control(p_process uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.processes p join public.access_grants g on g.entity_id = p.entity_id
    where p.id = p_process and g.user_id = auth.uid() and g.can_edit and g.control_id is null
      and (g.process_id is null or g.process_id = p.id)
  )
$$;

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.entities enable row level security;
alter table public.processes enable row level security;
alter table public.process_columns enable row level security;
alter table public.controls enable row level security;
alter table public.walkthroughs enable row level security;
alter table public.tests enable row level security;
alter table public.access_grants enable row level security;
alter table public.workflow_events enable row level security;
alter table public.audit_log enable row level security;
alter table public.attachments enable row level security;
alter table public.uploads enable row level security;

-- profiles: everyone signed in can see the directory (names for sign-off trails); only admins change it
create policy profiles_read on public.profiles for select to authenticated using (public.my_role() is not null or id = auth.uid());
create policy profiles_admin on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy entities_read on public.entities for select to authenticated using (public.can_view_entity(id));
create policy entities_admin on public.entities for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy processes_read on public.processes for select to authenticated using (public.can_view_process(id));
create policy processes_admin on public.processes for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy columns_read on public.process_columns for select to authenticated using (public.can_view_process(process_id));
create policy columns_admin on public.process_columns for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- controls / walkthroughs / tests are read here and written only through the functions in 0003
create policy controls_read on public.controls for select to authenticated using (public.can_view_control(id));
create policy walkthroughs_read on public.walkthroughs for select to authenticated using (public.can_view_control(control_id));
create policy tests_read on public.tests for select to authenticated using (public.can_view_control(control_id));

create policy grants_read on public.access_grants for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy grants_admin on public.access_grants for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy wf_read on public.workflow_events for select to authenticated using (public.can_view_control(control_id));
create policy audit_read on public.audit_log for select to authenticated using (public.is_staff());

create policy att_read on public.attachments for select to authenticated using (public.can_view_control(control_id));
create policy att_insert on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_view_control(control_id) and public.is_preparer(control_id));
create policy att_delete on public.attachments for delete to authenticated
  using (public.is_staff() or uploaded_by = auth.uid());

create policy uploads_read on public.uploads for select to authenticated using (public.is_staff() or uploaded_by = auth.uid());
create policy uploads_insert on public.uploads for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_view_entity(entity_id));
