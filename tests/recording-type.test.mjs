import test from "node:test";
import assert from "node:assert/strict";
import { isTextToSpeechRecording } from "../public/recording-type.js";

test("keeps legacy Scribe audio out of the TTS library", () => {
  assert.equal(isTextToSpeechRecording({ model_id: "scribe_v1" }), false);
  assert.equal(isTextToSpeechRecording({ model_id: "scribe_v2" }), false);
});

test("recognizes TTS records returned by an older server", () => {
  assert.equal(isTextToSpeechRecording({ model_id: "eleven_flash_v2_5" }), true);
  assert.equal(isTextToSpeechRecording({ source_text: "こんにちは" }), true);
});

test("uses recording_type when the new API provides it", () => {
  assert.equal(isTextToSpeechRecording({ recording_type: "text_to_speech", model_id: "scribe_v1" }), true);
  assert.equal(isTextToSpeechRecording({ recording_type: "speech_to_text", model_id: "eleven_flash_v2_5" }), false);
});
