import { isTextToSpeechRecording } from "./recording-type.js";

const selectors = {
  analysis: "#tts-analysis",
  apiKey: "#api-key",
  audio: "#tts-audio",
  characterCount: "#tts-character-count",
  characterLimit: "#tts-character-limit",
  download: "#tts-download",
  formError: "#tts-form-error",
  generate: "#tts-generate",
  idle: "#tts-idle",
  libraryList: "#tts-library-list",
  libraryStatus: "#tts-library-status",
  model: "#tts-model",
  modelLimitNote: "#tts-model-limit-note",
  processing: "#tts-processing",
  refreshLibrary: "#tts-refresh-library",
  refreshVoices: "#tts-refresh-voices",
  result: "#tts-result",
  resultMeta: "#tts-result-meta",
  resultTitle: "#tts-result-title",
  saveStatus: "#tts-save-status",
  similarity: "#tts-similarity",
  similarityValue: "#tts-similarity-value",
  stability: "#tts-stability",
  stabilityValue: "#tts-stability-value",
  text: "#tts-text",
  toggleReading: "#tts-toggle-reading",
  toggleRomaji: "#tts-toggle-romaji",
  toggleTranslation: "#tts-toggle-translation",
  v3Cancel: "#tts-v3-cancel",
  v3Confirm: "#tts-v3-confirm",
  v3Warning: "#tts-v3-warning",
  v3WarningMessage: "#tts-v3-warning-message",
  voice: "#tts-voice",
};

const DEFAULT_TTS_MAX_CHARACTERS = 10_000;
const ELEVEN_V3_MAX_CHARACTERS = 300;
const ELEVEN_V3_WARNING_CHARACTERS = 100;
const DEFAULT_TTS_VOICE_ID = "3JDquces8E8bkmvbh6Bc";
const REMOVED_TTS_VOICE_IDS = new Set(["21m00Tcm4TlvDq8ikWAM"]);
const PRESET_TTS_VOICES = [
  { id: DEFAULT_TTS_VOICE_ID, name: "Male - Standard (Otani)" },
  { id: "Mv8AjrYZCBkdsmDHNwcB", name: "Male - Kanto (Ishibashi)" },
  { id: "WQz3clzUdMqvBf0jswZQ", name: "Female - Standard (Shizuka)" },
  { id: "T7yYq3WpB94yAuOXraRi", name: "Female - Kanto (Konoha)" },
];

const state = {
  audioUrl: "",
  generatedFileName: "text-to-speech.mp3",
  generation: null,
  isGenerating: false,
  v3ConfirmationResolve: null,
};

export function getTtsTextPolicy(modelId, characterCount) {
  const isV3 = modelId === "eleven_v3";
  const maximum = isV3 ? ELEVEN_V3_MAX_CHARACTERS : DEFAULT_TTS_MAX_CHARACTERS;
  return {
    maximum,
    requiresConfirmation: isV3 && characterCount > ELEVEN_V3_WARNING_CHARACTERS && characterCount <= maximum,
    tooLong: characterCount > maximum,
  };
}

export function mergeTtsVoices(accountVoices = []) {
  const voicesById = new Map(PRESET_TTS_VOICES.map((voice) => [voice.id, voice]));
  for (const voice of accountVoices) {
    if (!voice?.id || REMOVED_TTS_VOICE_IDS.has(voice.id) || voicesById.has(voice.id)) continue;
    voicesById.set(voice.id, voice);
  }
  return [...voicesById.values()];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "Không rõ ngày";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function base64AudioUrl(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || "audio/mpeg" }));
}

function revokeGeneratedAudioUrl() {
  if (state.audioUrl.startsWith("blob:")) URL.revokeObjectURL(state.audioUrl);
}

function closeV3Warning(elements, confirmed = false) {
  elements.v3Warning.hidden = true;
  const resolve = state.v3ConfirmationResolve;
  state.v3ConfirmationResolve = null;
  resolve?.(confirmed);
}

function requestV3Confirmation(elements, characterCount) {
  closeV3Warning(elements, false);
  elements.v3WarningMessage.textContent =
    `Nội dung hiện có ${characterCount.toLocaleString("vi-VN")} ký tự, đã vượt ngưỡng cảnh báo 100 ký tự của ứng dụng. Bạn có chắc muốn tiếp tục?`;
  elements.v3Warning.hidden = false;
  elements.v3Confirm.focus();
  return new Promise((resolve) => {
    state.v3ConfirmationResolve = resolve;
  });
}

function updateTextLimits(elements) {
  const policy = getTtsTextPolicy(elements.model.value, elements.text.value.length);
  elements.text.maxLength = policy.maximum;
  elements.characterCount.textContent = elements.text.value.length.toLocaleString("vi-VN");
  elements.characterLimit.textContent = policy.maximum.toLocaleString("vi-VN");
  elements.modelLimitNote.textContent =
    elements.model.value === "eleven_v3"
      ? "Eleven v3: tối đa 300 ký tự; cần xác nhận nếu vượt 100 ký tự."
      : "Flash v2.5 hỗ trợ tối đa 10.000 ký tự mỗi lần.";
  elements.characterCount.closest("strong")?.classList.toggle("is-over-limit", policy.tooLong);
}

function setTtsState(view, elements) {
  elements.idle.hidden = view !== "idle";
  elements.processing.hidden = view !== "processing";
  elements.result.hidden = view !== "result";
}

function selectedVoice(elements) {
  return elements.voice.options[elements.voice.selectedIndex];
}

function renderVoiceOptions(elements, accountVoices = []) {
  const voices = mergeTtsVoices(accountVoices);
  let savedVoiceId = localStorage.getItem("elevenlabs-voice-id");
  if (REMOVED_TTS_VOICE_IDS.has(savedVoiceId)) {
    localStorage.removeItem("elevenlabs-voice-id");
    savedVoiceId = null;
  }
  const selectedVoiceId = voices.some((voice) => voice.id === savedVoiceId)
    ? savedVoiceId
    : DEFAULT_TTS_VOICE_ID;
  elements.voice.innerHTML = voices
    .map(
      (voice) => `<option value="${escapeHtml(voice.id)}"${voice.id === selectedVoiceId ? " selected" : ""}>${escapeHtml(voice.name)}${voice.language ? ` · ${escapeHtml(voice.language)}` : ""}</option>`,
    )
    .join("");
}

function renderAnalysis(generation, elements) {
  const sentence = generation.japanese?.sentences?.[0];
  if (!sentence) {
    elements.analysis.innerHTML = `<p class="tts-plain-text">${escapeHtml(generation.text)}</p>`;
    return;
  }

  const phrases = (sentence.phrases || [])
    .map((phrase) => {
      const surface = escapeHtml(phrase.surface);
      const reading = escapeHtml(phrase.reading);
      return `
        <span class="reading-phrase">
          ${phrase.hasKanji && reading ? `<ruby><span class="ruby-surface">${surface}</span><rt>${reading}</rt></ruby>` : `<span>${surface}</span>`}
          ${phrase.romaji ? `<small class="romaji">${escapeHtml(phrase.romaji)}</small>` : ""}
        </span>`;
    })
    .join("");
  elements.analysis.innerHTML = `
    <div class="tts-japanese-line">${phrases || escapeHtml(generation.text)}</div>
    <p class="translation-line ${sentence.translationVi ? "" : "is-placeholder"}">
      <strong>VI</strong><span>${escapeHtml(sentence.translationVi || "Chưa thể dịch tự động. Bạn vẫn có thể nghe audio đã tạo.")}</span>
    </p>`;
}

function renderGeneration(generation, elements, { fileName } = {}) {
  revokeGeneratedAudioUrl();
  state.generation = generation;
  state.generatedFileName = fileName || `${generation.text.replace(/\s+/g, " ").slice(0, 54) || "text-to-speech"}.mp3`;
  state.audioUrl = generation.audioBase64
    ? base64AudioUrl(generation.audioBase64, generation.mimeType)
    : generation.audioUrl || "";
  elements.audio.src = state.audioUrl;
  elements.resultTitle.textContent = generation.voiceName || "ElevenLabs voice";
  elements.resultMeta.textContent = `${generation.modelId || "ElevenLabs"}${generation.languageCode ? ` · ${generation.languageCode.toUpperCase()}` : ""}`;
  elements.saveStatus.textContent = generation.cache?.hit
    ? "Đã mở từ thư viện"
    : generation.cache?.saved
      ? "Đã lưu Supabase"
      : "Chưa bật cloud storage";
  renderAnalysis(generation, elements);
  setTtsState("result", elements);
}

async function loadVoices(elements) {
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    elements.formError.textContent = "Nhập API key trước khi tải danh sách voice.";
    return;
  }

  elements.refreshVoices.disabled = true;
  elements.refreshVoices.textContent = "Đang tải...";
  elements.formError.textContent = "";
  try {
    const response = await fetch("/api/elevenlabs/voices", { headers: { "X-Api-Key": apiKey } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể tải danh sách voice.");
    renderVoiceOptions(elements, Array.isArray(result.voices) ? result.voices : []);
  } catch (error) {
    elements.formError.textContent = error instanceof Error ? error.message : "Không thể tải danh sách voice.";
  } finally {
    elements.refreshVoices.disabled = false;
    elements.refreshVoices.textContent = "Tải voices";
  }
}

async function loadLibrary(elements) {
  elements.refreshLibrary.disabled = true;
  elements.libraryStatus.textContent = "Đang tải danh sách...";
  try {
    const response = await fetch("/api/recordings?type=text_to_speech&limit=100");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể tải câu đã đọc.");
    if (!result.configured) {
      elements.libraryStatus.textContent = "Chưa cấu hình Supabase trên server.";
      elements.libraryList.innerHTML = "";
      return;
    }

    const recordings = (Array.isArray(result.recordings) ? result.recordings : []).filter(
      isTextToSpeechRecording,
    );
    elements.libraryStatus.textContent = recordings.length
      ? `${recordings.length} câu và audio đã lưu`
      : "Chưa có câu Text to Speech nào.";
    elements.libraryList.innerHTML = recordings
      .map(
        (recording) => `
          <button class="library-item" type="button" data-tts-recording-id="${escapeHtml(recording.id)}">
            <span class="library-file-icon tts-file-icon">TTS</span>
            <span class="library-file-copy">
              <strong>${escapeHtml(recording.source_text || recording.file_name)}</strong>
              <small>${formatDate(recording.created_at)} · ${formatBytes(recording.file_size)}${recording.language_code ? ` · ${escapeHtml(recording.language_code.toUpperCase())}` : ""}</small>
            </span>
            <span class="library-arrow">›</span>
          </button>`,
      )
      .join("");
  } catch (error) {
    elements.libraryStatus.textContent = error instanceof Error ? error.message : "Không thể tải câu đã đọc.";
    elements.libraryList.innerHTML = "";
  } finally {
    elements.refreshLibrary.disabled = false;
  }
}

async function openRecording(recordingId, elements) {
  elements.libraryStatus.textContent = "Đang mở câu đã lưu...";
  try {
    const response = await fetch(`/api/recordings/${encodeURIComponent(recordingId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể mở câu đã lưu.");
    const recording = result.recording;
    if (!isTextToSpeechRecording(recording)) throw new Error("Bản ghi này không phải Text to Speech.");
    elements.text.value = recording.sourceText || recording.transcript?.text || "";
    elements.characterCount.textContent = elements.text.value.length.toLocaleString("vi-VN");
    renderGeneration(
      {
        ...recording.transcript,
        audioUrl: recording.audioUrl,
        cache: { hit: true, saved: true, recordingId: recording.id },
      },
      elements,
      { fileName: recording.fileName },
    );
    elements.libraryStatus.textContent = "Đã mở audio từ Supabase.";
  } catch (error) {
    elements.libraryStatus.textContent = error instanceof Error ? error.message : "Không thể mở câu đã lưu.";
  }
}

async function generate(elements) {
  if (state.isGenerating) return;
  const apiKey = elements.apiKey.value.trim();
  const text = elements.text.value.trim();
  const voice = selectedVoice(elements);
  const textPolicy = getTtsTextPolicy(elements.model.value, text.length);
  if (!apiKey) {
    elements.formError.textContent = "Vui lòng nhập ElevenLabs API key.";
    return;
  }
  if (!text) {
    elements.formError.textContent = "Vui lòng nhập câu cần đọc.";
    elements.text.focus();
    return;
  }
  if (!elements.voice.value) {
    elements.formError.textContent = "Vui lòng tải và chọn một voice ElevenLabs.";
    return;
  }

  if (textPolicy.tooLong) {
    elements.formError.textContent = `Model ${elements.model.value} chỉ cho phép tối đa ${textPolicy.maximum.toLocaleString("vi-VN")} ký tự mỗi lần.`;
    elements.text.focus();
    return;
  }

  let confirmV3LongText = false;
  if (textPolicy.requiresConfirmation) {
    confirmV3LongText = await requestV3Confirmation(elements, text.length);
    if (!confirmV3LongText) return;
  }

  state.isGenerating = true;
  elements.generate.disabled = true;
  elements.formError.textContent = "";
  setTtsState("processing", elements);
  try {
    const response = await fetch("/api/text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({
        text,
        voiceId: elements.voice.value,
        voiceName: voice?.textContent?.split(" · ")[0] || "ElevenLabs voice",
        modelId: elements.model.value,
        confirmV3LongText,
        stability: Number(elements.stability.value),
        similarityBoost: Number(elements.similarity.value),
        translate: true,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể tạo audio.");
    renderGeneration(result.generation, elements);
    await loadLibrary(elements);
  } catch (error) {
    elements.formError.textContent = error instanceof Error ? error.message : "Không thể tạo audio.";
    setTtsState(state.generation ? "result" : "idle", elements);
  } finally {
    state.isGenerating = false;
    elements.generate.disabled = false;
  }
}

export function initTextToSpeech() {
  const elements = Object.fromEntries(
    Object.entries(selectors).map(([key, selector]) => [
      key,
      document.querySelector(selector),
    ]),
  );
  if (!elements.audio || !elements.text) return;
  renderVoiceOptions(elements);
  elements.text.addEventListener("input", () => {
    closeV3Warning(elements, false);
    updateTextLimits(elements);
  });
  elements.model.addEventListener("change", () => {
    closeV3Warning(elements, false);
    updateTextLimits(elements);
  });
  elements.v3Cancel.addEventListener("click", () => closeV3Warning(elements, false));
  elements.v3Confirm.addEventListener("click", () => closeV3Warning(elements, true));
  elements.refreshVoices.addEventListener("click", () => loadVoices(elements));
  elements.voice.addEventListener("change", () => localStorage.setItem("elevenlabs-voice-id", elements.voice.value));
  elements.refreshLibrary.addEventListener("click", () => loadLibrary(elements));
  elements.libraryList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-tts-recording-id]");
    if (item) openRecording(item.dataset.ttsRecordingId, elements);
  });
  elements.generate.addEventListener("click", () => generate(elements));
  elements.text.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") generate(elements);
  });
  elements.download.addEventListener("click", () => {
    if (!state.audioUrl) return;
    const anchor = document.createElement("a");
    anchor.href = state.audioUrl;
    anchor.download = state.generatedFileName;
    anchor.click();
  });
  elements.toggleReading.addEventListener("click", () => {
    elements.result.classList.toggle("hide-reading");
    elements.toggleReading.classList.toggle("is-active");
  });
  elements.toggleRomaji.addEventListener("click", () => {
    elements.result.classList.toggle("show-romaji");
    elements.toggleRomaji.classList.toggle("is-active");
  });
  elements.toggleTranslation.addEventListener("click", () => {
    elements.result.classList.toggle("hide-translation");
    elements.toggleTranslation.classList.toggle("is-active");
  });
  for (const [input, output] of [
    [elements.stability, elements.stabilityValue],
    [elements.similarity, elements.similarityValue],
  ]) {
    input.addEventListener("input", () => {
      output.textContent = `${Math.round(Number(input.value) * 100)}%`;
    });
  }
  window.addEventListener("beforeunload", revokeGeneratedAudioUrl);
  window.addEventListener("app:viewchange", (event) => {
    if (event.detail?.view !== "tts") {
      elements.audio.pause();
      closeV3Warning(elements, false);
    }
  });

  updateTextLimits(elements);
  loadLibrary(elements);
  if (elements.apiKey.value) loadVoices(elements);
}
