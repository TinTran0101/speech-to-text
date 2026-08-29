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
  const modelId = request.headers["x-model-id"] || "scribe_v1";
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

async function handleRecordingList(request, response) {
  const status = storageStatus();
  if (!status.configured) {
    sendJson(response, 200, { configured: false, recordings: [] });
    return;
  }

  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const recordings = await listRecordings(requestUrl.searchParams.get("limit") || 100);
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
    const translationAdded = await enrichJapanese(recording.transcript, recording.languageCode);
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
