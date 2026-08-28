import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_AUDIO_BUCKET || "recording-audio";
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const command = process.argv[2] || "status";

async function status() {
  const [{ count, error: tableError }, { data: buckets, error: bucketError }] = await Promise.all([
    supabase.from("recordings").select("id", { count: "exact", head: true }),
    supabase.storage.listBuckets(),
  ]);
  if (tableError) throw tableError;
  if (bucketError) throw bucketError;
  console.log(JSON.stringify({ connected: true, recordings: count, bucketExists: buckets.some((item) => item.name === bucket) }, null, 2));
}

async function list() {
  const { data, error } = await supabase.from("recordings")
    .select("id, file_name, file_size, language_code, duration_seconds, audio_path, created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  console.table(data);
}

async function get() {
  const id = process.argv[3];
  if (!id) throw new Error("Usage: supabase-admin.mjs get RECORDING_UUID");
  const { data, error } = await supabase.from("recordings").select("*").eq("id", id).single();
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
}

async function stats() {
  const { data, error } = await supabase.from("recordings").select("file_size, duration_seconds, audio_path");
  if (error) throw error;
  const result = data.reduce((total, item) => ({
    count: total.count + 1,
    audioBytes: total.audioBytes + Number(item.file_size || 0),
    durationSeconds: total.durationSeconds + Number(item.duration_seconds || 0),
    missingAudio: total.missingAudio + (item.audio_path ? 0 : 1),
  }), { count: 0, audioBytes: 0, durationSeconds: 0, missingAudio: 0 });
  console.log(JSON.stringify({ ...result,
    audioMegabytes: Number((result.audioBytes / 1024 / 1024).toFixed(2)),
    audioHours: Number((result.durationSeconds / 3600).toFixed(2)),
  }, null, 2));
}

try {
  if (command === "status") await status();
  else if (command === "list") await list();
  else if (command === "get") await get();
  else if (command === "stats") await stats();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
