import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAudioBucket, supabaseUrl } from "./config.mjs";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = supabaseAudioBucket;
const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export function storageStatus() {
  return { configured: Boolean(supabase), bucket: bucketName };
}

export async function verifyStorageConnection() {
  if (!supabase) return { connected: false, table: false, bucket: false };
  const [{ error: tableError }, { data: buckets, error: bucketError }] = await Promise.all([
    supabase.from("recordings").select("id", { head: true, count: "exact" }),
    supabase.storage.listBuckets(),
  ]);
  return {
    connected: !tableError && !bucketError,
    table: !tableError,
    bucket: !bucketError && buckets.some((item) => item.name === bucketName),
    error: tableError?.message || bucketError?.message || null,
  };
}

export function hashAudio(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function findCachedRecording(cacheKey) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("recordings")
    .select("id, transcript_json")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) {
    console.warn("Khong the doc cache Supabase:", error.message);
    return null;
  }
  return data;
}

const baseRecordingColumns =
  "id, file_name, file_size, mime_type, language_code, model_id, duration_seconds, audio_path, created_at";
const extendedRecordingColumns = `${baseRecordingColumns}, recording_type, source_text`;

function recordingTypeFromTranscript(transcript) {
  if (transcript?.kind === "text_to_speech") return "text_to_speech";
  if (transcript?.kind === "speech_to_text") return "speech_to_text";
  return null;
}

export function effectiveRecordingType(recording) {
  return (
    recordingTypeFromTranscript(recording?.transcript_json) ||
    (recording?.recording_type === "text_to_speech" ? "text_to_speech" : "speech_to_text")
  );
}

function isMissingRecordingTypeColumn(error) {
  return /recording_type|source_text/i.test(error?.message || "");
}

export async function listRecordings(limit = 100, recordingType = "speech_to_text") {
  if (!supabase) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  const queryLimit = Math.min(200, Math.max(safeLimit * 2, safeLimit));
  const [typedResult, taggedResult] = await Promise.all([
    supabase
      .from("recordings")
      .select(`${extendedRecordingColumns}, transcript_json`)
      .eq("recording_type", recordingType)
      .order("created_at", { ascending: false })
      .limit(queryLimit),
    supabase
      .from("recordings")
      .select(`${extendedRecordingColumns}, transcript_json`)
      .contains("transcript_json", { kind: recordingType })
      .order("created_at", { ascending: false })
      .limit(queryLimit),
  ]);
  let error = typedResult.error || taggedResult.error;
  let data = [...(typedResult.data || []), ...(taggedResult.data || [])];

  if (error && isMissingRecordingTypeColumn(error)) {
    const fallback = await supabase
      .from("recordings")
      .select(`${baseRecordingColumns}, transcript_json`)
      .order("created_at", { ascending: false })
      .limit(200);
    data = (fallback.data || [])
      .filter((recording) => effectiveRecordingType(recording) === recordingType)
      .slice(0, safeLimit)
      .map((recording) => ({
        ...recording,
        recording_type: effectiveRecordingType(recording),
        source_text: recording.transcript_json?.text || null,
      }));
    error = fallback.error;
  }

  if (error) throw new Error(`Khong the tai thu vien Supabase: ${error.message}`);
  const uniqueRecordings = new Map();
  for (const recording of data || []) uniqueRecordings.set(recording.id, recording);
  return [...uniqueRecordings.values()]
    .filter((recording) => effectiveRecordingType(recording) === recordingType)
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, safeLimit)
    .map(({ transcript_json: _transcript, ...recording }) => ({
      ...recording,
      recording_type: effectiveRecordingType({ ...recording, transcript_json: _transcript }),
      source_text: recording.source_text || _transcript?.text || null,
      has_audio: Boolean(recording.audio_path),
      audio_path: undefined,
    }));
}

export async function getRecording(recordingId) {
  if (!supabase) return null;
  let { data, error } = await supabase
    .from("recordings")
    .select(`${extendedRecordingColumns}, transcript_json`)
    .eq("id", recordingId)
    .maybeSingle();

  if (error && isMissingRecordingTypeColumn(error)) {
    const fallback = await supabase
      .from("recordings")
      .select(`${baseRecordingColumns}, transcript_json`)
      .eq("id", recordingId)
      .maybeSingle();
    data = fallback.data
      ? {
          ...fallback.data,
          recording_type: effectiveRecordingType(fallback.data),
          source_text: fallback.data.transcript_json?.text || null,
        }
      : null;
    error = fallback.error;
  }

  if (error) throw new Error(`Khong the tai ban ghi: ${error.message}`);
  if (!data) return null;

  let audioUrl = null;
  if (data.audio_path) {
    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(data.audio_path, 60 * 60);
    if (signedError) console.warn("Khong the tao signed URL:", signedError.message);
    else audioUrl = signedData.signedUrl;
  }

  return {
    id: data.id,
    fileName: data.file_name,
    fileSize: data.file_size,
    mimeType: data.mime_type,
    languageCode: data.language_code,
    modelId: data.model_id,
    recordingType: effectiveRecordingType(data),
    sourceText: data.source_text || data.transcript_json?.text || null,
    durationSeconds: data.duration_seconds,
    createdAt: data.created_at,
    transcript: data.transcript_json,
    audioUrl,
  };
}

export async function updateRecordingTranscript(recordingId, transcript) {
  if (!supabase) return false;
  const { error } = await supabase.from("recordings").update({ transcript_json: transcript }).eq("id", recordingId);
  if (error) {
    console.warn("Khong the cap nhat ban dich transcript:", error.message);
    return false;
  }
  return true;
}

export async function saveRecording({
  audioBuffer,
  contentType,
  cacheKey,
  fileHash,
  fileName,
  languageCode,
  modelId,
  recordingType = "speech_to_text",
  sourceText = null,
  durationSeconds,
  transcript,
}) {
  if (!supabase) return null;
  const rawExtension = fileName.includes(".") ? fileName.split(".").pop() : "bin";
  const extension = rawExtension.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
  const storagePath = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(bucketName).upload(storagePath, audioBuffer, {
    contentType,
    upsert: false,
  });

  const uploadedPath = uploadError ? null : storagePath;
  if (uploadError) console.warn("Khong the luu audio len Supabase, van luu transcript:", uploadError.message);

  const recordingPayload = {
    cache_key: cacheKey,
    file_hash: fileHash,
    file_name: fileName,
    file_size: audioBuffer.length,
    mime_type: contentType,
    language_code: languageCode,
    model_id: modelId,
    recording_type: recordingType,
    source_text: sourceText,
    duration_seconds:
      durationSeconds ??
      (Array.isArray(transcript.words)
        ? Number(transcript.words.findLast((word) => Number.isFinite(Number(word.end)))?.end || 0)
        : null),
    transcript_json: transcript,
    ...(uploadedPath ? { audio_path: uploadedPath } : {}),
  };

  const upsertRecording = (payload) =>
    supabase.from("recordings").upsert(payload, {
      onConflict: "cache_key",
      ignoreDuplicates: false,
      defaultToNull: false,
    })
    .select("id")
    .single();

  let { data, error } = await upsertRecording(recordingPayload);
  if (error && isMissingRecordingTypeColumn(error)) {
    const { recording_type: _recordingType, source_text: _sourceText, ...legacyPayload } = recordingPayload;
    ({ data, error } = await upsertRecording(legacyPayload));
  }

  if (error) {
    console.warn("Khong the luu transcript vao Supabase:", error.message);
    if (uploadedPath) await supabase.storage.from(bucketName).remove([uploadedPath]);
    return null;
  }
  return data;
}
