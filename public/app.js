const elements = {
  apiKey: document.querySelector("#api-key"),
  audioLibraryList: document.querySelector("#audio-library-list"),
  audio: document.querySelector("#audio-player"),
  currentTime: document.querySelector("#current-time"),
  cacheStatus: document.querySelector("#cache-status"),
  downloadSrt: document.querySelector("#download-srt"),
  downloadTxt: document.querySelector("#download-txt"),
  dropZone: document.querySelector("#drop-zone"),
  duration: document.querySelector("#duration"),
  elapsedTime: document.querySelector("#elapsed-time"),
  emptyState: document.querySelector("#empty-state"),
  fileInput: document.querySelector("#file-input"),
  fileMeta: document.querySelector("#file-meta"),
  fileName: document.querySelector("#file-name"),
  formError: document.querySelector("#form-error"),
  language: document.querySelector("#language"),
  libraryStatus: document.querySelector("#library-status"),
  model: document.querySelector("#model"),
  playbackRate: document.querySelector("#playback-rate"),
  playButton: document.querySelector("#play-button"),
  processingDetail: document.querySelector("#processing-detail"),
  processingState: document.querySelector("#processing-state"),
  rememberKey: document.querySelector("#remember-key"),
  refreshLibrary: document.querySelector("#refresh-library"),
  removeFile: document.querySelector("#remove-file"),
  resultTitle: document.querySelector("#result-title"),
  search: document.querySelector("#search-transcript"),
  selectedFile: document.querySelector("#selected-file"),
  japaneseStatus: document.querySelector("#japanese-status"),
  timelineRuler: document.querySelector("#timeline-ruler"),
  timelineSpeakers: document.querySelector("#timeline-speakers"),
  timelineTracks: document.querySelector("#timeline-tracks"),
  toggleReading: document.querySelector("#toggle-reading"),
  toggleRomaji: document.querySelector("#toggle-romaji"),
  toggleTranslation: document.querySelector("#toggle-translation"),
  toggleKey: document.querySelector("#toggle-key"),
  transcriptList: document.querySelector("#transcript-list"),
  transcriptState: document.querySelector("#transcript-state"),
  waveform: document.querySelector("#waveform"),
  waveformLoading: document.querySelector("#waveform-loading"),
};

const speakerColors = ["#f1c75b", "#73aef5", "#8da840", "#c79336", "#9c6aaa", "#3c9d88"];
const state = {
  activeSegmentIndex: -1,
  activeWordIndex: -1,
  audioFile: null,
  audioUrl: "",
  autoTranscribeTimer: null,
  elapsedTimer: null,
  isTranscribing: false,
  segments: [],
  startedAt: 0,
  transcript: null,
  waveformSamples: [],
  words: [],
};

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatTime(seconds, includeMilliseconds = false) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const base = `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  if (!includeMilliseconds) return base;
  return `${base},${String(Math.floor((safeSeconds % 1) * 1000)).padStart(3, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function speakerName(speakerId) {
  const match = String(speakerId).match(/(\d+)/);
  const number = match ? Number(match[1]) + 1 : 1;
  return `Người ${number}`;
}

function speakerColor(speakerId) {
  const match = String(speakerId).match(/(\d+)/);
  const index = match ? Number(match[1]) : 0;
  return speakerColors[index % speakerColors.length];
}

function setAudioFile(file) {
  if (state.isTranscribing) return;
  if (!file) return;
  if (file.size > 500 * 1024 * 1024) {
    elements.formError.textContent = "File quá lớn. Vui lòng chọn file dưới 500 MB.";
    return;
  }

  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioFile = file;
  state.audioUrl = URL.createObjectURL(file);
  resetTranscript();
  elements.audio.src = state.audioUrl;
  elements.playButton.disabled = false;
  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || "Audio"}`;
  elements.selectedFile.hidden = false;
  elements.dropZone.hidden = true;
  elements.formError.textContent = "";
  buildWaveform(file);
  void transcribe();
}

function formatLibraryDate(value) {
  if (!value) return "Không rõ ngày";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

async function loadRecordings() {
  elements.refreshLibrary.disabled = true;
  elements.libraryStatus.textContent = "Đang tải danh sách...";
  try {
    const response = await fetch("/api/recordings?limit=100");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể tải thư viện.");
    if (!result.configured) {
      elements.libraryStatus.textContent = "Chưa cấu hình Supabase trên server.";
      elements.audioLibraryList.innerHTML = "";
      return;
    }

    const recordings = Array.isArray(result.recordings) ? result.recordings : [];
    elements.libraryStatus.textContent = recordings.length
      ? `${recordings.length} audio đã lưu`
      : "Chưa có audio nào được lưu.";
    elements.audioLibraryList.innerHTML = recordings
      .map(
        (recording) => `
          <button class="library-item" type="button" data-recording-id="${escapeHtml(recording.id)}">
            <span class="library-file-icon">${recording.has_audio ? "▶" : "TXT"}</span>
            <span class="library-file-copy">
              <strong>${escapeHtml(recording.file_name)}</strong>
              <small>${formatLibraryDate(recording.created_at)} · ${formatBytes(recording.file_size)}${recording.language_code ? ` · ${escapeHtml(recording.language_code.toUpperCase())}` : ""}</small>
            </span>
            <span class="library-arrow">›</span>
          </button>`,
      )
      .join("");
  } catch (error) {
    elements.libraryStatus.textContent = error instanceof Error ? error.message : "Không thể tải thư viện.";
    elements.audioLibraryList.innerHTML = "";
  } finally {
    elements.refreshLibrary.disabled = false;
  }
}

async function openRecording(recordingId) {
  elements.libraryStatus.textContent = "Đang mở bản ghi...";
  try {
    const response = await fetch(`/api/recordings/${encodeURIComponent(recordingId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể mở bản ghi.");
    const recording = result.recording;

    if (state.audioUrl?.startsWith("blob:")) URL.revokeObjectURL(state.audioUrl);
    state.audioFile = null;
    state.audioUrl = recording.audioUrl || "";
    state.waveformSamples = Array.from({ length: 180 }, (_, index) => 0.16 + Math.abs(Math.sin(index * 0.31)) * 0.42);
    elements.audio.src = state.audioUrl;
    elements.playButton.disabled = !state.audioUrl;
    renderTranscript({
      ...recording.transcript,
      cache: { hit: true, saved: true, recordingId: recording.id },
    });
    elements.resultTitle.textContent = recording.fileName || "Bản ghi đã lưu";
    setResultView("transcript");
    requestAnimationFrame(drawWaveform);
    elements.libraryStatus.textContent = "Đã tải bản ghi từ Supabase.";
  } catch (error) {
    elements.libraryStatus.textContent = error instanceof Error ? error.message : "Không thể mở bản ghi.";
  }
}

function clearAudioFile() {
  if (state.isTranscribing) return;
  clearTimeout(state.autoTranscribeTimer);
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioFile = null;
  state.audioUrl = "";
  state.waveformSamples = [];
  elements.fileInput.value = "";
  elements.audio.removeAttribute("src");
  elements.selectedFile.hidden = true;
  elements.dropZone.hidden = false;
  resetTranscript();
}

function clearPendingFile() {
  state.audioFile = null;
  elements.fileInput.value = "";
  elements.selectedFile.hidden = true;
  elements.dropZone.hidden = false;
}

function resetTranscript() {
  elements.audio.pause();
  state.activeSegmentIndex = -1;
  state.activeWordIndex = -1;
  state.segments = [];
  state.transcript = null;
  state.words = [];
  elements.search.value = "";
  elements.transcriptList.innerHTML = "";
  setResultView("empty");
}

async function buildWaveform(file) {
  elements.waveformLoading.hidden = false;
  try {
    const audioContext = new AudioContext();
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
    const channel = decoded.getChannelData(0);
    const sampleCount = 180;
    const blockSize = Math.max(1, Math.floor(channel.length / sampleCount));
    state.waveformSamples = Array.from({ length: sampleCount }, (_, index) => {
      let peak = 0;
      const start = index * blockSize;
      const end = Math.min(start + blockSize, channel.length);
      for (let cursor = start; cursor < end; cursor += 1) peak = Math.max(peak, Math.abs(channel[cursor]));
      return peak;
    });
    await audioContext.close();
    drawWaveform();
  } catch {
    state.waveformSamples = Array.from({ length: 100 }, (_, index) => 0.2 + Math.abs(Math.sin(index * 0.43)) * 0.35);
    drawWaveform();
  } finally {
    elements.waveformLoading.hidden = true;
  }
}

function drawWaveform() {
  const canvas = elements.waveform;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !state.waveformSamples.length) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, rect.width, rect.height);

  const progress = elements.audio.duration ? elements.audio.currentTime / elements.audio.duration : 0;
  const gap = 2;
  const barWidth = Math.max(1, rect.width / state.waveformSamples.length - gap);
  state.waveformSamples.forEach((sample, index) => {
    const x = (index / state.waveformSamples.length) * rect.width;
    const height = Math.max(3, sample * rect.height * 0.9);
    context.fillStyle = index / state.waveformSamples.length <= progress ? "#f15a29" : "rgba(255,255,255,.3)";
    context.fillRect(x, (rect.height - height) / 2, barWidth, height);
  });
}

function normalizeWords(result) {
  const words = [];
  let pendingPrefix = "";

  for (const item of Array.isArray(result.words) ? result.words : []) {
    const hasTiming = Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end));
    if (!hasTiming) {
      const extra = item.text || "";
      if (extra.trim() && words.length) words.at(-1).text += extra;
      else pendingPrefix += extra;
      continue;
    }

    words.push({
      end: Number(item.end),
      index: words.length,
      speaker: item.speaker_id || words.at(-1)?.speaker || "speaker_0",
      start: Number(item.start),
      text: pendingPrefix + (item.text || ""),
      type: item.type || "word",
    });
    pendingPrefix = "";
  }

  if (pendingPrefix && words.length) words.at(-1).text += pendingPrefix;
  return words;
}

function groupSegments(words) {
  const segments = [];
  for (const word of words) {
    const current = segments.at(-1);
    const shouldBreak =
      !current ||
      current.speaker !== word.speaker ||
      word.start - current.end > 1.35 ||
      word.end - current.start > 28;

    if (shouldBreak) {
      segments.push({ start: word.start, end: word.end, speaker: word.speaker, words: [word] });
    } else {
      current.words.push(word);
      current.end = word.end;
    }
  }
  return segments;
}

function timedSurfaceMarkup(surface, words, cursor) {
  const originalSurface = String(surface || "");
  let remaining = originalSurface;
  let markup = "";
  const nextCursor = { index: cursor.index, offset: cursor.offset };

  while (remaining && nextCursor.index < words.length) {
    const word = words[nextCursor.index];
    const wordText = String(word.text || "");
    if (!wordText || nextCursor.offset >= wordText.length) {
      nextCursor.index += 1;
      nextCursor.offset = 0;
      continue;
    }

    const available = wordText.slice(nextCursor.offset);
    const leadingWhitespace = available.match(/^\s+/u)?.[0] || "";
    if (leadingWhitespace && !remaining.startsWith(leadingWhitespace)) {
      nextCursor.offset += leadingWhitespace.length;
      continue;
    }

    const maxLength = Math.min(available.length, remaining.length);
    let matchedLength = 0;
    while (matchedLength < maxLength && available[matchedLength] === remaining[matchedLength]) matchedLength += 1;
    if (!matchedLength) return escapeHtml(originalSurface);

    const matchedText = remaining.slice(0, matchedLength);
    markup += `<span class="word japanese-word" data-word-index="${word.index}" data-start="${word.start}">${escapeHtml(matchedText)}</span>`;
    remaining = remaining.slice(matchedLength);
    nextCursor.offset += matchedLength;
    if (nextCursor.offset >= wordText.length) {
      nextCursor.index += 1;
      nextCursor.offset = 0;
    }
  }

  if (remaining) return escapeHtml(originalSurface);
  cursor.index = nextCursor.index;
  cursor.offset = nextCursor.offset;
  return markup;
}

function renderTranscript(result) {
  state.transcript = result;
  state.words = normalizeWords(result);
  state.segments = groupSegments(state.words);
  state.activeSegmentIndex = -1;
  state.activeWordIndex = -1;
  if (!state.segments.length) {
    elements.transcriptList.innerHTML = `<p class="fallback-text">${escapeHtml(result.text || "Không có nội dung được nhận diện.")}</p>`;
    return;
  }

  elements.transcriptList.innerHTML = state.segments
    .map((segment, segmentIndex) => {
      const japanese = result.japanese?.sentences?.find((item) => Number(item.id) === segmentIndex);
      const originalText = segment.words.map((word) => word.text).join("").trim();
      const phraseCursor = { index: 0, offset: 0 };
      const phraseMarkup = japanese?.phrases
        ?.map((phrase) => {
          const surface = timedSurfaceMarkup(phrase.surface, segment.words, phraseCursor);
          const reading = escapeHtml(phrase.reading);
          return `
            <span class="reading-phrase">
              ${phrase.hasKanji && reading ? `<ruby><span class="ruby-surface">${surface}</span><rt>${reading}</rt></ruby>` : `<span>${surface}</span>`}
              ${phrase.romaji ? `<small class="romaji">${escapeHtml(phrase.romaji)}</small>` : ""}
            </span>`;
        })
        .join("");
      const wordMarkup = segment.words
        .map((word) => `<span class="word" data-word-index="${word.index}" data-start="${word.start}">${escapeHtml(word.text)}</span>`)
        .join("");
      const textMarkup = japanese
        ? `<div class="japanese-line">${phraseMarkup || escapeHtml(originalText)}</div>`
        : `<p class="segment-text">${wordMarkup}</p>`;
      const translationMarkup = japanese
        ? `<p class="translation-line ${japanese.translationVi ? "" : "is-placeholder"}"><strong>VI</strong><span>${escapeHtml(japanese.translationVi || "Chưa thể dịch tự động. Hãy thử mở lại bản ghi.")}</span></p>`
        : "";
      return `
        <article class="segment" data-segment-index="${segmentIndex}" style="--speaker-color:${speakerColor(segment.speaker)}">
          <div class="segment-speaker">
            <span>${speakerName(segment.speaker)}</span>
          </div>
          <button class="segment-time-rail" type="button" data-start="${segment.start}" aria-label="Phát từ ${formatTime(segment.start)}">
            <time>${formatTime(segment.start)}</time>
            <span></span>
            <time>${formatTime(segment.end)}</time>
          </button>
          <div class="segment-copy">
            ${textMarkup}
            ${translationMarkup}
          </div>
        </article>`;
    })
    .join("");

  elements.cacheStatus.textContent = result.cache?.hit
    ? "Đã dùng bản cache"
    : result.cache?.saved
      ? "Đã lưu Supabase"
      : "Chưa bật cloud cache";
  const translatedSentenceCount = result.japanese?.sentences?.filter((sentence) => sentence.translationVi).length || 0;
  elements.japaneseStatus.textContent = result.japanese
    ? translatedSentenceCount
      ? `Google dịch ${translatedSentenceCount}/${result.japanese.sentences.length} câu`
      : "Kanji · chưa có bản dịch"
    : "Transcript timeline";
  renderTimeline();
}

function setResultView(view) {
  elements.emptyState.hidden = view !== "empty";
  elements.processingState.hidden = view !== "processing";
  elements.transcriptState.hidden = view !== "transcript";
  document.body.classList.toggle("editor-mode", view === "transcript");
}

function renderTimeline() {
  if (!state.segments.length) return;
  const speakers = [...new Set(state.segments.map((segment) => segment.speaker))];
  const totalDuration = Math.max(elements.audio.duration || 0, state.segments.at(-1)?.end || 1, 1);
  const tickStep = totalDuration > 180 ? 30 : totalDuration > 60 ? 10 : 5;
  const ticks = [];
  for (let second = 0; second <= totalDuration; second += tickStep) {
    ticks.push(`<span style="left:${(second / totalDuration) * 100}%"><i></i>${formatTime(second)}</span>`);
  }
  elements.timelineRuler.innerHTML = ticks.join("");
  elements.timelineSpeakers.innerHTML = speakers
    .map(
      (speaker) => `<div class="timeline-speaker" style="--speaker-color:${speakerColor(speaker)}"><span>${speakerName(speaker)}</span></div>`,
    )
    .join("");
  elements.timelineTracks.innerHTML = `${speakers
    .map((speaker) => {
      const blocks = state.segments
        .filter((segment) => segment.speaker === speaker)
        .map(
          (segment) => `<button type="button" class="timeline-block" data-start="${segment.start}" style="left:${(segment.start / totalDuration) * 100}%;width:${Math.max(((segment.end - segment.start) / totalDuration) * 100, 0.7)}%;--speaker-color:${speakerColor(speaker)}" aria-label="${speakerName(speaker)} ${formatTime(segment.start)}"></button>`,
        )
        .join("");
      return `<div class="timeline-track">${blocks}</div>`;
    })
    .join("")}<i id="timeline-playhead" class="timeline-playhead"></i>`;
}

function startElapsedTimer() {
  state.startedAt = Date.now();
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    elements.elapsedTime.textContent = formatTime(seconds);
    if (seconds > 3) elements.processingDetail.textContent = "Đang nhận diện giọng nói và người nói";
  }, 1000);
}

async function transcribe() {
  if (state.isTranscribing || !state.audioFile) return;
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    elements.formError.textContent = "Nhập API key để hệ thống tự động xử lý file vừa chọn.";
    return;
  }

  const audioFile = state.audioFile;
  const audioUrl = state.audioUrl;
  state.isTranscribing = true;
  elements.dropZone.disabled = true;
  elements.removeFile.disabled = true;
  elements.formError.textContent = "";
  elements.processingDetail.textContent = "Đang tải audio lên";
  elements.elapsedTime.textContent = "00:00";
  setResultView("processing");
  startElapsedTimer();

  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": audioFile.type || "application/octet-stream",
        "X-Api-Key": apiKey,
        "X-File-Name": encodeURIComponent(audioFile.name),
        "X-Language-Code": elements.language.value,
        "X-Model-Id": elements.model.value,
      },
      body: audioFile,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể xử lý file audio.");

    clearInterval(state.elapsedTimer);
    renderTranscript(result);
    elements.resultTitle.textContent = audioFile.name.replace(/\.[^.]+$/, "");
    elements.audio.src = audioUrl;
    setResultView("transcript");
    requestAnimationFrame(drawWaveform);
    clearPendingFile();
    await loadRecordings();
  } catch (error) {
    clearInterval(state.elapsedTimer);
    elements.formError.textContent = error instanceof Error ? error.message : "Đã có lỗi xảy ra.";
    setResultView("empty");
  } finally {
    state.isTranscribing = false;
    elements.dropZone.disabled = false;
    elements.removeFile.disabled = false;
  }
}

function centerSegment(segmentElement) {
  if (!segmentElement) return;
  const containerBounds = elements.transcriptList.getBoundingClientRect();
  const segmentBounds = segmentElement.getBoundingClientRect();
  const centeredTop =
    elements.transcriptList.scrollTop +
    segmentBounds.top -
    containerBounds.top -
    (containerBounds.height - segmentBounds.height) / 2;
  elements.transcriptList.scrollTo({ top: Math.max(0, centeredTop), behavior: "smooth" });
}

function updateActiveWord() {
  const time = elements.audio.currentTime;
  let nextIndex = -1;
  let low = 0;
  let high = state.words.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (state.words[middle].start <= time) {
      nextIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (nextIndex >= 0 && time > state.words[nextIndex].end + 0.25) nextIndex = -1;
  if (nextIndex === state.activeWordIndex) return;

  document.querySelectorAll(".word.is-active").forEach((word) => word.classList.remove("is-active"));
  document.querySelector(".segment.is-active")?.classList.remove("is-active");
  state.activeWordIndex = nextIndex;
  if (nextIndex < 0) {
    state.activeSegmentIndex = -1;
    return;
  }

  const wordElements = [...document.querySelectorAll(`[data-word-index="${nextIndex}"]`)];
  const segmentIndex = state.segments.findIndex((segment) => segment.words.some((word) => word.index === nextIndex));
  const segmentElement = wordElements[0]?.closest(".segment") || document.querySelector(`[data-segment-index="${segmentIndex}"]`);
  wordElements.forEach((word) => word.classList.add("is-active"));
  segmentElement?.classList.add("is-active");

  if (!elements.audio.paused && segmentIndex !== state.activeSegmentIndex) {
    state.activeSegmentIndex = segmentIndex;
    centerSegment(segmentElement);
  }
}

function downloadFile(content, extension, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${elements.resultTitle.textContent || "transcript"}.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function transcriptAsText() {
  if (!state.segments.length) return state.transcript?.text || "";
  return state.segments
    .map((segment) => `[${formatTime(segment.start)}] ${speakerName(segment.speaker)}\n${segment.words.map((word) => word.text).join("").trim()}`)
    .join("\n\n");
}

function transcriptAsSrt() {
  return state.segments
    .map((segment, index) => {
      const text = segment.words.map((word) => word.text).join("").trim();
      return `${index + 1}\n${formatTime(segment.start, true)} --> ${formatTime(segment.end, true)}\n${speakerName(segment.speaker)}: ${text}`;
    })
    .join("\n\n");
}

elements.apiKey.addEventListener("input", () => {
  if (elements.rememberKey.checked) localStorage.setItem("elevenlabs-api-key", elements.apiKey.value);
  clearTimeout(state.autoTranscribeTimer);
  if (state.audioFile && elements.apiKey.value.trim()) {
    state.autoTranscribeTimer = setTimeout(() => void transcribe(), 700);
  }
});
elements.rememberKey.addEventListener("change", () => {
  if (elements.rememberKey.checked) localStorage.setItem("elevenlabs-api-key", elements.apiKey.value);
  else localStorage.removeItem("elevenlabs-api-key");
});
elements.toggleKey.addEventListener("click", () => {
  const shouldShow = elements.apiKey.type === "password";
  elements.apiKey.type = shouldShow ? "text" : "password";
  elements.toggleKey.setAttribute("aria-label", shouldShow ? "Ẩn API key" : "Hiện API key");
});
elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => setAudioFile(elements.fileInput.files?.[0]));
elements.removeFile.addEventListener("click", clearAudioFile);
elements.refreshLibrary.addEventListener("click", loadRecordings);
elements.audioLibraryList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-recording-id]");
  if (item) openRecording(item.dataset.recordingId);
});
for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => setAudioFile(event.dataTransfer?.files?.[0]));

elements.playButton.addEventListener("click", () => {
  if (elements.audio.paused) elements.audio.play();
  else elements.audio.pause();
});
elements.audio.addEventListener("play", () => {
  elements.playButton.classList.add("is-playing");
  const activeSegment = document.querySelector(`[data-segment-index="${state.activeSegmentIndex}"]`);
  centerSegment(activeSegment);
});
elements.audio.addEventListener("pause", () => elements.playButton.classList.remove("is-playing"));
elements.audio.addEventListener("ended", () => elements.playButton.classList.remove("is-playing"));
elements.audio.addEventListener("loadedmetadata", () => {
  elements.duration.textContent = formatTime(elements.audio.duration);
  renderTimeline();
});
elements.audio.addEventListener("timeupdate", () => {
  elements.currentTime.textContent = formatTime(elements.audio.currentTime);
  updateActiveWord();
  drawWaveform();
  const playhead = document.querySelector("#timeline-playhead");
  if (playhead && elements.audio.duration) playhead.style.left = `${(elements.audio.currentTime / elements.audio.duration) * 100}%`;
});
elements.playbackRate.addEventListener("change", () => {
  elements.audio.playbackRate = Number(elements.playbackRate.value);
});
elements.waveform.addEventListener("click", (event) => {
  if (!elements.audio.duration) return;
  const bounds = elements.waveform.getBoundingClientRect();
  elements.audio.currentTime = ((event.clientX - bounds.left) / bounds.width) * elements.audio.duration;
});
elements.transcriptList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-start]");
  if (!target) return;
  elements.audio.currentTime = Number(target.dataset.start);
  elements.audio.play();
});
elements.timelineTracks.addEventListener("click", (event) => {
  const target = event.target.closest("[data-start]");
  if (!target) return;
  elements.audio.currentTime = Number(target.dataset.start);
  elements.audio.play();
});
elements.toggleReading.addEventListener("click", () => {
  elements.transcriptState.classList.toggle("hide-reading");
  elements.toggleReading.classList.toggle("is-active");
});
elements.toggleRomaji.addEventListener("click", () => {
  elements.transcriptState.classList.toggle("show-romaji");
  elements.toggleRomaji.classList.toggle("is-active");
});
elements.toggleTranslation.addEventListener("click", () => {
  elements.transcriptState.classList.toggle("hide-translation");
  elements.toggleTranslation.classList.toggle("is-active");
});
elements.search.addEventListener("input", () => {
  const query = elements.search.value.trim().toLocaleLowerCase("vi");
  document.querySelectorAll(".segment").forEach((segment) => {
    segment.hidden = Boolean(query) && !segment.textContent.toLocaleLowerCase("vi").includes(query);
  });
});
elements.downloadTxt.addEventListener("click", () => downloadFile(transcriptAsText(), "txt", "text/plain;charset=utf-8"));
elements.downloadSrt.addEventListener("click", () => downloadFile(transcriptAsSrt(), "srt", "application/x-subrip;charset=utf-8"));
window.addEventListener("resize", drawWaveform);

const savedApiKey = localStorage.getItem("elevenlabs-api-key");
if (savedApiKey) {
  elements.apiKey.value = savedApiKey;
  elements.rememberKey.checked = true;
}
loadRecordings();

async function loadJapaneseDemo() {
  const demoWords = [
    { text: "三番。", start: 0.82, end: 1.1, speaker_id: "speaker_0", type: "word" },
    { text: "ウィンドーショッピングをしました。", start: 2.18, end: 3.88, speaker_id: "speaker_0", type: "word" },
    { text: "どれですか？例えば。", start: 4.92, end: 8.74, speaker_id: "speaker_0", type: "word" },
    { text: "あの傘、素敵ですね。", start: 10.36, end: 12.72, speaker_id: "speaker_1", type: "word" },
    { text: "どれ？", start: 14.22, end: 15.52, speaker_id: "speaker_0", type: "word" },
    { text: "あそこ。あの黒い傘。", start: 17.02, end: 20.1, speaker_id: "speaker_1", type: "word" },
  ];
  const sentences = groupSegments(normalizeWords({ words: demoWords })).map((segment, id) => ({
    id,
    text: segment.words.map((word) => word.text).join("").trim(),
  }));
  const response = await fetch("/api/japanese/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentences, translate: false }),
  });
  const japanese = await response.json();
  const result = { text: demoWords.map((word) => word.text).join(""), words: demoWords, language_code: "ja", japanese };
  state.waveformSamples = Array.from({ length: 180 }, (_, index) => 0.18 + Math.abs(Math.sin(index * 0.37)) * 0.48);
  renderTranscript(result);
  elements.resultTitle.textContent = "Japanese conversation demo";
  setResultView("transcript");
  requestAnimationFrame(drawWaveform);
}

if (new URLSearchParams(window.location.search).get("demo") === "1") {
  loadJapaneseDemo().catch((error) => console.error("Khong the tai demo:", error));
}
