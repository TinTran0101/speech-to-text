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

export async function listRecordings(limit = 100) {
  if (!supabase) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  const { data, error } = await supabase
    .from("recordings")
    .select("id, file_name, file_size, mime_type, language_code, model_id, duration_seconds, audio_path, created_at")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(`Khong the tai thu vien Supabase: ${error.message}`);
  return (data || []).map((recording) => ({
    ...recording,
    has_audio: Boolean(recording.audio_path),
    audio_path: undefined,
  }));
}

export async function getRecording(recordingId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("recordings")
    .select("id, file_name, file_size, mime_type, language_code, model_id, duration_seconds, audio_path, transcript_json, created_at")
    .eq("id", recordingId)
    .maybeSingle();

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
    durationSeconds: data.duration_seconds,
    createdAt: data.created_at,
    transcript: data.transcript_json,
    audioUrl,
  };
}

export async function saveRecording({
  audioBuffer,
  contentType,
  cacheKey,
  fileHash,
  fileName,
  languageCode,
  modelId,
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
    duration_seconds: Array.isArray(transcript.words)
      ? Number(transcript.words.findLast((word) => Number.isFinite(Number(word.end)))?.end || 0)
      : null,
    transcript_json: transcript,
    ...(uploadedPath ? { audio_path: uploadedPath } : {}),
  };

  const { data, error } = await supabase
    .from("recordings")
    .upsert(recordingPayload, {
      onConflict: "cache_key",
      ignoreDuplicates: false,
      defaultToNull: false,
    })
    .select("id")
    .single();

  if (error) {
    console.warn("Khong the luu transcript vao Supabase:", error.message);
    if (uploadedPath) await supabase.storage.from(bucketName).remove([uploadedPath]);
    return null;
  }
  return data;
}
