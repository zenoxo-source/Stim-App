// autodrive-ui.js — Home 1-tap, fullscreen session, prompts, debrief, coach

import { AppState, log } from "../state.js";
// log used by stories
import {
  startAutodrive,
  startQuickClassic,
  startLastSuccess,
  hasLastSuccess,
  pauseAutodrive,
  resumeAutodrive,
  stopAutodrive,
  injectFeedback,
  onAutodriveUi,
  isAutodriveActive,
  loadAutodriveConfig,
  saveAutodriveConfig,
  getAutodriveState,
  getLastSessionSnapshot,
  applyDebrief,
  getSoftLimitCoachMessage,
  clearSoftLimitCoach,
  getAutodriveStatsSummary,
  hapticPulse,
  AUTODRIVE_TEMPLATES,
  listPlacementProfiles,
  getPlacementProfile,
  ESTIM_SAFETY_RULES,
} from "./autodrive.js";
import { getOutputOwner } from "./output-owner.js";
import { renderReadinessList, renderHomeMetrics } from "./session-readiness.js";
import { listStories, runStory } from "./session-stories.js";

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

let debriefClimax = null;
let debriefOverall = null;
let wasRunning = false;

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

  const lastBtn = document.getElementById("home-btn-last-success");
  if (lastBtn) lastBtn.style.display = hasLastSuccess() ? "inline-block" : "none";

  const statsEl = document.getElementById("home-ad-stats");
  if (statsEl) {
    const s = getAutodriveStatsSummary();
    if (s.sessions > 0) {
      const pct = Math.round((s.climaxRate || 0) * 100);
      statsEl.textContent = `Autodrive-Stats: ${s.sessions} Sessions · ${pct}% mit „Fertig ✓“ markiert`;
    } else {
      statsEl.textContent = "";
    }
  }
}

function paintTimeline(st) {
  const root = document.getElementById("autodrive-timeline");
  if (!root) return;
  const cur = st.phase || "IDLE";
  const idx = PHASE_ORDER.indexOf(cur);
  root.innerHTML = TIMELINE.map((step, i) => {
    let cls = "tl-step";
    if (cur !== "PAUSED" && cur !== "IDLE" && cur !== "COOLDOWN") {
      if (i < idx) cls += " done";
      else if (i === idx) cls += " active";
    }
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

  // Connection banner on Autodrive tab
  const banner = document.getElementById("autodrive-conn-banner");
  if (banner) {
    banner.style.display = AppState.isConnected ? "none" : "flex";
  }

  // Fullscreen phase theme + clock
  const fs = document.getElementById("autodrive-fullscreen");
  if (fs && fs.style.display !== "none") {
    const ph = st.phase || "IDLE";
    fs.dataset.phase = ph;
    fs.className = "ad-fs phase-" + ph;
    const clock = document.getElementById("ad-fs-clock");
    if (clock && st.remainingMs != null) {
      const elapsed = Math.max(
        0,
        (st.config?.targetDurationMin || 12) * 60000 - (st.remainingMs || 0)
      );
      clock.textContent = formatUiMs(elapsed) + " · noch " + formatUiMs(st.remainingMs);
    }
    const eta = document.getElementById("ad-fs-eta");
    if (eta) eta.textContent = formatUiMs(st.remainingMs);
    const relL = document.getElementById("ad-fs-rel-label");
    if (relL) relL.textContent = `${Math.round((st.relStrength || 0) * 100)}%`;
  }

  paintTimeline(st);
  refreshHomeSummary();
  paintCoach();
}

function formatUiMs(ms) {
  if (!ms || ms < 0) return "0:00";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function paintCoach() {
  const el = document.getElementById("autodrive-coach");
  if (!el) return;
  const coach = getSoftLimitCoachMessage();
  if (!coach || isAutodriveActive()) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.innerHTML = `${coach.message} <button type="button" class="btn btn-secondary btn-sm" id="coach-dismiss">OK</button> <button type="button" class="btn btn-secondary btn-sm" id="coach-settings">Einstellungen</button>`;
  document.getElementById("coach-dismiss")?.addEventListener("click", () => {
    clearSoftLimitCoach();
    el.style.display = "none";
  });
  document.getElementById("coach-settings")?.addEventListener("click", () => {
    clearSoftLimitCoach();
    document.querySelector('.nav-item[data-tab="settings"]')?.click();
  });
}

function buildTemplateGrid(selectedId) {
  const grid = document.getElementById("autodrive-template-grid");
  if (!grid) return;
  grid.innerHTML = "";
  Object.values(AUTODRIVE_TEMPLATES).forEach((tpl) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const isLoop = tpl.group === "loops" || (tpl.placement || "").startsWith("loops_");
    btn.className =
      "autodrive-tpl-card" +
      (tpl.id === selectedId ? " active" : "") +
      (isLoop ? " tpl-loops" : "");
    btn.dataset.template = tpl.id;
    btn.innerHTML = `${isLoop ? `<span class="tpl-badge">Loops A+B</span>` : ""}<span class="tpl-name">${tpl.label}</span><span class="tpl-desc">${tpl.description || ""}</span>`;
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
    // Penis dual-loop templates pin placement + A/B role
    if (tpl.placement) {
      fillPlacementSelect(tpl.placement);
      updatePlacementGuide(tpl.placement, { applyRecommendations: false });
    }
    if (tpl.abRole) {
      const ab = document.getElementById("autodrive-ab-role");
      if (ab) ab.value = tpl.abRole;
    }
    if (tpl.channelFocus) {
      const focus = document.getElementById("autodrive-focus");
      if (focus) focus.value = tpl.channelFocus;
    }
  }
  buildTemplateGrid(id);
  // Highlight loop quick chips
  document.querySelectorAll(".loops-preset-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-loops-preset") === id);
  });
}

/** One-tap: only penis loops A+B (user main setup). */
function applyLoopsPreset(templateId) {
  selectTemplate(templateId || "loops_classic");
  collectConfigFromUi();
  setStatusMsg("Loops A+B Preset geladen — Soft-Limits prüfen, dann Start", false);
}

/** Fill placement &lt;select&gt; from engine profiles (ESTIM body applications). */
function fillPlacementSelect(selectedId) {
  const sel = document.getElementById("autodrive-placement");
  if (!sel) return;
  const profiles = listPlacementProfiles();
  const want = selectedId || sel.value || "soft_external";
  sel.innerHTML = profiles
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === want ? " selected" : ""}>${p.label} — ${p.description || ""}</option>`
    )
    .join("");
  if (![...sel.options].some((o) => o.value === want) && sel.options.length) {
    sel.selectedIndex = 0;
  }
  updatePlacementGuide(sel.value);
}

/**
 * Live ESTIM body-application guide next to placement picker.
 * @param {string} [placementId]
 * @param {{ applyRecommendations?: boolean }} [opts]
 */
export function updatePlacementGuide(placementId, opts = {}) {
  const id =
    placementId || document.getElementById("autodrive-placement")?.value || "soft_external";
  const p = getPlacementProfile(id);
  const set = (elId, text) => {
    const el = document.getElementById(elId);
    if (el) el.textContent = text || "";
  };
  set("ad-place-title", `${p.label}`);
  set("ad-place-sensation", p.sensation || p.description || "");
  set("ad-place-male", p.setupMale || p.bodySites || "");
  set("ad-place-female", p.setupFemale || p.bodySites || "");
  const tips = document.getElementById("ad-place-tips");
  if (tips) {
    tips.innerHTML = (p.tips || []).map((t) => `<li>${t}</li>`).join("");
  }
  const capPct = Math.round((p.strengthCap || 1) * 100);
  const freq =
    (p.freqBias || 0) > 0
      ? `Wire-Freq +${p.freqBias} (kräftiger)`
      : (p.freqBias || 0) < 0
        ? `Wire-Freq ${p.freqBias} (weicher)`
        : "Wire-Freq neutral";
  set(
    "ad-place-engine",
    `Autodrive: Soft-Cap ~${capPct}% · Duty ×${(p.dutyScale || 1).toFixed(2)} · ${freq}`
  );

  if (opts.applyRecommendations) {
    const ab = document.getElementById("autodrive-ab-role");
    if (ab && p.recommendedAbRole) ab.value = p.recommendedAbRole;
    const focus = document.getElementById("autodrive-focus");
    if (focus && p.recommendedFocus) focus.value = p.recommendedFocus;
  }
}

function fillSafetyList() {
  const ul = document.getElementById("autodrive-safety-list");
  if (!ul) return;
  ul.innerHTML = ESTIM_SAFETY_RULES.map((r) => `<li>${r}</li>`).join("");
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
  const placement = document.getElementById("autodrive-placement")?.value || "soft_external";
  const abRole = document.getElementById("autodrive-ab-role")?.value || "sync";
  const fullscreenPreferred = !!document.getElementById("autodrive-fullscreen-pref")?.checked;
  const hybridAudio = !!document.getElementById("autodrive-hybrid")?.checked;

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
    placement,
    abRole,
    fullscreenPreferred,
    hybridAudio,
  });
}

function paintHomeExtras() {
  const ready = document.getElementById("home-readiness");
  if (ready) {
    renderReadinessList(ready);
    ready.querySelectorAll(".ready-action").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = btn.getAttribute("data-action");
        if (a === "connect") document.getElementById("btn-connect")?.click();
        else if (a === "settings")
          document.querySelector('.nav-item[data-tab="settings"]')?.click();
        else if (a === "stim-calib") {
          document.querySelector('.nav-item[data-tab="stim"]')?.click();
          setTimeout(() => document.getElementById("btn-stim-calib-start")?.click(), 200);
        }
      });
    });
  }
  renderHomeMetrics(document.getElementById("home-metrics-detail"));

  const stories = document.getElementById("home-stories");
  if (stories && !stories.dataset.wired) {
    stories.dataset.wired = "1";
    stories.innerHTML = listStories()
      .map(
        (s) =>
          `<button type="button" class="story-card" data-story="${s.id}">
            <strong>${s.label}</strong>
            <span>${s.description}</span>
          </button>`
      )
      .join("");
    stories.querySelectorAll(".story-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = runStory(btn.getAttribute("data-story"));
        if (!r.ok) log(`Story: ${r.error}`, "error");
        else if (!r.stimOnly) {
          wasRunning = true;
          maybeOpenFullscreen();
        }
      });
    });
  }
}

function setStatusMsg(msg, isError) {
  const el = document.getElementById("autodrive-status-msg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--color-error, #f66)" : "var(--color-warning, #d83b01)";
}

function openFullscreen() {
  const el = document.getElementById("autodrive-fullscreen");
  if (el) el.style.display = "flex";
}

function closeFullscreen() {
  const el = document.getElementById("autodrive-fullscreen");
  if (el) el.style.display = "none";
}

function maybeOpenFullscreen() {
  const pref = document.getElementById("autodrive-fullscreen-pref");
  const cfg = loadAutodriveConfig();
  if ((pref && pref.checked) || cfg.fullscreenPreferred !== false) {
    openFullscreen();
  }
}

function openDebrief() {
  const snap = getLastSessionSnapshot();
  const modal = document.getElementById("autodrive-debrief");
  const summary = document.getElementById("ad-debrief-summary");
  if (!modal) return;
  debriefClimax = null;
  debriefOverall = null;
  if (summary && snap) {
    const min = Math.round((snap.durationMs || 0) / 60000);
    summary.textContent = `${min} Min · Edges ${snap.edges || 0} · Feedback zu schwach ${snap.tooWeak || 0} / zu stark ${snap.tooStrong || 0} / fast ${snap.almost || 0}${snap.marked ? " · Fertig markiert" : ""}`;
  } else if (summary) {
    summary.textContent = "Kurzes Feedback hilft der nächsten Session.";
  }
  modal.style.display = "flex";
}

function closeDebrief() {
  const modal = document.getElementById("autodrive-debrief");
  if (modal) modal.style.display = "none";
}

function submitDebrief() {
  applyDebrief({
    climax: debriefClimax || "no",
    overall: debriefOverall || "ok",
  });
  closeDebrief();
  paintCoach();
  setStatusMsg("Danke — Learning aktualisiert", false);
}

function handleStartResult(r, openFs) {
  if (!r.ok) {
    setStatusMsg(r.error || "Start fehlgeschlagen", true);
    log(`Autodrive: ${r.error}`, "error");
    if (r.error && /Nicht verbunden|verbunden/i.test(r.error)) {
      // stay helpful
    }
    return;
  }
  setStatusMsg("Läuft — Feedback nutzen (Fullscreen empfohlen)", false);
  wasRunning = true;
  paintDashboard(getAutodriveState());
  if (openFs !== false) maybeOpenFullscreen();
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
    fillPlacementSelect(cfg.placement || "soft_external");
    fillSafetyList();
    document.getElementById("autodrive-placement")?.addEventListener("change", (e) => {
      updatePlacementGuide(e.target.value, { applyRecommendations: true });
      collectConfigFromUi();
    });
    const ab = document.getElementById("autodrive-ab-role");
    if (ab && cfg.abRole) ab.value = cfg.abRole;
    const fsPref = document.getElementById("autodrive-fullscreen-pref");
    if (fsPref) fsPref.checked = cfg.fullscreenPreferred !== false;
    const hybrid = document.getElementById("autodrive-hybrid");
    if (hybrid) hybrid.checked = !!cfg.hybridAudio;
  } catch {
    buildTemplateGrid("classic");
    try {
      fillPlacementSelect("soft_external");
      fillSafetyList();
    } catch {
      /* ignore */
    }
  }

  paintHomeExtras();
  document.getElementById("stim-map-toggle")?.addEventListener("click", () => {
    const body = document.getElementById("stim-map-body");
    if (body) body.style.display = body.style.display === "none" ? "" : "none";
  });

  document.querySelectorAll(".loops-preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      applyLoopsPreset(chip.getAttribute("data-loops-preset") || "loops_classic");
    });
  });

  document.getElementById("btn-autodrive-start")?.addEventListener("click", () => {
    handleStartResult(startAutodrive(collectConfigFromUi()));
  });
  document.getElementById("btn-autodrive-last")?.addEventListener("click", () => {
    handleStartResult(startLastSuccess());
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
    const active = isAutodriveActive();
    if (active && (getAutodriveState().progress || 0) > 0.15) {
      if (!confirm("Autodrive wirklich stoppen?")) return;
    }
    stopAutodrive("ui");
    closeFullscreen();
    setStatusMsg("Gestoppt", false);
    paintDashboard(getAutodriveState());
    if (wasRunning) {
      wasRunning = false;
      setTimeout(openDebrief, 300);
    }
  });
  document.getElementById("btn-autodrive-fs")?.addEventListener("click", openFullscreen);

  // Global feedback buttons (normal + fullscreen use .autodrive-fb)
  document.querySelectorAll(".autodrive-fb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fb = btn.getAttribute("data-fb");
      if (!fb) return;
      if (!isAutodriveActive()) {
        setStatusMsg("Zuerst Autodrive starten", true);
        return;
      }
      injectFeedback(fb);
      if (fb === "climaxed") {
        // Aftercare then stop may follow — debrief when idle
        setTimeout(() => {
          if (!isAutodriveActive()) {
            closeFullscreen();
            openDebrief();
          }
        }, 800);
      }
    });
  });

  // Home
  document.getElementById("home-btn-connect")?.addEventListener("click", () => {
    document.getElementById("btn-connect")?.click();
  });
  document.getElementById("home-btn-quick-start")?.addEventListener("click", () => {
    handleStartResult(startQuickClassic(), true);
    document.querySelector('.nav-item[data-tab="autodrive"]')?.click();
  });
  document.getElementById("home-btn-last-success")?.addEventListener("click", () => {
    handleStartResult(startLastSuccess(), true);
    document.querySelector('.nav-item[data-tab="autodrive"]')?.click();
  });
  document.getElementById("home-btn-autodrive")?.addEventListener("click", () => {
    document.querySelector('.nav-item[data-tab="autodrive"]')?.click();
  });
  document.getElementById("home-btn-manual")?.addEventListener("click", () => {
    document.querySelector('.nav-item[data-tab="deck"]')?.click();
  });
  document.getElementById("home-btn-fullscreen")?.addEventListener("click", openFullscreen);

  // Fullscreen chrome
  document.getElementById("ad-fs-close")?.addEventListener("click", closeFullscreen);
  document.getElementById("ad-fs-pause")?.addEventListener("click", () => pauseAutodrive());
  document.getElementById("ad-fs-resume")?.addEventListener("click", () => resumeAutodrive());
  document.getElementById("ad-fs-stop")?.addEventListener("click", () => {
    document.getElementById("btn-autodrive-stop")?.click();
  });
  document.getElementById("ad-fs-nudge-up")?.addEventListener("click", () => {
    if (isAutodriveActive()) injectFeedback("nudge_up");
  });
  document.getElementById("ad-fs-nudge-down")?.addEventListener("click", () => {
    if (isAutodriveActive()) injectFeedback("nudge_down");
  });
  document.getElementById("autodrive-btn-connect")?.addEventListener("click", () => {
    document.getElementById("btn-connect")?.click();
  });

  // Auto-open fullscreen on push / edge; flash on phase change
  window.addEventListener("stim:autodrive-phase", (ev) => {
    const phase = ev.detail?.phase;
    const fs = document.getElementById("autodrive-fullscreen");
    if (phase === "CLIMAX_PUSH" || phase === "EDGE_HOLD") {
      if (fs && fs.style.display === "none") openFullscreen();
    }
    if (fs && fs.style.display !== "none") {
      fs.classList.add("ad-fs-flash");
      setTimeout(() => fs.classList.remove("ad-fs-flash"), 500);
    }
    if (phase === "CLIMAX_PUSH") hapticPulse([60, 40, 60, 40, 100]);
  });

  // Debrief
  document.querySelectorAll(".ad-debrief-climax").forEach((b) => {
    b.addEventListener("click", () => {
      debriefClimax = b.getAttribute("data-climax");
      document.querySelectorAll(".ad-debrief-climax").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      if (debriefOverall) submitDebrief();
    });
  });
  document.querySelectorAll(".ad-debrief-overall").forEach((b) => {
    b.addEventListener("click", () => {
      debriefOverall = b.getAttribute("data-overall");
      document.querySelectorAll(".ad-debrief-overall").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      if (debriefClimax) submitDebrief();
      else submitDebrief(); // overall alone is enough
    });
  });
  document.getElementById("ad-debrief-skip")?.addEventListener("click", closeDebrief);

  // Keyboard during fullscreen / autodrive
  window.addEventListener("keydown", (e) => {
    if (!isAutodriveActive()) return;
    if (
      e.target &&
      (e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT")
    ) {
      return;
    }
    const map = {
      Digit1: "too_weak",
      Digit2: "good",
      Digit3: "too_strong",
      Digit4: "almost",
      Digit5: "now",
      Digit6: "climaxed",
      Digit7: "not_yet",
      KeyF: "almost",
      KeyJ: "now",
      KeyG: "climaxed",
      Equal: "nudge_up",
      NumpadAdd: "nudge_up",
      Minus: "nudge_down",
      NumpadSubtract: "nudge_down",
    };
    const fb = map[e.code];
    if (fb) {
      e.preventDefault();
      injectFeedback(fb);
    }
  });

  onAutodriveUi((st) => {
    const running = st.phase && st.phase !== "IDLE";
    if (wasRunning && !running && st.phase === "IDLE") {
      // Natural end
      closeFullscreen();
      setTimeout(openDebrief, 400);
      wasRunning = false;
    }
    if (running) wasRunning = true;
    paintDashboard(st);
  });

  setInterval(() => {
    refreshHomeSummary();
    paintHomeExtras();
  }, 1000);
  paintDashboard(getAutodriveState());
  paintCoach();
});
