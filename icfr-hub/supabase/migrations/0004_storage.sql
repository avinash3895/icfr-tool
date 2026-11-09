-- ICFR Hub: file storage
-- icfr-evidence/<control_id>/<record_type>/<record_id>/<random>-<file name>
-- icfr-uploads/<entity_id>/<random>-<file name>   (copies of uploaded Excel files)

insert into storage.buckets (id, name, public) values ('icfr-evidence', 'icfr-evidence', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('icfr-uploads', 'icfr-uploads', false) on conflict (id) do nothing;

create or replace function public.icfr_uuid_or_null(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create policy icfr_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'icfr-evidence' and public.icfr_can_view_control(public.icfr_uuid_or_null((storage.foldername(name))[1])));
create policy icfr_evidence_write on storage.objects for insert to authenticated
  with check (bucket_id = 'icfr-evidence' and public.icfr_is_preparer(public.icfr_uuid_or_null((storage.foldername(name))[1])));
create policy icfr_evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'icfr-evidence' and (public.icfr_is_staff() or owner = auth.uid()));

create policy icfr_uploads_read on storage.objects for select to authenticated
  using (bucket_id = 'icfr-uploads' and (public.icfr_is_staff() or owner = auth.uid()));
create policy icfr_uploads_write on storage.objects for insert to authenticated
  with check (bucket_id = 'icfr-uploads' and public.icfr_can_view_entity(public.icfr_uuid_or_null((storage.foldername(name))[1])));
