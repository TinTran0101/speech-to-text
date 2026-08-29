-- Shared Speech-to-Text and Text-to-Speech schema. Safe to run repeatedly in SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.recordings (
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

-- Upgrade earlier local versions without dropping data.
alter table public.recordings add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.recordings add column if not exists cache_key text;
alter table public.recordings add column if not exists file_hash text;
alter table public.recordings add column if not exists audio_path text;
alter table public.recordings add column if not exists recording_type text not null default 'speech_to_text';
alter table public.recordings add column if not exists source_text text;
alter table public.recordings add column if not exists duration_seconds numeric;
alter table public.recordings add column if not exists updated_at timestamptz not null default now();

alter table public.recordings drop constraint if exists recordings_recording_type_check;
alter table public.recordings add constraint recordings_recording_type_check
  check (recording_type in ('speech_to_text', 'text_to_speech'));

-- Backfill rows that were saved before recording_type was introduced.
update public.recordings
set
  recording_type = 'text_to_speech',
  source_text = coalesce(source_text, transcript_json ->> 'text')
where transcript_json ->> 'kind' = 'text_to_speech';

update public.recordings
set recording_type = 'speech_to_text'
where transcript_json ->> 'kind' = 'speech_to_text';

create unique index if not exists recordings_cache_key_uidx on public.recordings (cache_key);
create index if not exists recordings_file_hash_idx on public.recordings (file_hash);
create index if not exists recordings_created_idx on public.recordings (created_at desc);
create index if not exists recordings_user_created_idx on public.recordings (user_id, created_at desc);
create index if not exists recordings_language_idx on public.recordings (language_code);
create index if not exists recordings_type_created_idx on public.recordings (recording_type, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recordings_set_updated_at on public.recordings;
create trigger recordings_set_updated_at
before update on public.recordings
for each row execute function public.set_updated_at();

alter table public.recordings enable row level security;

drop policy if exists "Users can read their recordings" on public.recordings;
create policy "Users can read their recordings" on public.recordings
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert their recordings" on public.recordings;
create policy "Users can insert their recordings" on public.recordings
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update their recordings" on public.recordings;
create policy "Users can update their recordings" on public.recordings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their recordings" on public.recordings;
create policy "Users can delete their recordings" on public.recordings
  for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recording-audio', 'recording-audio', false, 52428800,
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/webm', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their audio folder" on storage.objects;
create policy "Users can read their audio folder" on storage.objects
  for select using (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can upload to their audio folder" on storage.objects;
create policy "Users can upload to their audio folder" on storage.objects
  for insert with check (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can update their audio folder" on storage.objects;
create policy "Users can update their audio folder" on storage.objects
  for update using (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can delete their audio folder" on storage.objects;
create policy "Users can delete their audio folder" on storage.objects
  for delete using (bucket_id = 'recording-audio' and (storage.foldername(name))[1] = auth.uid()::text);
