import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
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

    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Loi khong xac dinh.";
    sendJson(response, 500, { error: message });
  }
}

function serveStaticFile(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
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

  if (request.method === "GET" || request.method === "HEAD") {
    serveStaticFile(request, response);
    return;
  }

  sendJson(response, 405, { error: "Phuong thuc khong duoc ho tro." });
});

server.listen(PORT, HOST, () => {
  console.log(`Transcript Studio dang chay tai http://${HOST}:${PORT}`);
});
