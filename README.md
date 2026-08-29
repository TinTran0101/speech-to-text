# Transcript Studio

Ung dung web cuc bo de tai audio len ElevenLabs Speech-to-Text, hien transcript theo moc thoi gian va phan biet nguoi noi.

Header co hai che do dung chung ElevenLabs API key:

- Speech to Text: tai audio, tao transcript, timeline, hiragana va ban dich tieng Viet.
- Text to Speech: nhap van ban, chon voice/model, tao MP3 va luu lai cau cung audio.

## Chay ung dung

Yeu cau Node.js 22 tro len. Supabase Realtime hien can native WebSocket co san tu Node 22.

```powershell
npm run dev
```

Mo `http://127.0.0.1:4173`, nhap ElevenLabs API key va chon file audio.

## Bao mat API key

- API key duoc gui toi server dang chay tren may cua ban, sau do server goi ElevenLabs.
- Mac dinh key khong duoc luu.
- Neu bat **Ghi nho tren thiet bi nay**, key duoc luu trong `localStorage` cua trinh duyet.
- Khong commit API key vao source code hoac file `.env`.

## Tinh nang

- Keo tha hoac chon file audio/video co audio.
- Goi model `scribe_v2` voi diarization va timestamp theo tung tu.
- Dong bo tu dang doc voi audio player va waveform.
- Phan mau transcript theo tung nguoi noi.
- Tim kiem trong transcript, tai file TXT va SRT.
- Tach cum tieng Nhat va tao furigana/romaji bang `kuromoji` + `wanakana` (MIT, chay noi bo).
- Timeline rieng cho tung speaker va cache theo SHA-256 de khong goi lai ElevenLabs cho cung mot file.
- Tai ngay thu vien toi da 100 audio tu Supabase khi mo trang; bam vao file de mo transcript va signed URL audio ma khong goi ElevenLabs.

## Xu ly tieng Nhat

`kuromoji` tach tu/cum va tra ve cach doc Katakana. `wanakana` chuyen cach doc sang Hiragana va Romaji. Hai buoc nay chay trong Node.js, khong can API va khong phat sinh chi phi.

Moi cau tieng Nhat duoc dich tu dong sang tieng Viet bang `google-translate-api-x` va hien ngay ben duoi cau goc. App gui nhieu cau trong mot batch de giam so request, sau do luu ban dich trong transcript cache tren Supabase.

Text to Speech mac dinh dung model `eleven_flash_v2_5` va cho phep chon them `eleven_v3` qua endpoint `POST /v1/text-to-speech/{voice_id}` cua ElevenLabs voi output MP3 44.1 kHz. `eleven_v3` gioi han 300 ky tu moi request va yeu cau xac nhan tren 100 ky tu. Danh sach voice duoc tai qua `/v2/voices` va fallback `/v1/voices`. Cau tieng Nhat van duoc xu ly bang Kuromoji, Wanakana va Google Translate truoc khi luu.

Bon voice tieng Nhat duoc ghim san trong app: Otani, Ishibashi, Shizuka va Konoha. Otani la voice mac dinh; cac voice khac trong tai khoan ElevenLabs van duoc noi them vao dropdown.

Thu vien nay dung endpoint Google Translate khong chinh thuc va khong can API key. Google co the rate-limit hoac thay doi endpoint; khi dich tam thoi that bai, mo lai ban ghi de app thu lai.

## Supabase cache

1. Tao Supabase project va bucket private `recording-audio`.
2. Chay `supabase/schema.sql` trong SQL Editor.
3. Them cac bien trong `.env.example` vao Railway Variables.
4. Khong dua `SUPABASE_SERVICE_ROLE_KEY` ra frontend hoac commit vao GitHub.

Huong dan day du, migration, SQL upsert/query va lenh kiem tra nam tai `supabase/README.md`.

Supabase URL, publishable key va bucket duoc commit trong `src/config.mjs` vi day la cac gia tri public. Moi nen tang deploy chi can them mot secret: `SUPABASE_SERVICE_ROLE_KEY`.

Khi Supabase duoc cau hinh, server se bam SHA-256 file audio. Neu file da ton tai, transcript JSON duoc tra tu cache va ElevenLabs khong bi goi lai.

Neu da dung schema cu, chay migration `supabase/migrations/202608290001_add_text_to_speech.sql`. Ban ghi STT va TTS nam chung trong bang `recordings`, duoc phan biet boi cot `recording_type`.

Neu thu vien TTS dang hien nham audio STT, chay them `supabase/migrations/202608290002_backfill_recording_types.sql` de sua du lieu cu theo `transcript_json.kind`.

Neu can tao lai Supabase sau khi mat database, lam theo `docs/SUPABASE_RECOVERY.md`. File `supabase/schema.sql` la schema day du va co the chay lai an toan.

Theo bang gia Supabase tai thoi diem 2026-08-28, Free Plan gom 1 GB file storage, 500 MB database, 5 GB egress va 2 project active. Project free co the pause sau 1 tuan khong hoat dong. Khoang 100 file chi phu hop neu tong audio duoi 1 GB; nen uu tien MP3/M4A thay vi WAV.

## Deploy Railway

Railway Variables toi thieu:

```text
HOST=0.0.0.0
```

Railway tu cung cap `PORT`. Start command la `npm start`.
