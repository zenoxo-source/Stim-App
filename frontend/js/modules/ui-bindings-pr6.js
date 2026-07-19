// ui-bindings-pr6.js - DOM glue for PR6 features.
// 1. Webcam-Vision enable/disable + consent dialog
// 2. Story-Modus selection + scene display

import { log } from "../state.js";
import {
  enable as enableWebcam,
  disable as disableWebcam,
  isActive as isWebcamActive,
  getConsent,
  setConsent,
  providerSupportsVision,
} from "./webcam-vision.js";
import {
  listStories,
  startStory,
  stopStory,
  makeChoice,
  onSceneChange,
  resetProgress,
  loadProgress,
} from "./story-mode.js";

// ---------------------------------------------------------------------------
// Webcam-Vision UI
// ---------------------------------------------------------------------------

function showConsentDialog() {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10003;";
    modal.innerHTML = `
      <div style="background:var(--bg-surface-solid);border-radius:8px;padding:24px;max-width:480px;box-shadow:var(--shadow-elevation);">
        <h3 style="margin-top:0;color:var(--color-warning);">⚠️ Webcam-Vision aktivieren?</h3>
        <p style="font-size:14px;line-height:1.5;">
          Diese Funktion macht <strong>alle 10 Sekunden ein Standbild von deiner Webcam</strong>
          und sendet es an das konfigurierte AI-Modell zur Analyse.
        </p>
        <ul style="font-size:13px;color:var(--text-muted);padding-left:20px;">
          <li>Bilder werden <strong>NICHT gespeichert</strong> (nur Analyse-Text)</li>
          <li>Bilder werden <strong>NICHT geloggt</strong></li>
          <li>Verwende nur lokale Modelle (Ollama) für höchste Privatsphäre</li>
          <li>Du kannst die Funktion jederzeit stoppen</li>
        </ul>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button type="button" id="wc-cancel" class="btn btn-secondary btn-sm">Abbrechen</button>
          <button type="button" id="wc-confirm" class="btn btn-sm">Verstanden, zustimmen</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#wc-cancel").onclick = () => {
      modal.remove();
      resolve(false);
    };
    modal.querySelector("#wc-confirm").onclick = () => {
      modal.remove();
      resolve(true);
    };
  });
}

async function bindWebcamControls() {
  const btnToggle = document.getElementById("btn-webcam-toggle");
  const btnConsent = document.getElementById("btn-webcam-consent");
  if (btnConsent) {
    btnConsent.onclick = async () => {
      const ok = await showConsentDialog();
      setConsent(ok ? "granted" : "denied");
      updateWebcamButton();
    };
  }
  if (btnToggle) {
    btnToggle.onclick = async () => {
      if (isWebcamActive()) {
        disableWebcam("user");
        updateWebcamButton();
        return;
      }
      if (getConsent() !== "granted") {
        const ok = await showConsentDialog();
        if (!ok) {
          setConsent("denied");
          return;
        }
        setConsent("granted");
      }
      // Validate provider supports vision
      const provider = (document.getElementById("ai-provider")?.value || "").toLowerCase();
      if (!providerSupportsVision(provider)) {
        log(`Provider „${provider}" unterstützt keine Vision-API.`, "error");
        return;
      }
      const r = await enableWebcam();
      if (!r.ok) log(`Webcam: ${r.error}`, "error");
      updateWebcamButton();
    };
  }
}

function updateWebcamButton() {
  const btn = document.getElementById("btn-webcam-toggle");
  if (!btn) return;
  if (isWebcamActive()) {
    btn.textContent = "⏹ Webcam Stop";
    btn.style.background = "var(--color-error)";
    btn.style.color = "white";
  } else {
    btn.textContent = "📷 Webcam-Vision";
    btn.style.background = "";
    btn.style.color = "";
  }
}

// ---------------------------------------------------------------------------
// Story-Modus UI
// ---------------------------------------------------------------------------

function renderStoryList() {
  const sel = document.getElementById("story-select");
  if (!sel) return;
  const stories = listStories();
  const progress = loadProgress();
  sel.innerHTML = stories
    .map(
      (s) => `<option value="${s.id}">${escapeHtml(s.title)}${progress[s.id] ? " ⏵" : ""}</option>`
    )
    .join("");
}

function bindStoryControls() {
  const btnStart = document.getElementById("btn-story-start");
  const btnStop = document.getElementById("btn-story-stop");
  const btnReset = document.getElementById("btn-story-reset");

  btnStart?.addEventListener("click", () => {
    const sel = document.getElementById("story-select");
    if (!sel?.value) return;
    const r = startStory(sel.value);
    if (!r.ok) {
      log(`Story: ${r.error}`, "error");
      return;
    }
    log(`Story gestartet.`, "success");
  });

  btnStop?.addEventListener("click", () => stopStory("user"));

  btnReset?.addEventListener("click", () => {
    if (confirm("Story-Fortschritt zurücksetzen?")) {
      resetProgress();
      renderStoryList();
      log("Story-Fortschritt zurückgesetzt.", "info");
    }
  });

  // Wire scene-change callback
  onSceneChange((state) => {
    const narrative = document.getElementById("story-narrative");
    const choices = document.getElementById("story-choices");
    const title = document.getElementById("story-current");
    if (!state) {
      if (narrative) narrative.textContent = "Keine Story aktiv.";
      if (choices) choices.innerHTML = "";
      if (title) title.textContent = "";
      return;
    }
    if (title) title.textContent = state.story.title;
    if (narrative) narrative.textContent = state.scene.narrative;
    if (choices) {
      if (state.isEnd) {
        choices.innerHTML = `<p style="color:var(--text-muted);">— Ende —</p>`;
      } else {
        choices.innerHTML = state.choices
          .map(
            (c, i) =>
              `<button type="button" class="btn btn-secondary btn-sm" data-choice="${i}">${escapeHtml(
                c.label
              )}</button>`
          )
          .join(" ");
        choices.querySelectorAll("[data-choice]").forEach((b) => {
          b.onclick = () => {
            const idx = parseInt(b.getAttribute("data-choice"), 10);
            const r = makeChoice(idx);
            if (!r.ok) log(`Story-Choice: ${r.error}`, "warning");
          };
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  bindWebcamControls();
  updateWebcamButton();
  renderStoryList();
  bindStoryControls();
});
