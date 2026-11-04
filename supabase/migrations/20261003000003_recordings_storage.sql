-- M0.3 Private audio storage for voice recordings.
-- Path convention: recordings/{user_id}/{recording_id}.m4a

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'recordings',
    'recordings',
    false,
    10485760,
    array['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "recordings_owner_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "recordings_owner_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "recordings_owner_update" on storage.objects
    for update to authenticated
    using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "recordings_owner_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
