# Kien truc luu tru de tranh goi lai API

## Khuyen nghi

- Supabase Postgres luu metadata va `transcript_json`.
- Supabase Storage bucket private `recording-audio` luu MP3/M4A.
- `cache_key` gom hash SHA-256 cua audio, model, ngon ngu va phien ban pipeline.
- Khi upload lai cung file va cau hinh, server tra transcript cache truoc khi goi ElevenLabs.

Khong luu audio truc tiep vao Postgres `bytea`. File nam trong Storage, database chi luu `audio_path`.

## Supabase Free co du cho 100 file?

Tai ngay 2026-08-28, trang pricing chinh thuc ghi Free Plan co:

- 1 GB file storage.
- 500 MB database.
- 5 GB egress va 5 GB cached egress.
- 2 active projects; project co the pause sau 1 tuan khong hoat dong.

100 file phu hop khi trung binh moi file duoi khoang 10 MB. Vi du gan dung:

| Dinh dang | Bitrate | Dung luong 10 phut | 100 file |
| --- | ---: | ---: | ---: |
| MP3 mono | 64 kbps | 4.8 MB | 480 MB |
| MP3 | 128 kbps | 9.6 MB | 960 MB |
| WAV mono 16-bit 44.1 kHz | 705 kbps | 52.9 MB | 5.3 GB |

Nen chuyen WAV sang MP3/M4A truoc khi luu. Database 500 MB rat du cho transcript JSON cua 100 file; storage va egress moi la gioi han can theo doi.

## Bao mat truoc khi mo app cong khai

`SUPABASE_SERVICE_ROLE_KEY` chi duoc dat trong Railway Variables. Khong dua key nay vao frontend.

Schema hien tai phu hop cho app mot nguoi dung/server-side cache. Truoc khi tao man hinh thu vien cho nhieu nguoi dung:

1. Bat Supabase Auth.
2. Bat RLS va gan `recordings.user_id = auth.uid()`.
3. Luu audio theo duong dan `<user_id>/<recording_id>.<ext>`.
4. Tao signed URL ngan han khi phat audio.
5. Them rate limit cho `/api/transcribe` de tranh nguoi la lam day bucket.

Neu audio vuot quota, app van co the luu transcript vao Postgres va cache ket qua; nguoi dung se can chon lai file local de nghe.
