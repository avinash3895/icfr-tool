-- ICFR Hub: saving records, sample sizes, sign-off workflow, test planning and the audit trail

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

-- Check and normalise values against a process template (sheet = rcm | walkthrough | test)
create or replace function public._clean(p_process uuid, p_sheet text, p_data jsonb, p_enforce_required boolean, p_ref text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_data jsonb := coalesce(p_data, '{}');
  v_val jsonb;
  v_txt text;
  col record;
begin
  for col in select * from public.process_columns where process_id = p_process and sheet = p_sheet and not archived loop
    v_val := v_data -> col.key;
    if col.type = 'emails' then
      v_data := jsonb_set(v_data, array[col.key], to_jsonb(public._emails(v_val)));
      v_val := v_data -> col.key;
    elsif col.type = 'number' and not public._blank(v_val) then
      v_txt := trim(replace(v_val #>> '{}', ',', ''));
      if v_txt !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception '"%" must be a number (%)', col.label, p_ref;
      end if;
      v_data := jsonb_set(v_data, array[col.key], to_jsonb(v_txt::numeric));
      v_val := v_data -> col.key;
    end if;
    if p_enforce_required and col.required and public._blank(v_val) then
      raise exception '"%" is required (%)', col.label, p_ref;
    end if;
    if col.type in ('select','yesno') and not public._blank(v_val) and cardinality(col.options) > 0
       and not (v_val #>> '{}') = any(col.options) then
      raise exception '"%" must be one of: % (%)', col.label, array_to_string(col.options, ', '), p_ref;
    end if;
  end loop;
  return v_data;
end $$;

-- ---------------------------------------------------------------- sample sizes
-- Sample size from the master grid (control frequency x risk level). Null when not set.
create or replace function public.sample_for(p_frequency text, p_risk text) returns int
language sql stable security definer set search_path = public as $$
  select nullif(value -> 'sizes' -> p_frequency ->> p_risk, '')::int
  from public.app_settings where key = 'sample_matrix'
$$;

-- Save the master grid and push it to every control and every test that has not been submitted yet.
-- Sample sizes typed in by hand on a control or a test are left alone.
create or replace function public.apply_sample_matrix(p_matrix jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_controls int;
  v_tests int;
  v_risks text[];
begin
  if not public.is_admin() then raise exception 'Only admins can change the sample size master'; end if;
  if jsonb_typeof(p_matrix -> 'risks') <> 'array' or jsonb_typeof(p_matrix -> 'sizes') <> 'object' then
    raise exception 'The sample size master is not in the expected format';
  end if;
  select array_agg(value #>> '{}') into v_risks from jsonb_array_elements(p_matrix -> 'risks');

  insert into public.app_settings (key, value, updated_at, updated_by) values ('sample_matrix', p_matrix, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();

  -- the Risk Level column of every RCM offers the risk levels of the master
  update public.process_columns set options = v_risks
  where sheet = 'rcm' and key = 'risk_level' and options is distinct from v_risks;

  update public.controls c set
    sample_size = s.n,
    data = jsonb_set(c.data, '{sample_size}', coalesce(to_jsonb(s.n), 'null'::jsonb)),
    updated_at = now(), updated_by = auth.uid()
  from (select id, public.sample_for(frequency, risk_level) n from public.controls) s
  where s.id = c.id and not c.sample_size_manual and c.sample_size is distinct from s.n;
  get diagnostics v_controls = row_count;

  update public.tests t set
    sample_size = c.sample_size,
    data = t.data || jsonb_build_object('sample_size', c.sample_size),
    updated_at = now()
  from public.controls c
  where c.id = t.control_id and t.status in ('draft','returned') and not t.sample_size_manual
    and t.sample_size is distinct from c.sample_size;
  get diagnostics v_tests = row_count;

  return jsonb_build_object('controls', v_controls, 'tests', v_tests);
end $$;

-- ---------------------------------------------------------------- RCM rows (admins only)
-- p_id null = new control. p_data holds column values keyed by column key; it is merged into the stored data.
create or replace function public.save_control(p_process_id uuid, p_id uuid, p_data jsonb, p_sort int default null)
returns public.controls
language plpgsql security definer set search_path = public as $$
declare
  v_proc public.processes;
  v_old public.controls;
  v_row public.controls;
  v_data jsonb;
  v_ref text;
  v_auto int;
  v_size int;
  v_manual boolean;
  v_given boolean;
begin
  if not public.is_staff() then raise exception 'Only admins can change the RCM'; end if;
  select * into v_proc from public.processes where id = p_process_id;
  if not found then raise exception 'Process not found'; end if;
  p_data := coalesce(p_data, '{}');

  if p_id is not null then
    select * into v_old from public.controls where id = p_id for update;
    if not found or v_old.process_id <> p_process_id then raise exception 'Control not found'; end if;
    v_data := v_old.data || p_data;
  else
    v_data := p_data;
  end if;

  v_ref := nullif(trim(v_data->>'control_id'), '');
  if v_ref is null then raise exception 'Control ID is required'; end if;
  v_data := public._clean(p_process_id, 'rcm', jsonb_set(v_data, '{control_id}', to_jsonb(v_ref)), true, v_ref);

  if not coalesce(v_old.archived, false) and exists (
    select 1 from public.controls where process_id = p_process_id and lower(control_ref) = lower(v_ref)
      and not archived and id is distinct from p_id) then
    raise exception 'Control ID % already exists in %', v_ref, v_proc.name;
  end if;

  -- sample size: from the master grid unless an admin typed a different number
  v_auto := public.sample_for(v_data->>'frequency', v_data->>'risk_level');
  v_given := p_data ? 'sample_size' and (v_old.id is null or (p_data->'sample_size') is distinct from (v_old.data->'sample_size'));
  if v_given and not public._blank(p_data->'sample_size') then
    v_size := round((v_data->>'sample_size')::numeric)::int;
    v_manual := v_auto is null or v_size <> v_auto;
  elsif not v_given and v_old.id is not null and v_old.sample_size_manual then
    v_size := v_old.sample_size;
    v_manual := true;
  else
    v_size := v_auto;
    v_manual := false;
  end if;
  v_data := jsonb_set(v_data, '{sample_size}', coalesce(to_jsonb(v_size), 'null'::jsonb));

  if p_id is null then
    insert into public.controls (entity_id, process_id, control_ref, data, frequency, test_frequency, risk_level,
      sample_size, sample_size_manual, responsible_emails, manager_emails, is_key, sort, created_by, updated_by)
    values (v_proc.entity_id, p_process_id, v_ref, v_data,
      nullif(v_data->>'frequency',''), nullif(v_data->>'test_frequency',''), nullif(v_data->>'risk_level',''),
      v_size, v_manual,
      public._emails(v_data->'responsible'), public._emails(v_data->'manager'),
      case lower(v_data->>'key_control') when 'yes' then true when 'no' then false end,
      coalesce(p_sort, (select coalesce(max(sort), 0) + 1 from public.controls where process_id = p_process_id)),
      auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.controls set
      control_ref = v_ref, data = v_data,
      frequency = nullif(v_data->>'frequency',''),
      test_frequency = nullif(v_data->>'test_frequency',''),
      risk_level = nullif(v_data->>'risk_level',''),
      sample_size = v_size, sample_size_manual = v_manual,
      responsible_emails = public._emails(v_data->'responsible'),
      manager_emails = public._emails(v_data->'manager'),
      is_key = case lower(v_data->>'key_control') when 'yes' then true when 'no' then false end,
      sort = coalesce(p_sort, sort),
      updated_at = now(), updated_by = auth.uid()
    where id = p_id
    returning * into v_row;

    -- tests not yet submitted follow the control's sample size (unless changed by hand on the test)
    update public.tests set sample_size = v_size, data = data || jsonb_build_object('sample_size', v_size), updated_at = now()
    where control_id = p_id and status in ('draft','returned') and not sample_size_manual
      and sample_size is distinct from v_size;
  end if;
  return v_row;
end $$;

-- Apply an Excel upload for one process in a single transaction: any failing row rolls back the whole file.
-- p_rows:    [{ "id": uuid|null, "data": {...}, "sort": n }]  (only new and changed rows are sent;
--            data.control_id is the new Control ID, so a different value renumbers the control)
-- p_archive: controls that are not in the file any more
create or replace function public.apply_rcm_upload(p_process_id uuid, p_rows jsonb, p_archive uuid[], p_file_name text, p_path text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_added int := 0;
  v_updated int := 0;
  v_renamed int := 0;
  v_archived int := 0;
  v_entity uuid;
  v_summary jsonb;
  v_id uuid;
begin
  if not public.is_staff() then raise exception 'Only admins can upload the RCM'; end if;
  select entity_id into v_entity from public.processes where id = p_process_id;
  if v_entity is null then raise exception 'Process not found'; end if;

  -- 1. controls that are no longer in the file
  update public.controls set archived = true, updated_at = now(), updated_by = auth.uid()
  where id = any(coalesce(p_archive, '{}')) and process_id = p_process_id and not archived;
  get diagnostics v_archived = row_count;

  -- 2. free the Control IDs that are being renumbered, so swaps like 02 <-> 03 work
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_id := nullif(r->>'id','')::uuid;
    if v_id is not null and r->'data' ? 'control_id' then
      update public.controls set control_ref = '~' || id::text
      where id = v_id and process_id = p_process_id and lower(control_ref) <> lower(trim(r->'data'->>'control_id'));
      if found then v_renamed := v_renamed + 1; end if;
    end if;
  end loop;

  -- 3. save every new / changed row
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_id := nullif(r->>'id','')::uuid;
    perform public.save_control(p_process_id, v_id, r->'data', nullif(r->>'sort','')::int);
    if v_id is null then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
  end loop;

  v_summary := jsonb_build_object('added', v_added, 'updated', v_updated, 'renumbered', v_renamed, 'archived', v_archived);
  insert into public.uploads (entity_id, process_id, file_name, path, summary)
  values (v_entity, p_process_id, p_file_name, p_path, v_summary);
  return v_summary;
end $$;

create or replace function public.archive_control(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.controls;
begin
  if not public.is_staff() then raise exception 'Only admins can remove controls'; end if;
  select * into v from public.controls where id = p_id;
  if not p_archived and exists (select 1 from public.controls where process_id = v.process_id
      and lower(control_ref) = lower(v.control_ref) and not archived and id <> p_id) then
    raise exception 'Control ID % is now used by another control. Renumber that one first.', v.control_ref;
  end if;
  update public.controls set archived = p_archived, updated_at = now(), updated_by = auth.uid() where id = p_id;
end $$;

-- ---------------------------------------------------------------- walkthroughs and tests
create or replace function public.save_walkthrough(p_control_id uuid, p_fy int, p_data jsonb)
returns public.walkthroughs
language plpgsql security definer set search_path = public as $$
declare
  v_c public.controls;
  v_w public.walkthroughs;
  v_data jsonb;
begin
  select * into v_c from public.controls where id = p_control_id;
  if not found then raise exception 'Control not found'; end if;
  if not public.is_preparer(p_control_id) then raise exception 'You do not have edit access to control %', v_c.control_ref; end if;
  select * into v_w from public.walkthroughs where control_id = p_control_id and fy = p_fy for update;
  if found and not public.is_staff() and v_w.status not in ('draft','returned') then
    raise exception 'The walkthrough of % is waiting for sign-off or already signed off', v_c.control_ref;
  end if;
  v_data := public._clean(v_c.process_id, 'walkthrough', coalesce(v_w.data, '{}') || coalesce(p_data, '{}'), false, v_c.control_ref);
  insert into public.walkthroughs (control_id, entity_id, process_id, fy, data, conclusion, updated_by)
  values (p_control_id, v_c.entity_id, v_c.process_id, p_fy, v_data, nullif(v_data->>'conclusion',''), auth.uid())
  on conflict (control_id, fy) do update
    set data = excluded.data, conclusion = excluded.conclusion, updated_at = now(), updated_by = auth.uid()
  returning * into v_w;
  return v_w;
end $$;

create or replace function public.save_test(p_id uuid, p_data jsonb)
returns public.tests
language plpgsql security definer set search_path = public as $$
declare
  v_t public.tests;
  v_c public.controls;
  v_data jsonb;
  v_size int;
  v_manual boolean;
begin
  select * into v_t from public.tests where id = p_id for update;
  if not found then raise exception 'Test not found'; end if;
  select * into v_c from public.controls where id = v_t.control_id;
  if not public.is_preparer(v_t.control_id) then raise exception 'You do not have edit access to control %', v_c.control_ref; end if;
  if not public.is_staff() and v_t.status not in ('draft','returned') then
    raise exception 'The % test of % is waiting for sign-off or already signed off', v_t.period, v_c.control_ref;
  end if;
  p_data := coalesce(p_data, '{}');
  if not public.is_staff() then p_data := p_data - 'sample_size'; end if;  -- only admins set sample sizes
  v_data := public._clean(v_t.process_id, 'test', v_t.data || p_data, false, v_c.control_ref || ' ' || v_t.period);

  v_size := v_t.sample_size;
  v_manual := v_t.sample_size_manual;
  if p_data ? 'sample_size' then
    if public._blank(p_data->'sample_size') then
      v_size := v_c.sample_size; v_manual := false;
    else
      v_size := round((v_data->>'sample_size')::numeric)::int;
      v_manual := v_size is distinct from v_c.sample_size;
    end if;
  end if;
  v_data := jsonb_set(v_data, '{sample_size}', coalesce(to_jsonb(v_size), 'null'::jsonb));

  update public.tests set
    data = v_data,
    conclusion = nullif(v_data->>'conclusion',''),
    sample_size = v_size, sample_size_manual = v_manual,
    exceptions = case when public._blank(v_data->'exceptions') then null else round((v_data->>'exceptions')::numeric)::int end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_id returning * into v_t;
  return v_t;
end $$;

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
  v_size int;
  i int;
  v_w int := 0;
  v_t int := 0;
  v_cnt int;
begin
  if not public.is_staff() then raise exception 'Only admins can set up a testing year'; end if;
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
    v_size := coalesce(c.sample_size, public.sample_for(c.frequency, c.risk_level));
    for i in 1..v_n loop
      insert into public.tests (control_id, entity_id, process_id, fy, period, period_start, period_end, sample_size, data)
      values (c.id, c.entity_id, c.process_id, p_fy,
        case v_n when 1 then 'FY' when 2 then 'H' || i when 4 then 'Q' || i else 'M' || lpad(i::text, 2, '0') end,
        (v_start + make_interval(months => (i - 1) * v_step))::date,
        (v_start + make_interval(months => i * v_step) - interval '1 day')::date,
        v_size, jsonb_build_object('sample_size', v_size))
      on conflict do nothing;
      get diagnostics v_cnt = row_count; v_t := v_t + v_cnt;
    end loop;
  end loop;
  return jsonb_build_object('walkthroughs', v_w, 'tests', v_t);
end $$;

-- ---------------------------------------------------------------- sign-off workflow (walkthroughs and tests)
-- actions: submit | approve | return
create or replace function public.wf_action(p_type text, p_id uuid, p_action text, p_comment text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_tbl text;
  v_status text;
  v_control uuid;
  v_process uuid;
  v_entity uuid;
  v_submitted uuid;
  v_conclusion text;
  v_data jsonb;
  v_label text;
  v_mgr text[];
  v_new text;
begin
  if p_type = 'walkthrough' then
    v_tbl := 'walkthroughs';
    select status, control_id, process_id, entity_id, submitted_by, conclusion, data, 'walkthrough'
      into v_status, v_control, v_process, v_entity, v_submitted, v_conclusion, v_data, v_label
    from public.walkthroughs where id = p_id for update;
  elsif p_type = 'test' then
    v_tbl := 'tests';
    select status, control_id, process_id, entity_id, submitted_by, conclusion, data, period || ' test'
      into v_status, v_control, v_process, v_entity, v_submitted, v_conclusion, v_data, v_label
    from public.tests where id = p_id for update;
  else
    raise exception 'Unknown record type %', p_type;
  end if;
  if v_status is null then raise exception 'Record not found'; end if;
  select manager_emails, control_ref || ' ' || v_label into v_mgr, v_label from public.controls where id = v_control;

  if p_action = 'submit' then
    if v_status not in ('draft','returned') then raise exception '% has already been submitted', v_label; end if;
    if not public.is_preparer(v_control) then raise exception 'Only the responsible person can submit %', v_label; end if;
    perform public._clean(v_process, p_type, v_data, true, v_label);  -- every required column must be filled
    if v_conclusion is null then raise exception 'Choose a conclusion before submitting %', v_label; end if;
    v_new := case when cardinality(v_mgr) > 0 then 'pending_manager' else 'pending_finance' end;
    execute format('update public.%I set status = $1, submitted_by = auth.uid(), submitted_at = now(),
                    manager_by = null, manager_at = null, finance_by = null, finance_at = null, return_comment = null
                    where id = $2', v_tbl) using v_new, p_id;

  elsif p_action = 'approve' then
    if v_status = 'pending_manager' then
      if not (public.is_manager_of(v_control) or public.is_admin()) then
        raise exception 'Only the manager listed on the control can sign off %', v_label;
      end if;
      if v_submitted = auth.uid() and not public.is_admin() then
        raise exception 'You submitted %, so someone else has to give the manager sign-off', v_label;
      end if;
      v_new := 'pending_finance';
      execute format('update public.%I set status = $1, manager_by = auth.uid(), manager_at = now() where id = $2', v_tbl)
        using v_new, p_id;
    elsif v_status = 'pending_finance' then
      if not public.is_staff() then raise exception 'Only finance (admins) can give the final sign-off'; end if;
      v_new := 'approved';
      execute format('update public.%I set status = $1, finance_by = auth.uid(), finance_at = now() where id = $2', v_tbl)
        using v_new, p_id;
    else
      raise exception '% is not waiting for sign-off', v_label;
    end if;

  elsif p_action = 'return' then
    if coalesce(trim(p_comment), '') = '' then raise exception 'Add a comment saying what needs to change'; end if;
    if not (
      (v_status = 'pending_manager' and (public.is_manager_of(v_control) or public.is_staff()))
      or (v_status in ('pending_finance','approved','draft','returned') and public.is_staff())
    ) then
      raise exception 'You cannot send back %', v_label;
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
create trigger audit_settings after insert or update on public.app_settings for each row execute function public.audit_trigger();
