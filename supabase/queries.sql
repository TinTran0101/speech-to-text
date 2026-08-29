-- SELECT examples can run directly. Replace placeholders before running mutations.

-- Latest 100 recordings used by the application library.
select id, file_name, file_size, language_code, model_id, duration_seconds,
       audio_path is not null as has_audio, created_at
from public.recordings order by created_at desc limit 100;

-- One recording with transcript JSON.
select * from public.recordings
where id = '00000000-0000-0000-0000-000000000000';

-- Cache lookup before calling ElevenLabs.
select id, transcript_json from public.recordings
where cache_key = 'replace-with-sha256-cache-key' limit 1;

-- Search filename and filter Japanese recordings.
select id, file_name, duration_seconds, created_at from public.recordings
where file_name ilike '%meeting%' order by created_at desc;

select id, file_name, transcript_json ->> 'text' as transcript, created_at
from public.recordings where language_code = 'ja' order by created_at desc;

-- Storage/database statistics.
select count(*) as recording_count,
       pg_size_pretty(coalesce(sum(file_size), 0)::bigint) as total_original_audio_size,
       round(coalesce(sum(duration_seconds), 0) / 3600, 2) as total_audio_hours,
       pg_size_pretty(coalesce(sum(pg_column_size(transcript_json)), 0)::bigint) as transcript_database_size
from public.recordings;

-- Rows where transcript exists but audio upload failed or exceeded the bucket limit.
select id, file_name, file_size, created_at from public.recordings
where audio_path is null order by created_at desc;

-- UPSERT example. Replace every sample value before running.
insert into public.recordings (
  cache_key, file_hash, file_name, file_size, mime_type, audio_path,
  language_code, model_id, duration_seconds, transcript_json
)
values (
  'sample-cache-key', 'sample-file-hash', 'sample.mp3', 123456,
  'audio/mpeg', '2026-08-28/sample.mp3', 'ja', 'scribe_v2', 42.5,
  '{"text":"日本語のサンプルです。","words":[]}'::jsonb
)
on conflict (cache_key) do update set
  file_name = excluded.file_name,
  file_size = excluded.file_size,
  mime_type = excluded.mime_type,
  audio_path = coalesce(excluded.audio_path, public.recordings.audio_path),
  language_code = excluded.language_code,
  model_id = excluded.model_id,
  duration_seconds = excluded.duration_seconds,
  transcript_json = excluded.transcript_json,
  updated_at = now()
returning id, file_name, updated_at;

-- Update one Vietnamese translation in transcript_json.
update public.recordings
set transcript_json = jsonb_set(
  transcript_json, '{japanese,sentences,0,translationVi}',
  to_jsonb('Đây là câu tiếng Nhật mẫu.'::text), true
)
where id = '00000000-0000-0000-0000-000000000000'
returning id, updated_at;

-- Delete the Storage object through the SDK before deleting metadata.
delete from public.recordings
where id = '00000000-0000-0000-0000-000000000000'
returning id, audio_path;
