import test from "node:test";
import assert from "node:assert/strict";
import { effectiveRecordingType } from "../src/storage.mjs";

test("TTS metadata overrides a stale speech_to_text column", () => {
  assert.equal(
    effectiveRecordingType({
      recording_type: "speech_to_text",
      transcript_json: { kind: "text_to_speech" },
    }),
    "text_to_speech",
  );
});

test("STT metadata overrides an incorrect text_to_speech column", () => {
  assert.equal(
    effectiveRecordingType({
      recording_type: "text_to_speech",
      transcript_json: { kind: "speech_to_text" },
    }),
    "speech_to_text",
  );
});

test("legacy rows without metadata fall back to the database column", () => {
  assert.equal(
    effectiveRecordingType({ recording_type: "text_to_speech", transcript_json: {} }),
    "text_to_speech",
  );
  assert.equal(effectiveRecordingType({ recording_type: "speech_to_text" }), "speech_to_text");
});
