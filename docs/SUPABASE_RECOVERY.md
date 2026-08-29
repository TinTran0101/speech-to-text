# Supabase upgrade and recovery

Tai lieu nay gom hai truong hop:

1. Nang cap database dang chay de ho tro Text to Speech.
2. Tao lai toan bo cau truc Supabase khi project/database bi mat.

## 1. Nang cap database hien tai

Mo **Supabase Dashboard -> SQL Editor -> New query**, paste noi dung cua:

```text
supabase/migrations/202608290001_add_text_to_speech.sql
```

Sau do bam **Run**. Migration nay khong xoa du lieu cu. No chi:

- Them `recording_type` voi gia tri mac dinh `speech_to_text`.
- Them `source_text` de luu cau Text to Speech.
- Gioi han `recording_type` vao `speech_to_text` hoac `text_to_speech`.
- Them index theo loai ban ghi va thoi gian tao.

Kiem tra migration:

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'recordings'
  and column_name in ('recording_type', 'source_text')
order by column_name;
```

Ket qua phai co hai dong `recording_type` va `source_text`.

Neu da tao TTS truoc khi cot `recording_type` duoc them, chay tiep:

```text
supabase/migrations/202608290002_backfill_recording_types.sql
```

Migration nay sua cac dong TTS cu dang bi gan mac dinh thanh `speech_to_text`.

Kiem tra phan loai sau khi backfill:

```sql
select
  recording_type,
  transcript_json ->> 'kind' as json_kind,
  count(*)
from public.recordings
group by recording_type, transcript_json ->> 'kind'
order by recording_type, json_kind;
```

## 2. Tao lai Supabase tu dau

### Buoc 1: Tao project moi

Tao project trong Supabase Dashboard va ghi lai:

- Project URL.
- Secret key hoac legacy `service_role` key.
- Project reference neu dung Supabase CLI.

Khong dua secret/service-role key vao frontend hoac Git.

### Buoc 2: Tao schema, bucket va policies

Mo **SQL Editor -> New query**, paste toan bo file:

```text
supabase/schema.sql
```

Bam **Run**. Day la file canonical de tao lai:

- Extension `pgcrypto`.
- Bang `public.recordings` cho STT va TTS.
- Indexes va trigger `recordings_set_updated_at`.
- RLS policies cua bang.
- Private Storage bucket `recording-audio`.
- Storage policies.

File nay dung `if not exists`, `create or replace` va `drop policy if exists`, vi vay co the chay lai de sua cau truc bi thieu.

### Buoc 3: Cap nhat bien moi truong

Local `.env` hoac Railway Variables:

```text
HOST=0.0.0.0
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_OR_SERVICE_ROLE_KEY
SUPABASE_AUDIO_BUCKET=recording-audio
```

`SUPABASE_SERVICE_ROLE_KEY` la secret bat buoc de Node server doc/ghi database va Storage.

### Buoc 4: Kiem tra trong SQL Editor

```sql
select
  to_regclass('public.recordings') as recordings_table,
  exists (
    select 1
    from storage.buckets
    where id = 'recording-audio' and public = false
  ) as private_audio_bucket;
```

Ket qua mong doi:

- `recordings_table` = `recordings`.
- `private_audio_bucket` = `true`.

Kiem tra cac loai ban ghi:

```sql
select recording_type, count(*)
from public.recordings
group by recording_type
order by recording_type;
```

Database moi co the tra ve 0 dong cho den khi app tao ban ghi dau tien.

### Buoc 5: Kiem tra tu app

Redeploy/restart server, sau do mo:

```text
https://YOUR_APP_DOMAIN/api/status
```

Ket qua mong doi:

```json
{
  "ok": true,
  "storage": {
    "configured": true,
    "health": {
      "connected": true,
      "table": true,
      "bucket": true
    }
  }
}
```

## 3. Gioi han cua viec khoi phuc schema

`supabase/schema.sql` chi tao lai cau truc. No khong the khoi phuc:

- Cac dong transcript/TTS cu trong Postgres.
- Cac file audio cu trong bucket `recording-audio`.
- Secret keys cua project Supabase cu.

Muon khoi phuc day du du lieu, can luu rieng:

1. Backup Postgres cua bang `public.recordings`.
2. Backup tat ca object trong bucket `recording-audio` va giu nguyen duong dan object.
3. Ban sao cac bien moi truong, nhung phai luu trong secret manager, khong commit vao repo.

Sau khi restore rows va audio, `recordings.audio_path` phai trung voi duong dan object trong bucket.

## 4. Chon mot cach khoi tao

Voi project moi, chi chon mot trong hai cach:

- SQL Editor: chay `supabase/schema.sql`.
- Supabase CLI: link project va chay migrations bang `npx supabase db push`.

Khong chay ca `schema.sql` va initial migration tren cung mot project moi trong cung quy trinh khoi tao.
