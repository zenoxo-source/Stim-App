// autodrive-ui.js — Home + Autodrive tab bindings

import { AppState, log } from "../state.js";
import {
  startAutodrive,
  pauseAutodrive,
  resumeAutodrive,
  stopAutodrive,
  injectFeedback,
  onAutodriveUi,
  isAutodriveActive,
  loadAutodriveConfig,
  saveAutodriveConfig,
  getAutodriveState,
  AUTODRIVE_TEMPLATES,
} from "./autodrive.js";
import { getOutputOwner } from "./output-owner.js";

function refreshHomeSummary() {
  const conn = document.getElementById("home-conn-text");
  if (conn) conn.textContent = AppState.isConnected ? "Verbunden" : "Getrennt";
  const sa = document.getElementById("home-soft-a");
  const sb = document.getElementById("home-soft-b");
  if (sa) sa.textContent = String(AppState.softLimitA ?? "—");
  if (sb) sb.textContent = String(AppState.softLimitB ?? "—");

  const mini = document.getElementById("home-autodrive-mini");
  const st = getAutodriveState();
  if (mini) {
    mini.style.display = isAutodriveActive() ? "block" : "none";
  }
  const phase = document.getElementById("home-ad-phase");
  if (phase) phase.textContent = st.phase || "IDLE";
  const prog = document.getElementById("home-ad-progress");
  if (prog) prog.style.width = `${Math.round((st.progress || 0) * 100)}%`;
}

function updateLiveChrome(st) {
  const owner = document.getElementById("autodrive-owner");
  if (owner) owner.textContent = getOutputOwner();
  refreshHomeSummary();
}

function collectConfigFromUi() {
  const templateId = document.getElementById("autodrive-template")?.value || "classic";
  const tpl = AUTODRIVE_TEMPLATES[templateId] || AUTODRIVE_TEMPLATES.classic;
  const focus = document.getElementById("autodrive-focus")?.value || "both";
  const sensitivity = document.getElementById("autodrive-sensitivity")?.value || "medium";
  return saveAutodriveConfig({
    templateId,
    goal: tpl.goal,
    edgeCount: tpl.edgeCount,
    targetDurationMin: tpl.targetDurationMin,
    maxSessionIntensityFactor: tpl.maxSessionIntensityFactor,
    allowClimaxPatterns: tpl.allowClimaxPatterns,
    channelFocus: focus,
    sensitivity,
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Prefill from saved config
  try {
    const cfg = loadAutodriveConfig();
    const sel = document.getElementById("autodrive-template");
    if (sel && cfg.templateId) sel.value = cfg.templateId;
    const focus = document.getElementById("autodrive-focus");
    if (focus && cfg.channelFocus) focus.value = cfg.channelFocus;
    const sens = document.getElementById("autodrive-sensitivity");
    if (sens && cfg.sensitivity) sens.value = cfg.sensitivity;
  } catch {
    /* ignore */
  }

  document.getElementById("btn-autodrive-start")?.addEventListener("click", () => {
    const cfg = collectConfigFromUi();
    const r = startAutodrive(cfg);
    if (!r.ok) log(`Autodrive: ${r.error}`, "error");
    updateLiveChrome(getAutodriveState());
  });

  document.getElementById("btn-autodrive-pause")?.addEventListener("click", () => {
    pauseAutodrive();
  });
  document.getElementById("btn-autodrive-resume")?.addEventListener("click", () => {
    resumeAutodrive();
  });
  document.getElementById("btn-autodrive-stop")?.addEventListener("click", () => {
    stopAutodrive("ui");
  });

  document.querySelectorAll(".autodrive-fb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fb = btn.getAttribute("data-fb");
      if (fb) injectFeedback(fb);
    });
  });

  document.getElementById("home-btn-connect")?.addEventListener("click", () => {
    document.getElementById("btn-connect")?.click();
  });
  document.getElementById("home-btn-autodrive")?.addEventListener("click", () => {
    document.querySelector('.nav-item[data-tab="autodrive"]')?.click();
  });
  document.getElementById("home-btn-manual")?.addEventListener("click", () => {
    document.querySelector('.nav-item[data-tab="deck"]')?.click();
  });

  onAutodriveUi((st) => {
    updateLiveChrome(st);
  });

  setInterval(refreshHomeSummary, 1000);
  refreshHomeSummary();
});
