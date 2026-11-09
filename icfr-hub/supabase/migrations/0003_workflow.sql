-- ICFR Hub: saving records, sign-off workflow, test planning and the audit trail

-- "a@x.com; b@y.com", ["a@x.com"] or null  ->  {a@x.com,b@y.com}
create or replace function public._emails(v jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct e order by e), '{}')
  from (
    select lower(trim(x)) e
    from regexp_split_to_table(
      case jsonb_typeof(v)
        when 'array' then (select string_agg(value #>> '{}', ';') from jsonb_array_elements(v))
        when 'string' then v #>> '{}'
        else '' end,
      '[;,\s]+') x
  ) s where e <> ''
$$;

create or replace function public._blank(v jsonb) returns boolean
language sql immutable as $$
  select v is null or jsonb_typeof(v) = 'null' or v = '""'::jsonb or v = '[]'::jsonb
         or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '')
$$;

-- ---------------------------------------------------------------- RCM rows
-- p_id null = new control. p_data holds column values keyed by column key; it is merged into the stored data.
create or replace function public.save_control(p_process_id uuid, p_id uuid, p_data jsonb)
returns public.controls
language plpgsql security definer set search_path = public as $$
declare
  v_proc public.processes;
  v_old public.controls;
  v_row public.controls;
  v_staff boolean := public.is_staff();
  v_data jsonb;
  v_ref text;
  v_val jsonb;
  col record;
begin
  select * into v_proc from public.processes where id = p_process_id;
  if not found then raise exception 'Process not found'; end if;

  if p_id is not null then
    select * into v_old from public.controls where id = p_id for update;
    if not found or v_old.process_id <> p_process_id then raise exception 'Control not found'; end if;
    if not public.is_preparer(p_id) then
      raise exception 'You do not have edit access to control %', v_old.control_ref;
    end if;
    if not v_staff and v_old.status not in ('draft','returned') then
      raise exception 'Control % is waiting for sign-off or already signed off. It can be edited only after it is sent back.', v_old.control_ref;
    end if;
    v_data := v_old.data || coalesce(p_data, '{}');
    if not v_staff then
      -- only finance/admin decide who is responsible and who signs off
      v_data := v_data || jsonb_build_object(
        'responsible', coalesce(v_old.data->'responsible', '[]'::jsonb),
        'manager',     coalesce(v_old.data->'manager', '[]'::jsonb));
    end if;
  else
    if not public.can_add_control(p_process_id) then
      raise exception 'You cannot add new controls to %', v_proc.name;
    end if;
    v_data := coalesce(p_data, '{}');
  end if;

  for col in select * from public.process_columns where process_id = p_process_id and not archived loop
    v_val := v_data -> col.key;
    if col.type = 'emails' then
      v_data := jsonb_set(v_data, array[col.key], to_jsonb(public._emails(v_val)));
      v_val := v_data -> col.key;
    end if;
    if col.required and public._blank(v_val) then
      raise exception '"%" is required (control %)', col.label, coalesce(nullif(trim(v_data->>'control_id'),''), 'new');
    end if;
    if col.type in ('select','yesno') and not public._blank(v_val) and cardinality(col.options) > 0
       and not (v_val #>> '{}') = any(col.options) then
      raise exception '"%" must be one of: % (control %)', col.label, array_to_string(col.options, ', '), v_data->>'control_id';
    end if;
  end loop;

  v_ref := nullif(trim(v_data->>'control_id'), '');
  if v_ref is null then raise exception 'Control ID is required'; end if;
  v_data := jsonb_set(v_data, '{control_id}', to_jsonb(v_ref));

  if exists (select 1 from public.controls where process_id = p_process_id and control_ref = v_ref
             and id is distinct from p_id) then
    raise exception 'Control ID % already exists in %', v_ref, v_proc.name;
  end if;

  if p_id is null then
    insert into public.controls (entity_id, process_id, control_ref, data, frequency, test_frequency,
      responsible_emails, manager_emails, is_key, status, created_by, updated_by)
    values (v_proc.entity_id, p_process_id, v_ref, v_data,
      nullif(v_data->>'frequency',''), nullif(v_data->>'test_frequency',''),
      public._emails(v_data->'responsible'), public._emails(v_data->'manager'),
      case lower(v_data->>'key_control') when 'yes' then true when 'no' then false end,
      case when v_staff then 'approved' else 'draft' end,
      auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.controls set
      control_ref = v_ref, data = v_data,
      frequency = nullif(v_data->>'frequency',''),
      test_frequency = nullif(v_data->>'test_frequency',''),
      responsible_emails = public._emails(v_data->'responsible'),
      manager_emails = public._emails(v_data->'manager'),
      is_key = case lower(v_data->>'key_control') when 'yes' then true when 'no' then false end,
      updated_at = now(), updated_by = auth.uid()
    where id = p_id
    returning * into v_row;
  end if;
  return v_row;
end $$;

-- Apply an Excel upload for one process in a single transaction: any failing row rolls back the whole file.
-- p_rows: [{ "id": uuid|null, "data": {...} }]  (only new and changed rows are sent)
create or replace function public.apply_rcm_upload(p_process_id uuid, p_rows jsonb, p_file_name text, p_path text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_added int := 0;
  v_updated int := 0;
  v_entity uuid;
  v_summary jsonb;
begin
  select entity_id into v_entity from public.processes where id = p_process_id;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    perform public.save_control(p_process_id, nullif(r->>'id','')::uuid, r->'data');
    if nullif(r->>'id','') is null then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
  end loop;
  v_summary := jsonb_build_object('added', v_added, 'updated', v_updated);
  insert into public.uploads (entity_id, process_id, file_name, path, summary)
  values (v_entity, p_process_id, p_file_name, p_path, v_summary);
  return v_summary;
end $$;

create or replace function public.archive_control(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Only finance can archive controls'; end if;
  update public.controls set archived = p_archived, updated_at = now(), updated_by = auth.uid() where id = p_id;
end $$;

-- ---------------------------------------------------------------- walkthroughs and tests
create or replace function public.save_walkthrough(p_control_id uuid, p_fy int, p_data jsonb, p_conclusion text)
returns public.walkthroughs
language plpgsql security definer set search_path = public as $$
declare
  v_c public.controls;
  v_w public.walkthroughs;
begin
  select * into v_c from public.controls where id = p_control_id;
  if not found then raise exception 'Control not found'; end if;
  if not public.is_preparer(p_control_id) then raise exception 'You do not have edit access to control %', v_c.control_ref; end if;
  select * into v_w from public.walkthroughs where control_id = p_control_id and fy = p_fy for update;
  if found and not public.is_staff() and v_w.status not in ('draft','returned') then
    raise exception 'This walkthrough is waiting for sign-off or already signed off';
  end if;
  insert into public.walkthroughs (control_id, entity_id, process_id, fy, data, conclusion, updated_by)
  values (p_control_id, v_c.entity_id, v_c.process_id, p_fy, coalesce(p_data,'{}'), nullif(p_conclusion,''), auth.uid())
  on conflict (control_id, fy) do update
    set data = public.walkthroughs.data || excluded.data,
        conclusion = excluded.conclusion,
        updated_at = now(), updated_by = auth.uid()
  returning * into v_w;
  return v_w;
end $$;

create or replace function public.save_test(p_id uuid, p_data jsonb, p_conclusion text, p_sample_size int, p_exceptions int)
returns public.tests
language plpgsql security definer set search_path = public as $$
declare
  v_t public.tests;
begin
  select * into v_t from public.tests where id = p_id for update;
  if not found then raise exception 'Test not found'; end if;
  if not public.is_preparer(v_t.control_id) then raise exception 'You do not have edit access to this control'; end if;
  if not public.is_staff() and v_t.status not in ('draft','returned') then
    raise exception 'This test is waiting for sign-off or already signed off';
  end if;
  update public.tests set
    data = data || coalesce(p_data,'{}'),
    conclusion = nullif(p_conclusion,''),
    sample_size = p_sample_size,
    exceptions = p_exceptions,
    updated_at = now(), updated_by = auth.uid()
  where id = p_id returning * into v_t;
  return v_t;
end $$;

-- Suggested samples for a full year, by how often the control runs (common practice; adjust to your methodology)
create or replace function public.annual_sample(p_frequency text) returns int
language sql immutable as $$
  select case p_frequency
    when 'Annual' then 1 when 'Semi-annual' then 1 when 'Quarterly' then 2 when 'Monthly' then 2
    when 'Weekly' then 5 when 'Daily' then 25 when 'Multiple times a day' then 40 when 'Event-driven' then 25
    else 2 end
$$;

-- Create the walkthrough and the test periods for every active control of an entity for one fiscal year.
-- Safe to run again: existing records are kept, only missing ones are added.
create or replace function public.generate_test_plan(p_entity_id uuid, p_fy int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m int;
  v_start date;
  c record;
  v_tf text;
  v_n int;
  v_step int;
  v_per int;
  i int;
  v_w int := 0;
  v_t int := 0;
  v_cnt int;
begin
  if not public.is_staff() then raise exception 'Only finance can set up a testing year'; end if;
  select fy_end_month into v_m from public.entities where id = p_entity_id;
  if v_m is null then raise exception 'Entity not found'; end if;
  -- FY p_fy ends on the last day of month v_m of year p_fy
  v_start := (make_date(p_fy, v_m, 1) + interval '1 month' - interval '1 year')::date;

  for c in select * from public.controls where entity_id = p_entity_id and not archived loop
    insert into public.walkthroughs (control_id, entity_id, process_id, fy)
    values (c.id, c.entity_id, c.process_id, p_fy) on conflict do nothing;
    get diagnostics v_cnt = row_count; v_w := v_w + v_cnt;

    v_tf := coalesce(c.test_frequency, case when c.frequency in ('Annual','Semi-annual') then 'Annual' else 'Quarterly' end);
    v_n := case v_tf when 'Annual' then 1 when 'Semi-annual' then 2 when 'Quarterly' then 4 when 'Monthly' then 12 else 4 end;
    v_step := 12 / v_n;
    v_per := greatest(1, ceil(public.annual_sample(c.frequency)::numeric / v_n));
    for i in 1..v_n loop
      insert into public.tests (control_id, entity_id, process_id, fy, period, period_start, period_end, sample_size)
      values (c.id, c.entity_id, c.process_id, p_fy,
        case v_n when 1 then 'FY' when 2 then 'H' || i when 4 then 'Q' || i else 'M' || lpad(i::text, 2, '0') end,
        (v_start + make_interval(months => (i - 1) * v_step))::date,
        (v_start + make_interval(months => i * v_step) - interval '1 day')::date,
        v_per)
      on conflict do nothing;
      get diagnostics v_cnt = row_count; v_t := v_t + v_cnt;
    end loop;
  end loop;
  return jsonb_build_object('walkthroughs', v_w, 'tests', v_t);
end $$;

-- ---------------------------------------------------------------- sign-off workflow
-- actions: submit | approve | return
create or replace function public.wf_action(p_type text, p_id uuid, p_action text, p_comment text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_tbl text;
  v_status text;
  v_control uuid;
  v_entity uuid;
  v_submitted uuid;
  v_conclusion text;
  v_mgr text[];
  v_new text;
begin
  v_tbl := case p_type when 'control' then 'controls' when 'walkthrough' then 'walkthroughs' when 'test' then 'tests' end;
  if v_tbl is null then raise exception 'Unknown record type %', p_type; end if;

  if p_type = 'control' then
    select status, id, entity_id, submitted_by, 'n/a' into v_status, v_control, v_entity, v_submitted, v_conclusion
    from public.controls where id = p_id for update;
  elsif p_type = 'walkthrough' then
    select status, control_id, entity_id, submitted_by, conclusion into v_status, v_control, v_entity, v_submitted, v_conclusion
    from public.walkthroughs where id = p_id for update;
  else
    select status, control_id, entity_id, submitted_by, conclusion into v_status, v_control, v_entity, v_submitted, v_conclusion
    from public.tests where id = p_id for update;
  end if;
  if v_status is null then raise exception 'Record not found'; end if;
  select manager_emails into v_mgr from public.controls where id = v_control;

  if p_action = 'submit' then
    if v_status not in ('draft','returned') then raise exception 'This has already been submitted'; end if;
    if not public.is_preparer(v_control) then raise exception 'Only the responsible person can submit this'; end if;
    if v_conclusion is null then raise exception 'Choose a conclusion before submitting'; end if;
    v_new := case when cardinality(v_mgr) > 0 then 'pending_manager' else 'pending_finance' end;
    execute format('update public.%I set status = $1, submitted_by = auth.uid(), submitted_at = now(),
                    manager_by = null, manager_at = null, finance_by = null, finance_at = null, return_comment = null
                    where id = $2', v_tbl) using v_new, p_id;

  elsif p_action = 'approve' then
    if v_status = 'pending_manager' then
      if not (public.is_manager_of(v_control) or public.is_admin()) then
        raise exception 'Only the manager listed on the control can sign off at this step';
      end if;
      if v_submitted = auth.uid() and not public.is_admin() then
        raise exception 'You submitted this, so someone else has to give the manager sign-off';
      end if;
      v_new := 'pending_finance';
      execute format('update public.%I set status = $1, manager_by = auth.uid(), manager_at = now() where id = $2', v_tbl)
        using v_new, p_id;
    elsif v_status = 'pending_finance' then
      if not public.is_staff() then raise exception 'Only finance can give the final sign-off'; end if;
      v_new := 'approved';
      execute format('update public.%I set status = $1, finance_by = auth.uid(), finance_at = now() where id = $2', v_tbl)
        using v_new, p_id;
    else
      raise exception 'There is nothing waiting for sign-off here';
    end if;

  elsif p_action = 'return' then
    if coalesce(trim(p_comment), '') = '' then raise exception 'Add a comment saying what needs to change'; end if;
    if not (
      (v_status = 'pending_manager' and (public.is_manager_of(v_control) or public.is_staff()))
      or (v_status in ('pending_finance','approved','draft','returned') and public.is_staff())
    ) then
      raise exception 'You cannot send this back';
    end if;
    v_new := 'returned';
    execute format('update public.%I set status = $1, return_comment = $2 where id = $3', v_tbl)
      using v_new, p_comment, p_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;

  insert into public.workflow_events (record_type, record_id, control_id, entity_id, action, from_status, to_status, comment, actor, actor_email)
  values (p_type, p_id, v_control, v_entity, p_action, v_status, v_new, nullif(trim(p_comment), ''), auth.uid(), public.my_email());
  return v_new;
end $$;

-- ---------------------------------------------------------------- audit trail
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb := '{}';
  k text;
  dk text;
  v_id uuid;
  v_entity uuid;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      continue when k in ('updated_at','updated_by');
      if k = 'data' then
        for dk in
          select jsonb_object_keys(coalesce(v_old->'data','{}'))
          union select jsonb_object_keys(coalesce(v_new->'data','{}'))
        loop
          if (v_old->'data'->dk) is distinct from (v_new->'data'->dk) then
            v_changed := v_changed || jsonb_build_object(dk, jsonb_build_object('from', v_old->'data'->dk, 'to', v_new->'data'->dk));
          end if;
        end loop;
      elsif (v_old->k) is distinct from (v_new->k) then
        v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', v_old->k, 'to', v_new->k));
      end if;
    end loop;
    if v_changed = '{}'::jsonb then return new; end if;
  else
    v_changed := coalesce(v_new, v_old);
  end if;

  v_id := (coalesce(v_new, v_old)->>'id')::uuid;
  if tg_table_name = 'entities' then
    v_entity := v_id;
  elsif tg_table_name = 'process_columns' then
    select entity_id into v_entity from public.processes where id = (coalesce(v_new, v_old)->>'process_id')::uuid;
  else
    v_entity := (coalesce(v_new, v_old)->>'entity_id')::uuid;
  end if;

  insert into public.audit_log (table_name, record_id, entity_id, action, changed, actor, actor_email)
  values (tg_table_name, v_id, v_entity, lower(tg_op), v_changed, auth.uid(), public.my_email());
  return coalesce(new, old);
end $$;

create trigger audit_entities after insert or update or delete on public.entities for each row execute function public.audit_trigger();
create trigger audit_processes after insert or update or delete on public.processes for each row execute function public.audit_trigger();
create trigger audit_columns after insert or update or delete on public.process_columns for each row execute function public.audit_trigger();
create trigger audit_controls after insert or update or delete on public.controls for each row execute function public.audit_trigger();
create trigger audit_walkthroughs after insert or update or delete on public.walkthroughs for each row execute function public.audit_trigger();
create trigger audit_tests after insert or update or delete on public.tests for each row execute function public.audit_trigger();
create trigger audit_grants after insert or update or delete on public.access_grants for each row execute function public.audit_trigger();
create trigger audit_profiles after update on public.profiles for each row execute function public.audit_trigger();
create trigger audit_attachments after insert or delete on public.attachments for each row execute function public.audit_trigger();
