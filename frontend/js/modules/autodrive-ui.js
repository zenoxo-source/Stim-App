// autodrive-ui.js — Home 1-tap, fullscreen session, prompts, debrief, coach

import { AppState, log } from "../state.js";
import { i18nText } from "./i18n.js";
import * as ProtocolUtils from "../lib/protocol-utils.js";
// log used by stories
import {
  startAutodrive,
  startQuickClassic,
  startLastSuccess,
  hasLastSuccess,
  startLastSession,
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
  loadSessionHistory,
  applyDebrief,
  exportAutodriveSetup,
  importAutodriveSetup,
  getSoftLimitCoachMessage,
  clearSoftLimitCoach,
  getAutodriveStatsSummary,
  hapticPulse,
  AUTODRIVE_TEMPLATES,
  listPlacementProfiles,
  getPlacementProfile,
  estimateWireFreqEnvelope,
  buildTrustLine,
  probeChannel,
  needsAutodriveOnboarding,
  markAutodriveOnboardingSeen,
  ESTIM_SAFETY_RULES,
} from "./autodrive.js";
import { waveFreqLabel } from "../lib/protocol-utils.js";
import {
  listElectrodeKinds,
  listWiringModes,
  listBodySites,
  listSetupPresets,
  getSetupPreset,
  derivePlacementFromSetup,
  buildWiringChecklist,
  recommendSoftLimitB,
  PENIS_MAP_ZONES,
  WIRING_MODES,
  ELECTRODE_KINDS,
} from "../lib/estim-setup.js";
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

// F1: climax celebration overlay (confetti + auto-hide).
function showClimaxOverlay() {
  const el = document.getElementById("ad-fs-climax");
  if (!el) return;
  el.querySelectorAll(".ad-confetti").forEach((c) => c.remove());
  const colors = ["#f92672", "#a6e22e", "#5ab3ff", "#d7b4f3", "#fd971f", "#e6db74"];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement("span");
    c.className = "ad-confetti";
    c.style.left = Math.random() * 100 + "%";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2 + Math.random() * 2 + "s";
    c.style.animationDelay = Math.random() * 0.6 + "s";
    el.appendChild(c);
  }
  el.style.display = "flex";
  clearTimeout(showClimaxOverlay.timer);
  showClimaxOverlay.timer = setTimeout(() => {
    el.style.display = "none";
  }, 4000);
}
window.addEventListener("stim:autodrive-climax", showClimaxOverlay);

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

  // Compact freq envelope (current · max) — paintFreq lives in autodrive notifyUi;
  // keep in sync when only UI listener paints.
  const freqEl = document.getElementById("autodrive-freq");
  if (freqEl && st.wireFreq != null) freqEl.textContent = String(st.wireFreq);
  const env = st.wireFreqEnvelope || estimateWireFreqEnvelope(st.config || loadAutodriveConfig());
  const maxEl = document.getElementById("autodrive-freq-max");
  if (maxEl && env) maxEl.innerHTML = `· max <strong>${env.hi}</strong>`;
  const fill = document.getElementById("autodrive-freq-meter-fill");
  if (fill && env) {
    const left = ((env.lo - 10) / 230) * 100;
    const width = ((env.hi - env.lo) / 230) * 100;
    fill.style.left = `${Math.max(0, left)}%`;
    fill.style.width = `${Math.min(100 - left, Math.max(2, width))}%`;
  }
  const nowMk = document.getElementById("autodrive-freq-meter-now");
  if (nowMk) {
    const w = Number(st.wireFreq);
    if (Number.isFinite(w) && w > 0) {
      nowMk.style.display = "block";
      nowMk.style.left = `${Math.max(0, Math.min(100, ((w - 10) / 230) * 100))}%`;
    } else {
      nowMk.style.display = "none";
    }
  }
  const bandLab = document.getElementById("autodrive-freq-band-label");
  if (bandLab && env) {
    const feel = waveFreqLabel(env.hi);
    bandLab.textContent = `${env.lo}–${env.hi} · max ${env.hi} · ${feel}`;
  }

  const trust = document.getElementById("autodrive-trust");
  if (trust) trust.textContent = buildTrustLine(st);

  paintTimeline(st);
  paintHistory();
  refreshHomeSummary();
  paintCoach();
  paintOnboarding();
}

/** F4: last sessions list on Home with 1-click restart. */
function paintHistory() {
  const box = document.getElementById("ad-history");
  if (!box) return;
  const history = loadSessionHistory();
  if (history.length === 0) {
    box.innerHTML = "";
    return;
  }
  const esc = (s) => (ProtocolUtils.escapeHtml ? ProtocolUtils.escapeHtml(s) : s);
  const rows = history
    .slice(-10)
    .reverse()
    .map((h) => {
      const min = Math.round((h.durationMs || 0) / 60000);
      const date = new Date(h.endedAt || Date.now()).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const mark = h.marked ? " · ✅" : "";
      const tpl = h.templateId ? ` · ${esc(h.templateId)}` : "";
      return `<div class="stat-list-row ad-history-row" data-hidx="${history.indexOf(h)}">
        <span>${date} · ${min} Min · Phase ${esc(h.phase || "—")} · Edges ${h.edges || 0}${tpl}${mark}</span>
        <button type="button" class="btn btn-secondary btn-sm ad-history-restart" title="Session erneut starten">↻</button>
      </div>`;
    })
    .join("");
  box.innerHTML = `<div class="card-title" style="font-size:12px;">Letzte Sessions</div>${rows}`;
  box.querySelectorAll(".ad-history-restart").forEach((b) => {
    b.onclick = () => {
      const row = b.closest(".ad-history-row");
      if (!row) return;
      const h = history[Number(row.dataset.hidx)];
      if (!h || !h.config) {
        setStatusMsg("Kein Setup für diese Session", true);
        return;
      }
      const r = startAutodrive({ ...h.config, skipCalibration: true });
      handleStartResult(r, true);
    };
  });
}

function paintOnboarding() {
  const box = document.getElementById("ad-onboarding");
  if (!box) return;
  const show = needsAutodriveOnboarding() && !isAutodriveActive();
  box.style.display = show ? "block" : "none";
  if (!show) return;
  const meta = document.getElementById("ad-onboard-limits");
  if (meta) {
    meta.textContent = `A ${AppState.softLimitA ?? "—"} · B ${AppState.softLimitB ?? "—"}`;
  }
}

function runProbe(ch) {
  const r = probeChannel(ch);
  if (!r.ok) {
    setStatusMsg(r.error || "Probe fehlgeschlagen", true);
    return;
  }
  setStatusMsg(`Probe ${r.channel}: Strength ${r.level} · ${(r.ms / 1000).toFixed(1)}s`, false);
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
  const setup = readSetupFromUi();
  const single = setup.wiringMode === "single_channel_2";
  grid.innerHTML = "";
  Object.values(AUTODRIVE_TEMPLATES).forEach((tpl) => {
    // Hide dual-only loop templates when 1-channel; hide 1-channel templates when dual
    if (single) {
      if (tpl.group === "loops") return;
      if ((tpl.placement || "").startsWith("loops_ab")) return;
    } else if (tpl.group === "loops_single") {
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    const isLoopAb = tpl.group === "loops" || (tpl.placement || "").startsWith("loops_ab");
    const isLoop1 = tpl.group === "loops_single" || tpl.placement === "deep_pressure";
    btn.className =
      "autodrive-tpl-card" +
      (tpl.id === selectedId ? " active" : "") +
      (isLoopAb || isLoop1 ? " tpl-loops" : "");
    btn.dataset.template = tpl.id;
    const badge = isLoop1
      ? `<span class="tpl-badge">1 Kanal</span>`
      : isLoopAb
        ? `<span class="tpl-badge">Loops A+B</span>`
        : "";
    btn.innerHTML = `${badge}<span class="tpl-name">${tpl.label}</span><span class="tpl-desc">${tpl.description || ""}</span>`;
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
    // Penis dual-loop / 1-kanal templates pin placement + wiring + A/B role
    if (tpl.wiringMode) {
      const w = document.getElementById("ad-wiring-mode");
      if (w) w.value = tpl.wiringMode;
    }
    if (tpl.electrodeKind) {
      const ek = document.getElementById("ad-electrode-kind");
      if (ek) ek.value = tpl.electrodeKind;
    }
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
  paintChannelModeUi();
  // Highlight loop quick chips
  document.querySelectorAll(".loops-preset-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-loops-preset") === id);
  });
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
  const cfg = { placement: id, ...(loadAutodriveConfig() || {}) };
  const env = estimateWireFreqEnvelope({ ...cfg, placement: id });
  const feel = waveFreqLabel(env.hi);
  set(
    "ad-place-engine",
    `Soft-Cap ~${capPct}% · Duty ×${(p.dutyScale || 1).toFixed(2)} · ${freq} · Freq max ${env.hi} (${feel})`
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

function readSetupFromUi() {
  return {
    electrodeKind: document.getElementById("ad-electrode-kind")?.value || "loops",
    wiringMode: document.getElementById("ad-wiring-mode")?.value || "independent_4",
    siteA1: document.getElementById("ad-site-a1")?.value || "base",
    siteA2: document.getElementById("ad-site-a2")?.value || "mid",
    siteB1: document.getElementById("ad-site-b1")?.value || "corona",
    siteB2: document.getElementById("ad-site-b2")?.value || "glans",
    balanceB: Number(document.getElementById("ad-balance-b")?.value) || 100,
  };
}

function collectConfigFromUi() {
  const templateId = document.getElementById("autodrive-template")?.value || "classic";
  const tpl = AUTODRIVE_TEMPLATES[templateId] || AUTODRIVE_TEMPLATES.classic;
  let focus = document.getElementById("autodrive-focus")?.value || "both";
  const sensitivity = document.getElementById("autodrive-sensitivity")?.value || "medium";
  const durationRaw = Number(document.getElementById("autodrive-duration")?.value);
  const targetDurationMin = Number.isFinite(durationRaw)
    ? Math.max(2, Math.min(60, durationRaw))
    : tpl.targetDurationMin;
  const autoClimb = !!document.getElementById("autodrive-auto-climb")?.checked;
  const setup = readSetupFromUi();
  if (setup.wiringMode === "single_channel_2") {
    focus = focus === "B" ? "B" : "A";
    setup.siteB1 = setup.siteA1;
    setup.siteB2 = setup.siteA2;
  }
  let placement =
    document.getElementById("autodrive-placement")?.value ||
    derivePlacementFromSetup({ ...setup, balanceB: setup.balanceB });
  if (
    setup.wiringMode === "single_channel_2" &&
    setup.electrodeKind === "loops" &&
    placement !== "perineum_combo"
  ) {
    placement = "deep_pressure";
  }
  let abRole = document.getElementById("autodrive-ab-role")?.value || "sync";
  if (setup.wiringMode === "single_channel_2") abRole = "sync";
  const fullscreenPreferred = !!document.getElementById("autodrive-fullscreen-pref")?.checked;
  const hybridAudio = !!document.getElementById("autodrive-hybrid")?.checked;

  const presetId =
    document.querySelector(".ad-preset-chip.active")?.getAttribute("data-setup-preset") || null;
  const preset = presetId ? getSetupPreset(presetId) : null;
  const climaxPriority =
    typeof tpl.climaxPriority === "boolean"
      ? tpl.climaxPriority
      : typeof preset?.climaxPriority === "boolean"
        ? preset.climaxPriority
        : undefined;
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
    ...setup,
    setupPresetId: presetId,
    ...(typeof climaxPriority === "boolean" ? { climaxPriority } : {}),
  });
}

function fillSelect(el, items, valueKey = "id", labelFn) {
  if (!el) return;
  const cur = el.value;
  el.innerHTML = items
    .map((it) => {
      const id = it[valueKey] || it.id;
      const label = labelFn ? labelFn(it) : it.label || id;
      return `<option value="${id}">${label}</option>`;
    })
    .join("");
  if (cur && [...el.options].some((o) => o.value === cur)) el.value = cur;
}

function fillSetupControls(cfg) {
  fillSelect(document.getElementById("ad-electrode-kind"), listElectrodeKinds());
  fillSelect(document.getElementById("ad-wiring-mode"), listWiringModes(), "id", (w) => w.label);
  const sites = listBodySites();
  ["ad-site-a1", "ad-site-a2", "ad-site-b1", "ad-site-b2"].forEach((id) => {
    fillSelect(document.getElementById(id), sites, "id", (s) => s.label);
  });
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && v != null) el.value = String(v);
  };
  setVal("ad-electrode-kind", cfg.electrodeKind || "loops");
  setVal("ad-wiring-mode", cfg.wiringMode || "independent_4");
  setVal("ad-site-a1", cfg.siteA1 || "base");
  setVal("ad-site-a2", cfg.siteA2 || "mid");
  setVal("ad-site-b1", cfg.siteB1 || "corona");
  setVal("ad-site-b2", cfg.siteB2 || "glans");
  const bal = document.getElementById("ad-balance-b");
  if (bal) bal.value = String(cfg.balanceB ?? 85);
  const balLbl = document.getElementById("ad-balance-b-val");
  if (balLbl) balLbl.textContent = `${cfg.balanceB ?? 85}%`;
  renderSetupPresets(cfg.setupPresetId);
  refreshSetupDerivedUi(false);
}

function renderSetupPresets(activeId) {
  const strip = document.getElementById("ad-setup-presets");
  if (!strip) return;
  // Finish-first sort for "abspritzen" UX
  const presets = [...listSetupPresets()].sort(
    (a, b) => (b.finishScore || 0) - (a.finishScore || 0)
  );
  strip.innerHTML = presets
    .map((p) => {
      const on = p.id === activeId ? " active" : "";
      const star = (p.finishScore || 0) >= 4 ? "finish" : "";
      return `<button type="button" class="ad-preset-chip ${star}${on}" data-setup-preset="${p.id}">
        ${p.label}<small>${p.description || p.tag || ""}</small>
      </button>`;
    })
    .join("");
  strip.querySelectorAll(".ad-preset-chip").forEach((btn) => {
    btn.addEventListener("click", () => applySetupPreset(btn.getAttribute("data-setup-preset")));
  });
  paintClimaxAdvice(activeId);
}

function paintClimaxAdvice(presetId) {
  let box = document.getElementById("ad-climax-advice");
  if (!box) {
    const host = document.getElementById("ad-panel-setup");
    if (!host) return;
    box = document.createElement("div");
    box.id = "ad-climax-advice";
    box.className = "ad-climax-advice";
    const guide = document.getElementById("autodrive-placement-guide");
    if (guide) host.insertBefore(box, guide);
    else host.appendChild(box);
  }
  const p = getSetupPreset(presetId) || getSetupPreset("loops_ab_finish");
  if (!p) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  const score = p.finishScore || 0;
  const bar = "●".repeat(score) + "○".repeat(Math.max(0, 5 - score));
  const softA = AppState.softLimitA || 0;
  const sugB = softA > 0 ? recommendSoftLimitB(softA, p) : null;
  const softLine =
    softA > 0 && sugB != null
      ? `<p class="ad-climax-soft">Bei deinem Soft-Limit A=${softA} → B≈${sugB} empfohlen</p>`
      : "";
  const settings = (p.settingsLines || []).map((t) => `<li>${t}</li>`).join("");
  const tips = (p.tips || []).map((t) => `<li>${t}</li>`).join("");
  box.innerHTML = `
    <div class="ad-climax-advice-h">Empfehlung zum Abspritzen <span class="ad-finish-score">${bar}</span></div>
    <p class="ad-climax-advice-body">${p.climaxAdvice || p.description || ""}</p>
    ${softLine}
    ${settings ? `<ul class="ad-climax-settings">${settings}</ul>` : ""}
    ${tips ? `<ul class="ad-climax-tips">${tips}</ul>` : ""}
  `;
}

function applySetupPreset(presetId) {
  const p = getSetupPreset(presetId);
  if (!p) return;
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && v != null) el.value = String(v);
  };
  setVal("ad-electrode-kind", p.electrodeKind);
  setVal("ad-wiring-mode", p.wiringMode);
  setVal("ad-site-a1", p.siteA1);
  setVal("ad-site-a2", p.siteA2);
  setVal("ad-site-b1", p.siteB1);
  setVal("ad-site-b2", p.siteB2);
  const bal = document.getElementById("ad-balance-b");
  if (bal) bal.value = String(p.balanceB ?? 85);
  if (p.templateId) selectTemplate(p.templateId);
  if (p.abRole) {
    const ab = document.getElementById("autodrive-ab-role");
    if (ab) ab.value = p.abRole;
  }
  if (p.channelFocus) {
    const f = document.getElementById("autodrive-focus");
    if (f) f.value = p.channelFocus;
  }
  // Default sites for 2-loop single channel if missing
  if (p.wiringMode === "single_channel_2" && p.electrodeKind === "loops") {
    if (!p.siteA1) setVal("ad-site-a1", "base");
    if (!p.siteA2) setVal("ad-site-a2", "glans");
  }
  renderSetupPresets(presetId);
  refreshSetupDerivedUi(true);
  const curTpl = document.getElementById("autodrive-template")?.value;
  buildTemplateGrid(curTpl || p.templateId || "classic");
  const cfg = collectConfigFromUi();
  if (typeof p.climaxPriority === "boolean") {
    saveAutodriveConfig({ climaxPriority: p.climaxPriority });
  }
  setStatusMsg(
    p.finishScore >= 4
      ? `Finish-Setup „${p.label}“ — Kalibrieren, dann „Fast“ im Push`
      : `Setup „${p.label}“ geladen`,
    false
  );
  void cfg;
}

function isSingleChannelUi() {
  return (document.getElementById("ad-wiring-mode")?.value || "") === "single_channel_2";
}

function getSingleChannelFocus() {
  const focus = document.getElementById("autodrive-focus")?.value;
  if (focus === "B") return "B";
  return "A";
}

/**
 * Show/hide dual vs single-channel controls and sync layout cards.
 */
function paintChannelModeUi() {
  const single = isSingleChannelUi();
  const focus = getSingleChannelFocus();

  const chPick = document.getElementById("ad-channel-pick");
  if (chPick) chPick.style.display = single ? "flex" : "none";

  document.querySelectorAll(".ad-ch-btn").forEach((btn) => {
    btn.classList.toggle("active", single && btn.getAttribute("data-ch") === focus);
  });
  const chHint = document.getElementById("ad-ch-hint");
  if (chHint) chHint.textContent = focus;

  const siteB = document.getElementById("ad-site-card-b");
  const bal = document.getElementById("ad-balance-wrap");
  const abRole = document.getElementById("ad-ab-role-wrap");
  const dualOpts = document.getElementById("ad-dual-options");
  const singleHint = document.getElementById("ad-single-focus-hint");
  const probeB = document.getElementById("ad-probe-b-main");
  const probeBOn = document.getElementById("ad-probe-b");

  if (siteB) siteB.style.display = single ? "none" : "";
  if (bal) bal.style.display = single ? "none" : "";
  if (abRole) abRole.style.display = single ? "none" : "";
  if (singleHint) singleHint.style.display = single ? "block" : "none";

  // In single mode, focus select only A/B (no "both")
  const focusSel = document.getElementById("autodrive-focus");
  if (focusSel) {
    if (single) {
      if (focusSel.value === "both") focusSel.value = focus;
      [...focusSel.options].forEach((o) => {
        if (o.value === "both") o.hidden = true;
      });
      if (dualOpts) dualOpts.style.display = "grid";
    } else {
      [...focusSel.options].forEach((o) => {
        o.hidden = false;
      });
      if (dualOpts) dualOpts.style.display = "grid";
    }
  }

  const siteAh = document.getElementById("ad-site-card-a-h");
  if (siteAh) {
    siteAh.textContent = single ? `Kanal ${focus} (aktiv)` : "Kanal A";
  }

  // Probe: highlight the active channel in single mode
  if (probeB) probeB.style.opacity = single && focus === "A" ? "0.45" : "1";
  if (probeBOn) probeBOn.style.opacity = single && focus === "A" ? "0.45" : "1";
  const probeA = document.getElementById("ad-probe-a-main");
  if (probeA) probeA.style.opacity = single && focus === "B" ? "0.45" : "1";
  const probeAOn = document.getElementById("ad-probe-a");
  if (probeAOn) probeAOn.style.opacity = single && focus === "B" ? "0.45" : "1";

  // Layout cards
  const wiring = document.getElementById("ad-wiring-mode")?.value || "independent_4";
  const kind = document.getElementById("ad-electrode-kind")?.value || "loops";
  document.querySelectorAll(".ad-layout-card").forEach((card) => {
    const layout = card.getAttribute("data-layout");
    let on = false;
    if (layout === "loops_single") on = kind === "loops" && wiring === "single_channel_2";
    else if (layout === "loops_ab") on = kind === "loops" && wiring === "independent_4";
    else if (layout === "loops_common") on = kind === "loops" && wiring === "common_3";
    else if (layout === "pads") on = kind === "pads";
    card.classList.toggle("active", on);
  });

  // Live meters: dim unused channel
  const wrapA = document.getElementById("autodrive-meter-wrap-a");
  const wrapB = document.getElementById("autodrive-meter-wrap-b");
  if (wrapA) wrapA.style.opacity = single && focus === "B" ? "0.35" : "1";
  if (wrapB) wrapB.style.opacity = single && focus === "A" ? "0.35" : "1";
}

function refreshSetupDerivedUi(applyRecs) {
  const setup = readSetupFromUi();
  const focus = getSingleChannelFocus();
  // Mirror A sites onto B for single-channel so checklist/labels stay consistent
  if (setup.wiringMode === "single_channel_2") {
    const a1 = document.getElementById("ad-site-a1")?.value || "base";
    const a2 = document.getElementById("ad-site-a2")?.value || "glans";
    const b1 = document.getElementById("ad-site-b1");
    const b2 = document.getElementById("ad-site-b2");
    if (b1) b1.value = a1;
    if (b2) b2.value = a2;
    setup.siteB1 = a1;
    setup.siteB2 = a2;
    setup.channelFocus = focus;
    const ab = document.getElementById("autodrive-ab-role");
    if (ab) ab.value = "sync";
  }

  let placement = derivePlacementFromSetup({ ...setup, balanceB: setup.balanceB });
  // Mixed perineum single-channel keeps pelvic placement
  if (
    setup.wiringMode === "single_channel_2" &&
    setup.electrodeKind === "mixed" &&
    (setup.siteA1 === "perineum" || setup.siteA2 === "perineum")
  ) {
    placement = "perineum_combo";
  }

  const placeSel = document.getElementById("autodrive-placement");
  if (placeSel) {
    if (![...placeSel.options].some((o) => o.value === placement)) {
      fillPlacementSelect(placement);
    }
    placeSel.value = placement;
  }
  updatePlacementGuide(placement, { applyRecommendations: !!applyRecs });
  if (applyRecs && setup.wiringMode === "single_channel_2") {
    const f = document.getElementById("autodrive-focus");
    if (f && f.value !== "A" && f.value !== "B") f.value = "A";
  }

  const wiring = WIRING_MODES[setup.wiringMode];
  const hint = document.getElementById("ad-wiring-hint");
  if (hint && wiring) {
    hint.textContent = wiring.warn ? `${wiring.description} · ${wiring.warn}` : wiring.description;
  }
  const list = document.getElementById("ad-wiring-checklist");
  if (list) {
    const lines = buildWiringChecklist({
      ...setup,
      placement,
      channelFocus: setup.wiringMode === "single_channel_2" ? focus : setup.channelFocus,
    });
    list.innerHTML = `<strong>Verkabelungs-Check</strong><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
  }
  const balLbl = document.getElementById("ad-balance-b-val");
  if (balLbl) balLbl.textContent = `${setup.balanceB}%`;
  paintBodyMap({
    ...setup,
    // single: only paint active channel sites
    siteB1: setup.wiringMode === "single_channel_2" ? setup.siteA1 : setup.siteB1,
    siteB2: setup.wiringMode === "single_channel_2" ? setup.siteA2 : setup.siteB2,
  });
  if (setup.wiringMode === "single_channel_2") {
    // Body map: show only as one channel color
    paintBodyMapSingle(setup, focus);
  }
  const setupLbl = document.getElementById("autodrive-setup-label");
  if (setupLbl) {
    const ek = ELECTRODE_KINDS[setup.electrodeKind]?.label || setup.electrodeKind;
    const ch = setup.wiringMode === "single_channel_2" ? ` · nur ${focus}` : "";
    setupLbl.textContent = `${ek} · ${getPlacementProfile(placement).label}${ch}`;
  }
  paintChannelModeUi();
}

function paintBodyMapSingle(setup, focus) {
  const g = document.getElementById("ad-map-zones");
  if (!g) return;
  const sites = new Set([setup.siteA1, setup.siteA2]);
  const clsActive = focus === "B" ? "active-b" : "active-a";
  g.innerHTML = PENIS_MAP_ZONES.map((z) => {
    let cls = "ad-map-zone";
    if (sites.has(z.id)) cls += ` ${clsActive}`;
    return `<circle class="${cls}" data-site="${z.id}" cx="${z.cx}" cy="${z.cy}" r="${z.r}">
      <title>${z.label}</title></circle>`;
  }).join("");
  const legend = document.getElementById("ad-map-legend");
  if (legend) {
    legend.innerHTML = `
      <span><i class="ad-map-dot ${focus === "B" ? "b" : "a"}"></i> Kanal ${focus} (aktiv)</span>
      <span>anderer Kanal aus</span>`;
  }
}

function paintBodyMap(setup) {
  const g = document.getElementById("ad-map-zones");
  if (!g) return;
  const aSites = new Set([setup.siteA1, setup.siteA2]);
  const bSites = new Set([setup.siteB1, setup.siteB2]);
  g.innerHTML = PENIS_MAP_ZONES.map((z) => {
    let cls = "ad-map-zone";
    const onA = aSites.has(z.id);
    const onB = bSites.has(z.id);
    if (onA && onB) cls += " active-both";
    else if (onA) cls += " active-a";
    else if (onB) cls += " active-b";
    return `<circle class="${cls}" data-site="${z.id}" cx="${z.cx}" cy="${z.cy}" r="${z.r}">
      <title>${z.label}</title></circle>`;
  }).join("");
  const legend = document.getElementById("ad-map-legend");
  if (legend) {
    legend.innerHTML = `
      <span><i class="ad-map-dot a"></i> Kanal A</span>
      <span><i class="ad-map-dot b"></i> Kanal B</span>
      <span>Lila = beide</span>`;
  }
}

function goWizardPanel(id) {
  document.querySelectorAll(".ad-config-tab").forEach((t) => {
    const on = t.getAttribute("data-ad-panel") === id;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("[data-ad-panel-body]").forEach((panel) => {
    const on = panel.getAttribute("data-ad-panel-body") === id;
    panel.hidden = !on;
    panel.classList.toggle("active", on);
  });
  if (id === "session") {
    // Rebuild template list for current wiring (1-kanal vs dual)
    const cur = document.getElementById("autodrive-template")?.value;
    buildTemplateGrid(cur || "classic");
  }
}

function wireConfigTabs() {
  document.querySelectorAll(".ad-config-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      goWizardPanel(tab.getAttribute("data-ad-panel"));
    });
  });
}

/**
 * Apply a layout card: wiring + electrode kind (+ default sites).
 * @param {"loops_single"|"loops_ab"|"loops_common"|"pads"} layout
 */
function applyLayoutCard(layout) {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && v != null) el.value = String(v);
  };
  if (layout === "loops_single") {
    setVal("ad-electrode-kind", "loops");
    setVal("ad-wiring-mode", "single_channel_2");
    setVal("ad-site-a1", "base");
    setVal("ad-site-a2", "glans");
    setVal("ad-site-b1", "base");
    setVal("ad-site-b2", "glans");
    const f = document.getElementById("autodrive-focus");
    if (f) f.value = f.value === "B" ? "B" : "A";
    const ab = document.getElementById("autodrive-ab-role");
    if (ab) ab.value = "sync";
    selectTemplate("finish_loops_single");
  } else if (layout === "loops_ab") {
    setVal("ad-electrode-kind", "loops");
    setVal("ad-wiring-mode", "independent_4");
    setVal("ad-site-a1", "base");
    setVal("ad-site-a2", "mid");
    setVal("ad-site-b1", "corona");
    setVal("ad-site-b2", "glans");
    const f = document.getElementById("autodrive-focus");
    if (f) f.value = "both";
    selectTemplate("finish_loops");
  } else if (layout === "loops_common") {
    setVal("ad-electrode-kind", "loops");
    setVal("ad-wiring-mode", "common_3");
    setVal("ad-site-a1", "base");
    setVal("ad-site-a2", "mid");
    setVal("ad-site-b1", "base");
    setVal("ad-site-b2", "glans");
    const f = document.getElementById("autodrive-focus");
    if (f) f.value = "both";
  } else if (layout === "pads") {
    setVal("ad-electrode-kind", "pads");
    setVal("ad-wiring-mode", "independent_4");
    setVal("ad-site-a1", "perineum");
    setVal("ad-site-a2", "base");
    setVal("ad-site-b1", "pubis");
    setVal("ad-site-b2", "mid");
    const f = document.getElementById("autodrive-focus");
    if (f) f.value = "both";
    selectTemplate("finish_pads");
  }
  refreshSetupDerivedUi(true);
  collectConfigFromUi();
  setStatusMsg(
    layout === "loops_single"
      ? `2 Loops · Kanal ${getSingleChannelFocus()} — beide Loops an diesen Kanal stecken`
      : "Layout geladen",
    false
  );
}

function setSingleChannelFocus(ch) {
  const focus = ch === "B" ? "B" : "A";
  const f = document.getElementById("autodrive-focus");
  if (f) f.value = focus;
  // Prefer matching preset chip if present
  const want = focus === "B" ? "loops_single_b" : "loops_single_a";
  const strip = document.getElementById("ad-setup-presets");
  if (strip && isSingleChannelUi()) {
    strip.querySelectorAll(".ad-preset-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-setup-preset") === want);
    });
  }
  refreshSetupDerivedUi(false);
  collectConfigFromUi();
  setStatusMsg(`Aktiver Kanal: ${focus}`, false);
}

function wireSetupListeners() {
  const ids = [
    "ad-electrode-kind",
    "ad-wiring-mode",
    "ad-site-a1",
    "ad-site-a2",
    "ad-site-b1",
    "ad-site-b2",
    "ad-balance-b",
  ];
  ids.forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      refreshSetupDerivedUi(false);
      collectConfigFromUi();
      if (id === "ad-wiring-mode" || id === "ad-electrode-kind") {
        const cur = document.getElementById("autodrive-template")?.value;
        buildTemplateGrid(cur || "classic");
      }
    });
    document.getElementById(id)?.addEventListener("input", () => {
      if (id === "ad-balance-b") refreshSetupDerivedUi(false);
    });
  });

  document.getElementById("autodrive-focus")?.addEventListener("change", () => {
    if (isSingleChannelUi()) {
      setSingleChannelFocus(document.getElementById("autodrive-focus")?.value);
    } else {
      collectConfigFromUi();
    }
  });

  document.querySelectorAll(".ad-layout-card").forEach((card) => {
    card.addEventListener("click", () => {
      applyLayoutCard(card.getAttribute("data-layout"));
    });
  });
  document.getElementById("ad-ch-a")?.addEventListener("click", () => setSingleChannelFocus("A"));
  document.getElementById("ad-ch-b")?.addEventListener("click", () => setSingleChannelFocus("B"));

  document.getElementById("ad-wiz-next-setup")?.addEventListener("click", () => {
    collectConfigFromUi();
    goWizardPanel("session");
  });
  document.getElementById("ad-wiz-back-session")?.addEventListener("click", () => {
    goWizardPanel("setup");
  });
  document.getElementById("ad-wiz-next-session")?.addEventListener("click", () => {
    collectConfigFromUi();
    goWizardPanel("fine");
  });
  document.getElementById("ad-wiz-back-fine")?.addEventListener("click", () => {
    goWizardPanel("session");
  });
  document.getElementById("ad-wiz-start")?.addEventListener("click", () => {
    markAutodriveOnboardingSeen();
    handleStartResult(startAutodrive(collectConfigFromUi()));
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
          `<button type="button" class="story-card" data-story="${ProtocolUtils.escapeHtml(s.id)}">
            <strong>${ProtocolUtils.escapeHtml(s.label)}</strong>
            <span>${ProtocolUtils.escapeHtml(s.description || "")}</span>
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
  const restartBtn = document.getElementById("ad-debrief-restart");
  if (!modal) return;
  debriefClimax = null;
  debriefOverall = null;
  if (restartBtn) restartBtn.style.display = snap && snap.config ? "inline-block" : "none";
  if (summary && snap) {
    const min = Math.round((snap.durationMs || 0) / 60000);
    const phase = snap.phase ? ` · Phase ${snap.phase}` : "";
    const peak = snap.peakRel ? ` · Peak ${Math.round(snap.peakRel * 100)}%` : "";
    summary.textContent = `${min} Min · Edges ${snap.edges || 0} · Feedback zu schwach ${snap.tooWeak || 0} / zu stark ${snap.tooStrong || 0} / fast ${snap.almost || 0}${phase}${peak}${snap.marked ? " · Fertig markiert" : ""}`;
  } else if (summary) {
    summary.textContent = i18nText(
      "ad_debrief_summary_placeholder",
      "Kurzes Feedback hilft der nächsten Session."
    );
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
    fillPlacementSelect(cfg.placement || "loops_ab_penis");
    fillSafetyList();
    fillSetupControls(cfg);
    wireConfigTabs();
    wireSetupListeners();
    const ab = document.getElementById("autodrive-ab-role");
    if (ab && cfg.abRole) ab.value = cfg.abRole;
    const fsPref = document.getElementById("autodrive-fullscreen-pref");
    if (fsPref) fsPref.checked = cfg.fullscreenPreferred !== false;
    const hybrid = document.getElementById("autodrive-hybrid");
    if (hybrid) hybrid.checked = !!cfg.hybridAudio;
  } catch (err) {
    console.warn("autodrive UI init", err);
    buildTemplateGrid("classic");
    try {
      fillPlacementSelect("loops_ab_penis");
      fillSafetyList();
      fillSetupControls(loadAutodriveConfig());
      wireConfigTabs();
      wireSetupListeners();
    } catch {
      /* ignore */
    }
  }

  paintHomeExtras();
  document.getElementById("stim-map-toggle")?.addEventListener("click", () => {
    const body = document.getElementById("stim-map-body");
    if (body) body.style.display = body.style.display === "none" ? "" : "none";
  });

  document.getElementById("btn-autodrive-start")?.addEventListener("click", () => {
    markAutodriveOnboardingSeen();
    handleStartResult(startAutodrive(collectConfigFromUi()));
  });

  document.getElementById("ad-onboard-dismiss")?.addEventListener("click", () => {
    markAutodriveOnboardingSeen();
    paintOnboarding();
  });
  document.getElementById("ad-onboard-goto-limits")?.addEventListener("click", () => {
    document.querySelector('.nav-item[data-tab="settings"]')?.click();
  });
  document.getElementById("ad-onboard-loops")?.addEventListener("click", () => {
    applySetupPreset("loops_single_a");
    applyLayoutCard("loops_single");
    goWizardPanel("setup");
  });
  document.getElementById("ad-onboard-start")?.addEventListener("click", () => {
    markAutodriveOnboardingSeen();
    handleStartResult(startAutodrive({ ...collectConfigFromUi(), skipCalibration: false }));
  });
  ["ad-probe-a", "ad-probe-a-main"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => runProbe("A"));
  });
  ["ad-probe-b", "ad-probe-b-main"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => runProbe("B"));
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

  // Restart the last session 1-click from the debrief modal.
  document.getElementById("ad-debrief-restart")?.addEventListener("click", () => {
    const r = startLastSession();
    closeDebrief();
    handleStartResult(r, true);
  });

  // F4: Autodrive setup export/import.
  document.getElementById("btn-ad-setup-export")?.addEventListener("click", () => {
    const r = exportAutodriveSetup();
    if (!r.ok) setStatusMsg(`Export fehlgeschlagen: ${r.error}`, true);
    else setStatusMsg("Setup exportiert (JSON).", false);
  });
  document.getElementById("btn-ad-setup-import")?.addEventListener("click", () => {
    document.getElementById("input-ad-setup-import")?.click();
  });
  document.getElementById("input-ad-setup-import")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const r = await importAutodriveSetup(file);
      if (r.ok) {
        setStatusMsg("Setup importiert — Wizard aktualisiert.", false);
        // Rebuild wizard UI from the imported config.
        const cfg = loadAutodriveConfig();
        const sel = document.getElementById("autodrive-template");
        if (sel) sel.value = cfg.templateId || "classic";
        buildTemplateGrid(cfg.templateId || "classic");
        applySetupPreset(cfg.setupPresetId || "");
        paintDashboard(getAutodriveState());
      } else {
        setStatusMsg(r.error || "Import fehlgeschlagen", true);
      }
    }
    e.target.value = "";
  });

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
