-- ICFR Hub: only signed-in users may call ICFR functions or touch ICFR tables
-- (icfr_has_admin stays public for the sign-in page)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'icfr\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('icfr_audit_trigger', 'icfr_clean') then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
grant execute on function public.icfr_has_admin() to anon;

do $$
declare t record;
begin
  for t in select c.oid::regclass as rel from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'icfr\_%' and c.relkind in ('r', 'S') loop
    execute format('revoke all on %s from anon', t.rel);
  end loop;
end $$;

alter function public.icfr_emails(jsonb) set search_path = public;
alter function public.icfr_blank(jsonb) set search_path = public;
alter function public.icfr_uuid_or_null(text) set search_path = public;
