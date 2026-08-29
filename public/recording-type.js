export function isTextToSpeechRecording(recording) {
  const transcriptType = recording?.transcript?.kind || recording?.transcript_json?.kind;
  if (transcriptType) return transcriptType === "text_to_speech";
  const recordingType = recording?.recording_type || recording?.recordingType;
  if (recordingType) return recordingType === "text_to_speech";
  if (String(recording?.source_text || recording?.sourceText || "").trim()) return true;
  return /^eleven_/i.test(String(recording?.model_id || recording?.modelId || ""));
}
