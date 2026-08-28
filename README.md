# Transcript Studio

Ung dung web cuc bo de tai audio len ElevenLabs Speech-to-Text, hien transcript theo moc thoi gian va phan biet nguoi noi.

## Chay ung dung

Yeu cau Node.js 20 tro len.

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
