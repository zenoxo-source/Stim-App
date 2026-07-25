// autodrive-ui.js — Home + Autodrive dashboard bindings

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

const TIMELINE = [
  { id: "CALIBRATING", label: "Kalib" },
  { id: "WARMUP", label: "Warm" },
  { id: "BUILD", label: "Build" },
  { id: "TEASE", label: "Tease" },
  { id: "EDGE_HOLD", label: "Edge" },
  { id: "SURGE", label: "Surge" },
  { id: "CLIMAX_PUSH", label: "Push" },
  { id: "AFTERCARE", label: "Care" },
];

const PHASE_ORDER = TIMELINE.map((t) => t.id);

function refreshHomeSummary() {
  const conn = document.getElementById("home-conn-text");
  if (conn) conn.textContent = AppState.isConnected ? "Verbunden" : "Getrennt";
  const sa = document.getElementById("home-soft-a");
  const sb = document.getElementById("home-soft-b");
  if (sa) sa.textContent = String(AppState.softLimitA ?? "—");
  if (sb) sb.textContent = String(AppState.softLimitB ?? "—");

  const mini = document.getElementById("home-autodrive-mini");
  const st = getAutodriveState();
  if (mini) mini.style.display = isAutodriveActive() ? "block" : "none";
  const phase = document.getElementById("home-ad-phase");
  if (phase) phase.textContent = st.phaseLabel || st.phase || "—";
  const prog = document.getElementById("home-ad-progress");
  if (prog) prog.style.width = `${Math.round((st.progress || 0) * 100)}%`;
}

function paintTimeline(st) {
  const root = document.getElementById("autodrive-timeline");
  if (!root) return;
  const cur = st.phase || "IDLE";
  const idx = PHASE_ORDER.indexOf(cur);
  root.innerHTML = TIMELINE.map((step, i) => {
    let cls = "tl-step";
    if (cur === "PAUSED" || cur === "IDLE" || cur === "COOLDOWN") {
      /* no active highlight beyond history */
    } else if (i < idx) cls += " done";
    else if (i === idx) cls += " active";
    if (cur === "AFTERCARE" && step.id === "AFTERCARE") cls = "tl-step active";
    return `<div class="${cls}">${step.label}</div>`;
  }).join("");
}

function paintDashboard(st) {
  const badge = document.getElementById("autodrive-running-badge");
  if (badge) {
    badge.classList.remove("idle", "running", "paused");
    if (st.phase === "PAUSED") {
      badge.textContent = "Pausiert";
      badge.classList.add("paused");
    } else if (st.phase && st.phase !== "IDLE") {
      badge.textContent = "Läuft";
      badge.classList.add("running");
    } else {
      badge.textContent = "Bereit";
      badge.classList.add("idle");
    }
  }

  const owner = document.getElementById("autodrive-owner");
  if (owner) owner.textContent = getOutputOwner();

  const relBar = document.getElementById("autodrive-rel-bar");
  if (relBar) relBar.style.width = `${Math.round((st.relStrength || 0) * 100)}%`;

  const pct = document.getElementById("autodrive-progress-pct");
  if (pct) pct.textContent = `${Math.round((st.progress || 0) * 100)}%`;

  paintTimeline(st);
  refreshHomeSummary();
}

function buildTemplateGrid(selectedId) {
  const grid = document.getElementById("autodrive-template-grid");
  if (!grid) return;
  grid.innerHTML = "";
  Object.values(AUTODRIVE_TEMPLATES).forEach((tpl) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "autodrive-tpl-card" + (tpl.id === selectedId ? " active" : "");
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", tpl.id === selectedId ? "true" : "false");
    btn.dataset.template = tpl.id;
    btn.innerHTML = `<span class="tpl-name">${tpl.label}</span><span class="tpl-desc">${tpl.description || ""}</span>`;
    btn.addEventListener("click", () => selectTemplate(tpl.id));
    grid.appendChild(btn);
  });
}

function selectTemplate(id) {
  const hidden = document.getElementById("autodrive-template");
  if (hidden) hidden.value = id;
  const tpl = AUTODRIVE_TEMPLATES[id];
  if (tpl) {
    const dur = document.getElementById("autodrive-duration");
    if (dur) dur.value = String(tpl.targetDurationMin);
    const sens = document.getElementById("autodrive-sensitivity");
    if (sens && tpl.sensitivity) sens.value = tpl.sensitivity;
  }
  buildTemplateGrid(id);
}

function collectConfigFromUi() {
  const templateId = document.getElementById("autodrive-template")?.value || "classic";
  const tpl = AUTODRIVE_TEMPLATES[templateId] || AUTODRIVE_TEMPLATES.classic;
  const focus = document.getElementById("autodrive-focus")?.value || "both";
  const sensitivity = document.getElementById("autodrive-sensitivity")?.value || "medium";
  const durationRaw = Number(document.getElementById("autodrive-duration")?.value);
  const targetDurationMin = Number.isFinite(durationRaw)
    ? Math.max(2, Math.min(60, durationRaw))
    : tpl.targetDurationMin;
  const autoClimb = !!document.getElementById("autodrive-auto-climb")?.checked;

  return saveAutodriveConfig({
    templateId,
    goal: tpl.goal,
    edgeCount: tpl.edgeCount,
    targetDurationMin,
    maxSessionIntensityFactor: tpl.maxSessionIntensityFactor,
    allowClimaxPatterns: tpl.allowClimaxPatterns,
    aggression: tpl.aggression,
    channelFocus: focus,
    sensitivity,
    autoClimb,
  });
}

function setStatusMsg(msg, isError) {
  const el = document.getElementById("autodrive-status-msg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--color-error, #f66)" : "var(--color-warning, #d83b01)";
}

document.addEventListener("DOMContentLoaded", () => {
  const cfg = loadAutodriveConfig();
  try {
    const sel = document.getElementById("autodrive-template");
    if (sel) sel.value = cfg.templateId || "classic";
    buildTemplateGrid(cfg.templateId || "classic");
    const focus = document.getElementById("autodrive-focus");
    if (focus && cfg.channelFocus) focus.value = cfg.channelFocus;
    const sens = document.getElementById("autodrive-sensitivity");
    if (sens && cfg.sensitivity) sens.value = cfg.sensitivity;
    const dur = document.getElementById("autodrive-duration");
    if (dur && cfg.targetDurationMin) dur.value = String(cfg.targetDurationMin);
    const climb = document.getElementById("autodrive-auto-climb");
    if (climb) climb.checked = cfg.autoClimb !== false;
  } catch {
    buildTemplateGrid("classic");
  }

  document.getElementById("btn-autodrive-start")?.addEventListener("click", () => {
    const conf = collectConfigFromUi();
    const r = startAutodrive(conf);
    if (!r.ok) {
      setStatusMsg(r.error || "Start fehlgeschlagen", true);
      log(`Autodrive: ${r.error}`, "error");
    } else {
      setStatusMsg("Läuft — Feedback nutzen für bessere Anpassung", false);
    }
    paintDashboard(getAutodriveState());
  });

  document.getElementById("btn-autodrive-pause")?.addEventListener("click", () => {
    pauseAutodrive();
    setStatusMsg("Pausiert", false);
  });
  document.getElementById("btn-autodrive-resume")?.addEventListener("click", () => {
    resumeAutodrive();
    setStatusMsg("Fortgesetzt", false);
  });
  document.getElementById("btn-autodrive-stop")?.addEventListener("click", () => {
    stopAutodrive("ui");
    setStatusMsg("Gestoppt", false);
    paintDashboard(getAutodriveState());
  });

  document.querySelectorAll(".autodrive-fb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fb = btn.getAttribute("data-fb");
      if (!fb) return;
      if (!isAutodriveActive()) {
        setStatusMsg("Zuerst Autodrive starten", true);
        return;
      }
      injectFeedback(fb);
      btn.classList.add("active");
      setTimeout(() => btn.classList.remove("active"), 200);
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

  // One-click start from Home
  document.getElementById("home-btn-autodrive")?.addEventListener("dblclick", () => {
    document.querySelector('.nav-item[data-tab="autodrive"]')?.click();
    setTimeout(() => document.getElementById("btn-autodrive-start")?.click(), 100);
  });

  onAutodriveUi((st) => paintDashboard(st));
  setInterval(refreshHomeSummary, 1000);
  paintDashboard(getAutodriveState());
});
