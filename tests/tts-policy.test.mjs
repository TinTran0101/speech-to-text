import test from "node:test";
import assert from "node:assert/strict";
import { getTtsTextPolicy } from "../public/tts.js";

test("Flash v2.5 keeps the normal 10,000 character limit", () => {
  assert.deepEqual(getTtsTextPolicy("eleven_flash_v2_5", 500), {
    maximum: 10_000,
    requiresConfirmation: false,
    tooLong: false,
  });
});

test("Eleven v3 warns after 100 characters and stops after 300", () => {
  assert.equal(getTtsTextPolicy("eleven_v3", 100).requiresConfirmation, false);
  assert.equal(getTtsTextPolicy("eleven_v3", 101).requiresConfirmation, true);
  assert.equal(getTtsTextPolicy("eleven_v3", 300).requiresConfirmation, true);
  assert.equal(getTtsTextPolicy("eleven_v3", 301).tooLong, true);
  assert.equal(getTtsTextPolicy("eleven_v3", 301).requiresConfirmation, false);
});
