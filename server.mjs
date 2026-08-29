import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeJapaneseSentences, looksJapanese } from "./src/japanese.mjs";
import {
  findCachedRecording,
  getRecording,
  hashAudio,
  listRecordings,
  saveRecording,
  storageStatus,
  updateRecordingTranscript,
  verifyStorageConnection,
} from "./src/storage.mjs";

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const MAX_TTS_CHARACTERS = 10_000;
const STT_MODEL_ID = "scribe_v2";
const DEFAULT_TTS_MODEL_ID = "eleven_flash_v2_5";
const TTS_MODEL_IDS = new Set([DEFAULT_TTS_MODEL_ID, "eleven_v3"]);
const ELEVEN_V3_MAX_CHARACTERS = 300;
const ELEVEN_V3_WARNING_CHARACTERS = 100;
const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function elevenLabsErrorMessage(result, fallback) {
  const detail = result?.detail;
  return typeof detail === "string"
    ? detail
    : detail?.message || result?.message || result?.error || fallback;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_AUDIO_BYTES) {
        reject(new Error("File vuot qua gioi han 500 MB."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const buffer = await readRequestBody(request);
  if (buffer.length > 1024 * 1024) throw new Error("JSON vuot qua gioi han 1 MB.");
  return JSON.parse(buffer.toString("utf8") || "{}");
}

function normalizeTimedWords(result) {
  const words = [];
  let pending = "";
  for (const item of Array.isArray(result.words) ? result.words : []) {
    const timed = Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end));
    if (!timed) {
      if (item.text?.trim() && words.length) words.at(-1).text += item.text;
      else pending += item.text || "";
      continue;
    }
    words.push({
      start: Number(item.start),
      end: Number(item.end),
      speaker: item.speaker_id || words.at(-1)?.speaker || "speaker_0",
      text: pending + (item.text || ""),
    });
    pending = "";
  }
  if (pending && words.length) words.at(-1).text += pending;
  return words;
}

function transcriptSegments(result) {
  const segments = [];
  for (const word of normalizeTimedWords(result)) {
    const current = segments.at(-1);
    if (
      !current ||
      current.speaker !== word.speaker ||
      word.start - current.end > 1.35 ||
      word.end - current.start > 28
    ) {
      segments.push({
        id: segments.length,
        start: word.start,
        end: word.end,
        speaker: word.speaker,
        text: word.text,
      });
    } else {
      current.text += word.text;
      current.end = word.end;
    }
  }
  return segments;
}

async function enrichJapanese(result, languageCode) {
  const segments = transcriptSegments(result);
  const japanese =
    languageCode === "ja" || result.language_code === "ja" || segments.some((item) => looksJapanese(item.text));
  if (!japanese || !segments.length) return false;

  const existingSentences = Array.isArray(result.japanese?.sentences) ? result.japanese.sentences : [];
  const translationsComplete =
    existingSentences.length === segments.length &&
    existingSentences.every((sentence) => !String(sentence.text || "").trim() || String(sentence.translationVi || "").trim());
  if (translationsComplete) {
    result.japanese.translationEnabled = true;
    return false;
  }

  result.japanese = await analyzeJapaneseSentences(
    segments.map((segment) => ({ id: segment.id, text: segment.text })),
  );
  return result.japanese.sentences.some((sentence) => sentence.translationVi);
}

async function handleTranscription(request, response) {
  const apiKey = request.headers["x-api-key"];
  const rawFileName = request.headers["x-file-name"] || "audio-file";
  const modelId = STT_MODEL_ID;
  const languageCode = request.headers["x-language-code"];

  if (!apiKey || typeof apiKey !== "string") {
    sendJson(response, 400, { error: "Vui long nhap ElevenLabs API key." });
    return;
  }

  const contentLength = Number(request.headers["content-length"] || 0);
  if (!contentLength) {
    sendJson(response, 400, { error: "Khong tim thay du lieu audio." });
    return;
  }
  if (contentLength > MAX_AUDIO_BYTES) {
    sendJson(response, 413, { error: "File vuot qua gioi han 500 MB." });
    return;
  }

  try {
    const audioBuffer = await readRequestBody(request);
    const formData = new FormData();
    const fileName = decodeURIComponent(String(rawFileName)).replace(/[\\/]/g, "_");
    const contentType = request.headers["content-type"] || "application/octet-stream";
    const fileHash = hashAudio(audioBuffer);
    const cacheKey = hashAudio(
      Buffer.from(`${fileHash}:${modelId}:${languageCode || "auto"}:kanji-google-v2`),
    );
    const cached = await findCachedRecording(cacheKey);

    if (cached?.transcript_json) {
      const translationAdded = await enrichJapanese(
        cached.transcript_json,
        cached.transcript_json.language_code || languageCode,
      );
      if (translationAdded) await updateRecordingTranscript(cached.id, cached.transcript_json);
      sendJson(response, 200, {
        ...cached.transcript_json,
        cache: { hit: true, recordingId: cached.id },
      });
      return;
    }

    formData.append("file", new Blob([audioBuffer], { type: contentType }), fileName);
    formData.append("model_id", String(modelId));
    formData.append("diarize", "true");
    formData.append("tag_audio_events", "true");
    formData.append("timestamps_granularity", "word");
    if (languageCode && languageCode !== "auto") {
      formData.append("language_code", String(languageCode));
    }

    const elevenLabsResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: formData,
    });

    const rawResponse = await elevenLabsResponse.text();
    let result;
    try {
      result = JSON.parse(rawResponse);
    } catch {
      result = { error: rawResponse || "ElevenLabs tra ve phan hoi khong hop le." };
    }

    if (!elevenLabsResponse.ok) {
      const detail = result?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : detail?.message || result?.message || result?.error || "Khong the xu ly audio.";
      sendJson(response, elevenLabsResponse.status, { error: message, detail: result });
      return;
    }

    await enrichJapanese(result, languageCode);
    result.kind = "speech_to_text";
    const saved = await saveRecording({
      audioBuffer,
      cacheKey,
      contentType,
      fileHash,
      fileName,
      languageCode: result.language_code || languageCode,
      modelId,
      transcript: result,
    });
    result.cache = { hit: false, saved: Boolean(saved), recordingId: saved?.id || null };
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Loi khong xac dinh.";
    sendJson(response, 500, { error: message });
  }
}

async function handleJapaneseAnalysis(request, response) {
  try {
    const body = await readJsonBody(request);
    const sentences = Array.isArray(body.sentences) ? body.sentences.slice(0, 100) : [];
    if (!sentences.length) {
      sendJson(response, 400, { error: "Vui long gui danh sach cau tieng Nhat." });
      return;
    }
    sendJson(response, 200, await analyzeJapaneseSentences(sentences, { translate: body.translate !== false }));
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : "JSON khong hop le." });
  }
}

async function handleVoiceList(request, response) {
  const apiKey = request.headers["x-api-key"];
  if (!apiKey || typeof apiKey !== "string") {
    sendJson(response, 400, { error: "Vui long nhap ElevenLabs API key." });
    return;
  }

  try {
    let elevenLabsResponse = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
      headers: { "xi-api-key": apiKey },
    });
    if (elevenLabsResponse.status === 404) {
      elevenLabsResponse = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
      });
    }

    const result = await elevenLabsResponse.json().catch(() => ({}));
    if (!elevenLabsResponse.ok) {
      sendJson(response, elevenLabsResponse.status, {
        error: elevenLabsErrorMessage(result, "Khong the tai danh sach giong doc."),
      });
      return;
    }

    const voices = (Array.isArray(result.voices) ? result.voices : [])
      .map((voice) => ({
        id: voice.voice_id,
        name: voice.name || "ElevenLabs voice",
        category: voice.category || voice.labels?.use_case || "voice",
        language: voice.labels?.language || voice.labels?.accent || null,
        previewUrl: voice.preview_url || null,
      }))
      .filter((voice) => voice.id);
    sendJson(response, 200, { voices });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Khong the ket noi ElevenLabs.",
    });
  }
}

async function handleTextToSpeech(request, response) {
  const apiKey = request.headers["x-api-key"];
  if (!apiKey || typeof apiKey !== "string") {
    sendJson(response, 400, { error: "Vui long nhap ElevenLabs API key." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const text = String(body.text || "").trim();
    const voiceId = String(body.voiceId || "").trim();
    const requestedModelId = String(body.modelId || DEFAULT_TTS_MODEL_ID).trim();
    if (!TTS_MODEL_IDS.has(requestedModelId)) {
      sendJson(response, 400, { error: "Model Text to Speech khong duoc ho tro." });
      return;
    }
    const modelId = requestedModelId;
    const outputFormat = "mp3_44100_128";
    const languageCode = String(body.languageCode || (looksJapanese(text) ? "ja" : "auto"));
    const shouldTranslate = body.translate !== false;
    const voiceSettings = {
      stability: clampNumber(body.stability, 0.5, 0, 1),
      similarity_boost: clampNumber(body.similarityBoost, 0.75, 0, 1),
      style: clampNumber(body.style, 0, 0, 1),
      use_speaker_boost: body.useSpeakerBoost !== false,
    };

    if (!text) {
      sendJson(response, 400, { error: "Vui long nhap noi dung can doc." });
      return;
    }
    if (text.length > MAX_TTS_CHARACTERS) {
      sendJson(response, 413, { error: `Noi dung vuot qua ${MAX_TTS_CHARACTERS.toLocaleString("vi-VN")} ky tu.` });
      return;
    }
    if (modelId === "eleven_v3" && text.length > ELEVEN_V3_MAX_CHARACTERS) {
      sendJson(response, 413, {
        error: `Eleven v3 chi cho phep toi da ${ELEVEN_V3_MAX_CHARACTERS} ky tu moi lan.`,
      });
      return;
    }
    if (
      modelId === "eleven_v3" &&
      text.length > ELEVEN_V3_WARNING_CHARACTERS &&
      body.confirmV3LongText !== true
    ) {
      sendJson(response, 409, {
        error: `Noi dung Eleven v3 dai hon ${ELEVEN_V3_WARNING_CHARACTERS} ky tu va can xac nhan.`,
        requiresConfirmation: true,
      });
      return;
    }
    if (!voiceId) {
      sendJson(response, 400, { error: "Vui long chon giong doc ElevenLabs." });
      return;
    }

    const cacheKey = hashAudio(
      Buffer.from(
        `tts:${text}:${voiceId}:${modelId}:${outputFormat}:${JSON.stringify(voiceSettings)}:${shouldTranslate}:kanji-google-v1`,
      ),
    );
    const cached = await findCachedRecording(cacheKey);
    if (cached) {
      const recording = await getRecording(cached.id);
      if (recording?.audioUrl) {
        sendJson(response, 200, {
          generation: {
            ...recording.transcript,
            audioUrl: recording.audioUrl,
            cache: { hit: true, saved: true, recordingId: recording.id },
          },
        });
        return;
      }
    }

    const japanese = looksJapanese(text)
      ? await analyzeJapaneseSentences([{ id: 0, text }], { translate: shouldTranslate })
      : null;
    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: voiceSettings,
        }),
      },
    );

    if (!elevenLabsResponse.ok) {
      const rawResponse = await elevenLabsResponse.text();
      let result;
      try {
        result = JSON.parse(rawResponse);
      } catch {
        result = { error: rawResponse };
      }
      sendJson(response, elevenLabsResponse.status, {
        error: elevenLabsErrorMessage(result, "ElevenLabs khong the tao audio."),
        detail: result,
      });
      return;
    }

    const audioBuffer = Buffer.from(await elevenLabsResponse.arrayBuffer());
    const title = text.replace(/\s+/g, " ").slice(0, 54);
    const generatedAt = new Date().toISOString();
    const generation = {
      kind: "text_to_speech",
      text,
      voiceId,
      voiceName: String(body.voiceName || "ElevenLabs voice"),
      modelId,
      languageCode,
      outputFormat,
      japanese,
      generatedAt,
    };
    const saved = await saveRecording({
      audioBuffer,
      cacheKey,
      contentType: "audio/mpeg",
      fileHash: hashAudio(audioBuffer),
      fileName: `${title || "text-to-speech"}.mp3`,
      languageCode,
      modelId,
      recordingType: "text_to_speech",
      sourceText: text,
      transcript: generation,
    });

    sendJson(response, 200, {
      generation: {
        ...generation,
        audioBase64: audioBuffer.toString("base64"),
        mimeType: "audio/mpeg",
        cache: { hit: false, saved: Boolean(saved), recordingId: saved?.id || null },
      },
    });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Loi khong xac dinh." });
  }
}

async function handleRecordingList(request, response) {
  const status = storageStatus();
  if (!status.configured) {
    sendJson(response, 200, { configured: false, recordings: [] });
    return;
  }

  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const recordingType =
      requestUrl.searchParams.get("type") === "text_to_speech" ? "text_to_speech" : "speech_to_text";
    const recordings = await listRecordings(requestUrl.searchParams.get("limit") || 100, recordingType);
    sendJson(response, 200, { configured: true, recordings });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Khong the tai thu vien." });
  }
}

async function handleRecordingDetail(recordingId, response) {
  if (!storageStatus().configured) {
    sendJson(response, 503, { error: "Supabase chua duoc cau hinh." });
    return;
  }

  try {
    const recording = await getRecording(recordingId);
    if (!recording) {
      sendJson(response, 404, { error: "Khong tim thay ban ghi." });
      return;
    }
    const translationAdded =
      recording.recordingType === "speech_to_text"
        ? await enrichJapanese(recording.transcript, recording.languageCode)
        : false;
    if (translationAdded) await updateRecordingTranscript(recording.id, recording.transcript);
    sendJson(response, 200, { recording });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Khong the tai ban ghi." });
  }
}

function serveStaticFile(request, response) {
  const pathname = request.url.split("?")[0];
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const relativePath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDirectory, relativePath);

  if (!filePath.startsWith(publicDirectory) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "Khong tim thay tai nguyen." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/transcribe") {
    await handleTranscription(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/japanese/analyze") {
    await handleJapaneseAnalysis(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/text-to-speech") {
    await handleTextToSpeech(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/api/elevenlabs/voices") {
    await handleVoiceList(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/api/status") {
    const storage = storageStatus();
    sendJson(response, 200, {
      ok: true,
      storage: {
        ...storage,
        health: storage.configured ? await verifyStorageConnection() : null,
      },
      japanese: { engine: "kuromoji + wanakana", translation: "google-translate-api-x" },
    });
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/api/recordings?")) {
    await handleRecordingList(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/api/recordings") {
    await handleRecordingList(request, response);
    return;
  }

  const recordingMatch = request.method === "GET" && request.url.match(/^\/api\/recordings\/([0-9a-f-]+)$/i);
  if (recordingMatch) {
    await handleRecordingDetail(recordingMatch[1], response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStaticFile(request, response);
    return;
  }

  sendJson(response, 405, { error: "Phuong thuc khong duoc ho tro." });
});

server.listen(PORT, HOST, () => {
  console.log(`Transcript Studio dang chay tai http://${HOST}:${PORT}`);
});
