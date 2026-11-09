-- ICFR Hub: who can see and do what

create or replace function public.icfr_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.icfr_profiles where id = auth.uid() and active
$$;

create or replace function public.icfr_my_email() returns text
language sql stable security definer set search_path = public as $$
  select email from public.icfr_profiles where id = auth.uid() and active
$$;

create or replace function public.icfr_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.icfr_my_role() = 'admin', false)
$$;

-- admins (the finance team): see everything, maintain the RCM, give the final sign-off
create or replace function public.icfr_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.icfr_my_role() = 'admin', false)
$$;

-- Does any grant of mine cover this control? (edit_only: only grants with can_edit)
create or replace function public.icfr_grant_covers(p_entity uuid, p_process uuid, p_control uuid, edit_only boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.icfr_access_grants g
    where g.user_id = auth.uid()
      and g.entity_id = p_entity
      and (g.process_id is null or g.process_id = p_process)
      and (g.control_id is null or g.control_id = p_control)
      and (not edit_only or g.can_edit)
  )
$$;

create or replace function public.icfr_can_view_control(p_control uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.icfr_my_role() is not null and (
    public.icfr_is_staff() or exists (
      select 1 from public.icfr_controls c
      where c.id = p_control and (
        public.icfr_my_email() = any(c.responsible_emails)
        or public.icfr_my_email() = any(c.manager_emails)
        or public.icfr_grant_covers(c.entity_id, c.process_id, c.id)
      )
    )
  )
$$;

-- preparer = may edit while draft/returned and submit
create or replace function public.icfr_is_preparer(p_control uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.icfr_my_role() is not null and public.icfr_my_role() <> 'viewer' and (
    public.icfr_is_staff() or exists (
      select 1 from public.icfr_controls c
      where c.id = p_control and (
        public.icfr_my_email() = any(c.responsible_emails)
        or public.icfr_grant_covers(c.entity_id, c.process_id, c.id, true)
      )
    )
  )
$$;

create or replace function public.icfr_is_manager_of(p_control uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.icfr_my_role() is not null and public.icfr_my_role() <> 'viewer' and exists (
    select 1 from public.icfr_controls c
    where c.id = p_control and public.icfr_my_email() = any(c.manager_emails)
  )
$$;

create or replace function public.icfr_can_view_process(p_process uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.icfr_my_role() is not null and (
    public.icfr_is_staff()
    or exists (select 1 from public.icfr_processes p
               where p.id = p_process and public.icfr_grant_covers(p.entity_id, p.id, null))
    or exists (select 1 from public.icfr_access_grants g where g.user_id = auth.uid() and g.process_id = p_process)
    or exists (select 1 from public.icfr_controls c
               where c.process_id = p_process
                 and (public.icfr_my_email() = any(c.responsible_emails) or public.icfr_my_email() = any(c.manager_emails)))
  )
$$;

create or replace function public.icfr_can_view_entity(p_entity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.icfr_my_role() is not null and (
    public.icfr_is_staff()
    or exists (select 1 from public.icfr_access_grants g where g.user_id = auth.uid() and g.entity_id = p_entity)
    or exists (select 1 from public.icfr_controls c
               where c.entity_id = p_entity
                 and (public.icfr_my_email() = any(c.responsible_emails) or public.icfr_my_email() = any(c.manager_emails)))
  )
$$;

-- ---------------------------------------------------------------- RLS
alter table public.icfr_profiles enable row level security;
alter table public.icfr_entities enable row level security;
alter table public.icfr_processes enable row level security;
alter table public.icfr_process_columns enable row level security;
alter table public.icfr_controls enable row level security;
alter table public.icfr_walkthroughs enable row level security;
alter table public.icfr_tests enable row level security;
alter table public.icfr_access_grants enable row level security;
alter table public.icfr_workflow_events enable row level security;
alter table public.icfr_audit_log enable row level security;
alter table public.icfr_attachments enable row level security;
alter table public.icfr_uploads enable row level security;
alter table public.icfr_app_settings enable row level security;
alter table public.icfr_email_log enable row level security;

-- profiles: everyone signed in can see the directory (names for sign-off trails); only admins change it
create policy profiles_read on public.icfr_profiles for select to authenticated using (public.icfr_my_role() is not null or id = auth.uid());
create policy profiles_admin on public.icfr_profiles for update to authenticated using (public.icfr_is_admin()) with check (public.icfr_is_admin());

create policy entities_read on public.icfr_entities for select to authenticated using (public.icfr_can_view_entity(id));
create policy entities_admin on public.icfr_entities for all to authenticated using (public.icfr_is_admin()) with check (public.icfr_is_admin());

create policy processes_read on public.icfr_processes for select to authenticated using (public.icfr_can_view_process(id));
create policy processes_admin on public.icfr_processes for all to authenticated using (public.icfr_is_admin()) with check (public.icfr_is_admin());

create policy columns_read on public.icfr_process_columns for select to authenticated using (public.icfr_can_view_process(process_id));
create policy columns_admin on public.icfr_process_columns for all to authenticated using (public.icfr_is_admin()) with check (public.icfr_is_admin());

-- controls / walkthroughs / tests are read here and written only through the functions in 0003
create policy controls_read on public.icfr_controls for select to authenticated using (public.icfr_can_view_control(id));
create policy walkthroughs_read on public.icfr_walkthroughs for select to authenticated using (public.icfr_can_view_control(control_id));
create policy tests_read on public.icfr_tests for select to authenticated using (public.icfr_can_view_control(control_id));

create policy grants_read on public.icfr_access_grants for select to authenticated using (user_id = auth.uid() or public.icfr_is_admin());
create policy grants_admin on public.icfr_access_grants for all to authenticated using (public.icfr_is_admin()) with check (public.icfr_is_admin());

create policy wf_read on public.icfr_workflow_events for select to authenticated using (public.icfr_can_view_control(control_id));
create policy audit_read on public.icfr_audit_log for select to authenticated using (public.icfr_is_staff());

create policy att_read on public.icfr_attachments for select to authenticated using (public.icfr_can_view_control(control_id));
create policy att_insert on public.icfr_attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and public.icfr_can_view_control(control_id) and public.icfr_is_preparer(control_id));
create policy att_delete on public.icfr_attachments for delete to authenticated
  using (public.icfr_is_staff() or uploaded_by = auth.uid());

create policy uploads_read on public.icfr_uploads for select to authenticated using (public.icfr_is_staff() or uploaded_by = auth.uid());
create policy uploads_insert on public.icfr_uploads for insert to authenticated
  with check (uploaded_by = auth.uid() and public.icfr_can_view_entity(entity_id));

create policy settings_read on public.icfr_app_settings for select to authenticated using (true);
create policy settings_admin on public.icfr_app_settings for all to authenticated using (public.icfr_is_admin()) with check (public.icfr_is_admin());

create policy email_read on public.icfr_email_log for select to authenticated using (public.icfr_is_admin());
create policy email_insert on public.icfr_email_log for insert to authenticated with check (public.icfr_is_admin());

-- Is there an admin yet? (the sign-in page offers the first-admin setup only while there is none)
create or replace function public.icfr_has_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.icfr_profiles where role = 'admin' and active)
$$;
grant execute on function public.icfr_has_admin() to anon, authenticated;
