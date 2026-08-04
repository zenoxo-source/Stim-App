// ui-vision-story.js - DOM glue for webcam vision.
// (The AI Story-Modus UI was removed in v6.0.)

import { log } from "../state.js";
import {
  enable as enableWebcam,
  disable as disableWebcam,
  isActive as isWebcamActive,
  getConsent,
  setConsent,
  providerSupportsVision,
} from "./webcam-vision.js";

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

document.addEventListener("DOMContentLoaded", () => {
  bindWebcamControls();
  updateWebcamButton();
});
