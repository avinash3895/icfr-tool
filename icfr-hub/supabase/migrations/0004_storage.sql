-- ICFR Hub: file storage
-- evidence/<control_id>/<record_type>/<record_id>/<random>-<file name>
-- uploads/<entity_id>/<random>-<file name>   (copies of uploaded Excel files)

insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false) on conflict (id) do nothing;

create or replace function public._uuid_or_null(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.can_view_control(public._uuid_or_null((storage.foldername(name))[1])));
create policy evidence_write on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.is_preparer(public._uuid_or_null((storage.foldername(name))[1])));
create policy evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and (public.is_staff() or owner = auth.uid()));

create policy uploads_read on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (public.is_staff() or owner = auth.uid()));
create policy uploads_write on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and public.can_view_entity(public._uuid_or_null((storage.foldername(name))[1])));
