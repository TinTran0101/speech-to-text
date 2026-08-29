import { isTextToSpeechRecording } from "./recording-type.js";

const selectors = {
  analysis: "#tts-analysis",
  apiKey: "#api-key",
  audio: "#tts-audio",
  brand: ".brand",
  characterCount: "#tts-character-count",
  download: "#tts-download",
  formError: "#tts-form-error",
  generate: "#tts-generate",
  idle: "#tts-idle",
  libraryList: "#tts-library-list",
  libraryStatus: "#tts-library-status",
  model: "#tts-model",
  navButtons: "[data-app-view]",
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
  sttWorkspace: "#stt-workspace",
  text: "#tts-text",
  toggleReading: "#tts-toggle-reading",
  toggleRomaji: "#tts-toggle-romaji",
  toggleTranslation: "#tts-toggle-translation",
  ttsWorkspace: "#tts-workspace",
  voice: "#tts-voice",
};

const state = {
  audioUrl: "",
  generatedFileName: "text-to-speech.mp3",
  generation: null,
  isGenerating: false,
};

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

function setView(view, elements) {
  const isTts = view === "tts";
  elements.sttWorkspace.hidden = isTts;
  elements.ttsWorkspace.hidden = !isTts;
  elements.navButtons.forEach((button) => {
    const active = button.dataset.appView === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}${isTts ? "#tts" : "#stt"}`);
}

function setTtsState(view, elements) {
  elements.idle.hidden = view !== "idle";
  elements.processing.hidden = view !== "processing";
  elements.result.hidden = view !== "result";
}

function selectedVoice(elements) {
  return elements.voice.options[elements.voice.selectedIndex];
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
    const voices = Array.isArray(result.voices) ? result.voices : [];
    if (!voices.length) throw new Error("Tài khoản chưa có voice khả dụng.");
    const savedVoiceId = localStorage.getItem("elevenlabs-voice-id");
    elements.voice.innerHTML = voices
      .map(
        (voice) => `<option value="${escapeHtml(voice.id)}"${voice.id === savedVoiceId ? " selected" : ""}>${escapeHtml(voice.name)}${voice.language ? ` · ${escapeHtml(voice.language)}` : ""}</option>`,
      )
      .join("");
    localStorage.setItem("elevenlabs-voice-id", elements.voice.value);
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
    if (recording.recordingType !== "text_to_speech") throw new Error("Bản ghi này không phải Text to Speech.");
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
      key === "navButtons" ? [...document.querySelectorAll(selector)] : document.querySelector(selector),
    ]),
  );
  if (!elements.ttsWorkspace || !elements.sttWorkspace) return;

  elements.navButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.appView, elements)));
  elements.brand.addEventListener("click", (event) => {
    event.preventDefault();
    setView("stt", elements);
  });
  elements.text.addEventListener("input", () => {
    elements.characterCount.textContent = elements.text.value.length.toLocaleString("vi-VN");
  });
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
  window.addEventListener("hashchange", () => setView(window.location.hash === "#tts" ? "tts" : "stt", elements));

  setView(window.location.hash === "#tts" ? "tts" : "stt", elements);
  loadLibrary(elements);
  if (elements.apiKey.value) loadVoices(elements);
}
