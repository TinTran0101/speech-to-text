-- Initial cloud migration. For manual Dashboard setup, run ../schema.sql instead.
create extension if not exists pgcrypto;

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  cache_key text not null unique,
  file_hash text not null,
  file_name text not null,
  file_size bigint not null check (file_size >= 0),
  mime_type text,
  audio_path text,
  language_code text,
  model_id text,
  recording_type text not null default 'speech_to_text'
    check (recording_type in ('speech_to_text', 'text_to_speech')),
  source_text text,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  transcript_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recordings_file_hash_idx on public.recordings (file_hash);
create index recordings_created_idx on public.recordings (created_at desc);
create index recordings_user_created_idx on public.recordings (user_id, created_at desc);
create index recordings_language_idx on public.recordings (language_code);
create index recordings_type_created_idx on public.recordings (recording_type, created_at desc);

create function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recordings_set_updated_at before update on public.recordings
for each row execute function public.set_updated_at();
alter table public.recordings enable row level security;

create policy "Users can read their recordings" on public.recordings for select using (auth.uid() = user_id);
create policy "Users can insert their recordings" on public.recordings for insert with check (auth.uid() = user_id);
create policy "Users can update their recordings" on public.recordings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their recordings" on public.recordings for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recording-audio', 'recording-audio', false, 52428800,
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/webm', 'video/mp4', 'video/webm']);

create policy "Users can read their audio folder" on storage.objects for select
  using (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can upload to their audio folder" on storage.objects for insert
  with check (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can update their audio folder" on storage.objects for update
  using (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete their audio folder" on storage.objects for delete
  using (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
