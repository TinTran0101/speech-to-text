import test from "node:test";
import assert from "node:assert/strict";

test("navigation module only accepts known application views", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalHistory = globalThis.history;
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.document = {
    body: { dataset: {} },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.window = {
    location: { hash: "", pathname: "/", search: "" },
    addEventListener: () => {},
    dispatchEvent: () => {},
  };
  globalThis.history = { pushState: () => {}, replaceState: () => {} };
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };

  try {
    const { normalizeAppView, setAppView } = await import("../public/navigation.js");
    assert.equal(normalizeAppView("tts"), "tts");
    assert.equal(normalizeAppView("stt"), "stt");
    assert.equal(normalizeAppView("unknown"), "stt");

    const classList = () => ({ toggle: () => {} });
    const sttWorkspace = { hidden: false, classList: classList() };
    const ttsWorkspace = { hidden: true, classList: classList() };
    const navButtons = [
      { dataset: { appView: "stt" }, classList: classList(), setAttribute: () => {} },
      { dataset: { appView: "tts" }, classList: classList(), setAttribute: () => {} },
    ];
    globalThis.document.querySelector = (selector) =>
      selector === "#stt-workspace" ? sttWorkspace : selector === "#tts-workspace" ? ttsWorkspace : null;
    globalThis.document.querySelectorAll = () => navButtons;

    setAppView("tts");
    assert.equal(globalThis.document.body.dataset.appView, "tts");
    assert.equal(sttWorkspace.hidden, true);
    assert.equal(ttsWorkspace.hidden, false);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.history = originalHistory;
    globalThis.CustomEvent = originalCustomEvent;
  }
});
