export function isTextToSpeechRecording(recording) {
  if (recording?.recording_type) return recording.recording_type === "text_to_speech";
  if (String(recording?.source_text || "").trim()) return true;
  return /^eleven_/i.test(String(recording?.model_id || ""));
}
