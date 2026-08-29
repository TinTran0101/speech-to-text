import test from "node:test";
import assert from "node:assert/strict";
import { mergeTtsVoices } from "../public/tts.js";

test("Japanese voice presets are first and Rachel is removed", () => {
  const voices = mergeTtsVoices([
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
    { id: "account-voice", name: "Account voice" },
  ]);

  assert.deepEqual(
    voices.slice(0, 4).map((voice) => voice.id),
    [
      "3JDquces8E8bkmvbh6Bc",
      "Mv8AjrYZCBkdsmDHNwcB",
      "WQz3clzUdMqvBf0jswZQ",
      "T7yYq3WpB94yAuOXraRi",
    ],
  );
  assert.equal(voices.some((voice) => voice.id === "21m00Tcm4TlvDq8ikWAM"), false);
  assert.equal(voices.at(-1).id, "account-voice");
});

test("account voices cannot duplicate a preset", () => {
  const voices = mergeTtsVoices([{ id: "3JDquces8E8bkmvbh6Bc", name: "Duplicate Otani" }]);
  assert.equal(voices.filter((voice) => voice.id === "3JDquces8E8bkmvbh6Bc").length, 1);
  assert.equal(voices[0].name, "Male - Standard (Otani)");
});
