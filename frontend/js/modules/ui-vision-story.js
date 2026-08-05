// ui-vision-story.js - DOM glue for webcam motion biofeedback.
// (The AI Story-Modus UI was removed in v6.0; the LLM vision path in v6.2.)

import { log } from "../state.js";
import {
  enable as enableWebcam,
  disable as disableWebcam,
  isActive as isWebcamActive,
  getConsent,
  setConsent,
} from "./webcam-vision.js";

// ---------------------------------------------------------------------------
// Webcam-Motion UI
// ---------------------------------------------------------------------------

function showConsentDialog() {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10003;";
    modal.innerHTML = `
      <div style="background:var(--bg-surface-solid);border-radius:8px;padding:24px;max-width:480px;box-shadow:var(--shadow-elevation);">
        <h3 style="margin-top:0;color:var(--color-warning);">⚠️ Webcam-Motion aktivieren?</h3>
        <p style="font-size:14px;line-height:1.5;">
          Diese Funktion macht <strong>lokal Bewegungs-Erkennung</strong> auf einem winzigen
          64×48-Graustufen-Bild und leitet die Bewegung als Biofeedback an Autodrive weiter.
        </p>
        <ul style="font-size:13px;color:var(--text-muted);padding-left:20px;">
          <li><strong>Vollständig lokal</strong> — kein LLM, kein Netzwerk, kein Modell</li>
          <li>Bilder werden <strong>NIE gespeichert, geloggt oder versendet</strong></li>
          <li>Nur ein Bewegungs-Wert (0–100 %) verlässt die Funktion</li>
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
    btn.textContent = "📷 Webcam-Motion";
    btn.style.background = "";
    btn.style.color = "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindWebcamControls();
  updateWebcamButton();
});
