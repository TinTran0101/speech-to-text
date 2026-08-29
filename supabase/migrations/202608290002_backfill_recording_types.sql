-- Repair records created before recording_type existed or before it was populated correctly.
update public.recordings
set
  recording_type = 'text_to_speech',
  source_text = coalesce(source_text, transcript_json ->> 'text')
where transcript_json ->> 'kind' = 'text_to_speech'
  and (
    recording_type is distinct from 'text_to_speech'
    or source_text is null
  );

update public.recordings
set recording_type = 'speech_to_text'
where transcript_json ->> 'kind' = 'speech_to_text'
  and recording_type is distinct from 'speech_to_text';

create index if not exists recordings_type_created_idx
  on public.recordings (recording_type, created_at desc);
