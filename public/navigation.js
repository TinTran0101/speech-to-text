const validViews = new Set(["stt", "tts"]);

export function normalizeAppView(view) {
  return validViews.has(view) ? view : "stt";
}

export function setAppView(view, { updateHistory = false } = {}) {
  const nextView = normalizeAppView(view);
  const sttWorkspace = document.querySelector("#stt-workspace");
  const ttsWorkspace = document.querySelector("#tts-workspace");
  if (!sttWorkspace || !ttsWorkspace) return;

  const isTts = nextView === "tts";
  document.body.dataset.appView = nextView;
  sttWorkspace.hidden = isTts;
  ttsWorkspace.hidden = !isTts;
  sttWorkspace.classList.toggle("is-app-view-active", !isTts);
  ttsWorkspace.classList.toggle("is-app-view-active", isTts);

  document.querySelectorAll("[data-app-view]").forEach((button) => {
    const active = button.dataset.appView === nextView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const nextHash = `#${nextView}`;
  if (updateHistory && window.location.hash !== nextHash) {
    history.pushState({ appView: nextView }, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  } else if (window.location.hash !== nextHash) {
    history.replaceState({ appView: nextView }, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }

  window.dispatchEvent(new CustomEvent("app:viewchange", { detail: { view: nextView } }));
}

function viewFromLocation() {
  return normalizeAppView(window.location.hash.slice(1));
}

document.querySelectorAll("[data-app-view]").forEach((button) => {
  button.addEventListener("click", () => setAppView(button.dataset.appView, { updateHistory: true }));
});

document.querySelector(".brand")?.addEventListener("click", (event) => {
  event.preventDefault();
  setAppView("stt", { updateHistory: true });
});

window.addEventListener("hashchange", () => setAppView(viewFromLocation()));
window.addEventListener("popstate", () => setAppView(viewFromLocation()));

setAppView(viewFromLocation());
