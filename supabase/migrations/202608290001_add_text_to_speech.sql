-- Store Speech-to-Text and Text-to-Speech items in the same recordings library.
alter table public.recordings
  add column if not exists recording_type text not null default 'speech_to_text';

alter table public.recordings
  add column if not exists source_text text;

alter table public.recordings
  drop constraint if exists recordings_recording_type_check;

alter table public.recordings
  add constraint recordings_recording_type_check
  check (recording_type in ('speech_to_text', 'text_to_speech'));

create index if not exists recordings_type_created_idx
  on public.recordings (recording_type, created_at desc);
