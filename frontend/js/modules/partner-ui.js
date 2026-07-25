// partner-ui.js — Lightweight partner control panel (uses remote WS + local feedback)

import {
  injectFeedback,
  isAutodriveActive,
  getAutodriveState,
  pauseAutodrive,
  resumeAutodrive,
  stopAutodrive,
  startQuickClassic,
} from "./autodrive.js";
import { fireShock } from "./shock.js";
import { log } from "../state.js";

export function openPartnerPanel() {
  const el = document.getElementById("partner-panel");
  if (el) el.style.display = "flex";
}

export function closePartnerPanel() {
  const el = document.getElementById("partner-panel");
  if (el) el.style.display = "none";
}

function paintPartnerStatus() {
  const stEl = document.getElementById("partner-status");
  if (!stEl) return;
  if (!isAutodriveActive()) {
    stEl.textContent = "Autodrive aus — Start oder Remote";
    return;
  }
  const st = getAutodriveState();
  stEl.textContent = `${st.phaseLabel || st.phase} · Edge ${st.edgeCountDone}/${st.edgeCountTarget} · ${Math.round((st.relStrength || 0) * 100)}%`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-partner-open")?.addEventListener("click", openPartnerPanel);
  document.getElementById("partner-close")?.addEventListener("click", closePartnerPanel);

  document.querySelectorAll(".partner-fb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fb = btn.getAttribute("data-fb");
      if (!fb) return;
      if (!isAutodriveActive()) {
        log("Partner: Autodrive läuft nicht.", "warning");
        return;
      }
      injectFeedback(fb);
      paintPartnerStatus();
    });
  });

  document.getElementById("partner-start")?.addEventListener("click", () => {
    const r = startQuickClassic();
    if (!r.ok) log(`Partner-Start: ${r.error}`, "error");
    paintPartnerStatus();
  });
  document.getElementById("partner-pause")?.addEventListener("click", () => {
    const st = getAutodriveState();
    if (st.phase === "PAUSED") resumeAutodrive();
    else pauseAutodrive();
    paintPartnerStatus();
  });
  document.getElementById("partner-stop")?.addEventListener("click", () => {
    stopAutodrive("partner");
    paintPartnerStatus();
  });
  document.getElementById("partner-shock")?.addEventListener("click", () => {
    const r = fireShock();
    if (!r.ok) log(`Partner-Shock: ${r.error}`, "error");
  });

  setInterval(paintPartnerStatus, 500);
});
