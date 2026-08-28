# Transcript Studio

Ung dung web cuc bo de tai audio len ElevenLabs Speech-to-Text, hien transcript theo moc thoi gian va phan biet nguoi noi.

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
- Goi model `scribe_v1` voi diarization va timestamp theo tung tu.
- Dong bo tu dang doc voi audio player va waveform.
- Phan mau transcript theo tung nguoi noi.
- Tim kiem trong transcript, tai file TXT va SRT.
- Tach cum tieng Nhat va tao furigana/romaji bang `kuromoji` + `wanakana` (MIT, chay noi bo).
- Timeline rieng cho tung speaker va cache theo SHA-256 de khong goi lai ElevenLabs cho cung mot file.
- Tai ngay thu vien toi da 100 audio tu Supabase khi mo trang; bam vao file de mo transcript va signed URL audio ma khong goi ElevenLabs.

## Xu ly tieng Nhat

`kuromoji` tach tu/cum va tra ve cach doc Katakana. `wanakana` chuyen cach doc sang Hiragana va Romaji. Hai buoc nay chay trong Node.js, khong can API va khong phat sinh chi phi.

De dich tung cau sang tieng Viet, app ho tro mot LibreTranslate server tu host:

```text
LIBRETRANSLATE_URL=https://translate.example.com
LIBRETRANSLATE_API_KEY=
```

LibreTranslate la ma nguon mo. Chat luong dich Nhat-Viet phu thuoc model cua instance; neu can chat luong cao hon, co the thay adapter bang Gemini/DeepL nhung van giu nguyen lop cache.

## Supabase cache

1. Tao Supabase project va bucket private `recording-audio`.
2. Chay `supabase/schema.sql` trong SQL Editor.
3. Them cac bien trong `.env.example` vao Railway Variables.
4. Khong dua `SUPABASE_SERVICE_ROLE_KEY` ra frontend hoac commit vao GitHub.

Huong dan day du, migration, SQL upsert/query va lenh kiem tra nam tai `supabase/README.md`.

Supabase URL, publishable key va bucket duoc commit trong `src/config.mjs` vi day la cac gia tri public. Moi nen tang deploy chi can them mot secret: `SUPABASE_SERVICE_ROLE_KEY`.

Khi Supabase duoc cau hinh, server se bam SHA-256 file audio. Neu file da ton tai, transcript JSON duoc tra tu cache va ElevenLabs khong bi goi lai.

Theo bang gia Supabase tai thoi diem 2026-08-28, Free Plan gom 1 GB file storage, 500 MB database, 5 GB egress va 2 project active. Project free co the pause sau 1 tuan khong hoat dong. Khoang 100 file chi phu hop neu tong audio duoi 1 GB; nen uu tien MP3/M4A thay vi WAV.

## Deploy Railway

Railway Variables toi thieu:

```text
HOST=0.0.0.0
```

Railway tu cung cap `PORT`. Start command la `npm start`.
