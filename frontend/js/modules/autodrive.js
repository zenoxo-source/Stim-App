// autodrive.js — Autodrive façade: lifecycle, claim, wave-loop integration.

import { AppState, DOM, log, CONSTANTS } from "../state.js";
import {
  createInitialState,
  reduceAutodrive,
  computeAutodriveOutput,
  sanitiseAutodriveConfig,
  getPhaseLabel,
  estimateWireFreqEnvelope,
} from "../lib/autodrive-engine.js";
import { claimOutput, releaseOutput, registerOwnerStop, getOutputOwner } from "./output-owner.js";
import {
  blockDuringPanicCooldown,
  clampStrengthWithCeiling,
  setPatternCeiling,
  clearPatternCeiling,
} from "./safety-extras.js";
import { blockIfLocked as blockIfPinLocked } from "./session-pin.js";
import { sendSoftStop, sendStrengthCommand, sendWaveformCommand } from "./bluetooth.js";
import { trackStat } from "./stats.js";
import { startAutoRecording, stopAutoRecording } from "./recorder.js";
import { isFlagEnabled } from "./feature-flags.js";

export {
  AUTODRIVE_TEMPLATES,
  AUTODRIVE_CONFIG_DEFAULTS,
  PLACEMENT_PROFILES,
  ESTIM_SAFETY_RULES,
  listPlacementProfiles,
  getPlacementProfile,
  estimateWireFreqEnvelope,
  estimatePhaseWireFreqBand,
  sanitiseAutodriveConfig,
  computeAutodriveOutput,
  getPhaseLabel,
  CLIMAX_WAVES,
} from "../lib/autodrive-engine.js";

export {
  listSetupPresets,
  getSetupPreset,
  derivePlacementFromSetup,
  buildWiringChecklist,
} from "../lib/estim-setup.js";

const CONFIG_KEY = "stim_app_autodrive_v1";
const SEEN_KEY = "stim_app_autodrive_seen";
const LEARN_KEY = "stim_app_autodrive_learn_v1";
const LAST_SUCCESS_KEY = "stim_app_autodrive_last_success_v1";
const LAST_SESSION_KEY = "stim_app_autodrive_last_session_v1";
const SESSION_HISTORY_KEY = "stim_app_autodrive_history_v1";
/** Keep the last N finished sessions for the dashboard history list. */
const SESSION_HISTORY_MAX = 10;
const TICK_MS = CONSTANTS.WAVE_LOOP_INTERVAL_MS || 100;

/** @type {object|null} */
let engineState = null;
/** @type {ReturnType<typeof setInterval>|null} */
let tickHandle = null;
/** @type {boolean} */
let silenced = false;
/** @type {((snap: object) => void)|null} */
let uiListener = null;
/** @type {string|null} */
let lastLoggedPhase = null;
/** @type {WakeLockSentinel|null} */
let wakeLock = null;

registerOwnerStop("autodrive", () => {
  stopAutodrive("owner-claim");
});

try {
  window.addEventListener("stim:kill-all", () => {
    stopAutodrive("panic");
  });
} catch {
  /* tests */
}

/**
 * @returns {object}
 */
export function loadAutodriveConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return sanitiseAutodriveConfig({});
    return sanitiseAutodriveConfig(JSON.parse(raw));
  } catch {
    return sanitiseAutodriveConfig({});
  }
}

/**
 * @param {object} patch
 */
export function saveAutodriveConfig(patch = {}) {
  const merged = sanitiseAutodriveConfig({ ...loadAutodriveConfig(), ...patch });
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

// ---------------------------------------------------------------------------
// F20: share codes — compact base64url of the current setup for copy/paste.
// ---------------------------------------------------------------------------

/** Encode the current (or given) setup as a compact share code. */
export function encodeAutodriveShareCode(cfg) {
  const c = sanitiseAutodriveConfig(cfg || loadAutodriveConfig());
  const json = JSON.stringify({
    t: c.templateId,
    p: c.placement,
    s: c.sensitivity,
    f: c.channelFocus,
    d: c.targetDurationMin,
    e: c.edgeCount,
    g: c.aggression,
    m: c.maxSessionIntensityFactor,
    x: c.allowClimaxPatterns ? 1 : 0,
    a: c.balanceB,
    h: c.hrAdaptive ? 1 : 0,
  });
  let bin = "";
  for (const ch of json) bin += String.fromCharCode(ch.charCodeAt(0));
  return "stim1:" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a share code back into a sanitised config (or null). */
export function decodeAutodriveShareCode(code) {
  try {
    const raw = String(code || "").trim();
    if (!raw.startsWith("stim1:")) return null;
    const b64 = raw.slice(6).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    let json = "";
    for (let i = 0; i < bin.length; i++) json += String.fromCharCode(bin.charCodeAt(i));
    const d = JSON.parse(json);
    const cfg = sanitiseAutodriveConfig({
      templateId: d.t,
      placement: d.p,
      sensitivity: d.s,
      channelFocus: d.f,
      targetDurationMin: d.d,
      edgeCount: d.e,
      aggression: d.g,
      maxSessionIntensityFactor: d.m,
      allowClimaxPatterns: !!d.x,
      balanceB: d.a,
      hrAdaptive: !!d.h,
    });
    return cfg;
  } catch {
    return null;
  }
}

function loadLearning() {
  try {
    const raw = localStorage.getItem(LEARN_KEY);
    if (!raw) {
      return {
        preferredBias: 0,
        sessions: 0,
        climaxRate: 0,
        lastPeakRel: 0,
        preferredPlacement: null,
        preferredPatternFamily: null,
      };
    }
    return JSON.parse(raw);
  } catch {
    return {
      preferredBias: 0,
      sessions: 0,
      climaxRate: 0,
      lastPeakRel: 0,
      preferredPlacement: null,
      preferredPatternFamily: null,
    };
  }
}

function saveLearning(patch) {
  try {
    const next = { ...loadLearning(), ...patch };
    localStorage.setItem(LEARN_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadLearning();
  }
}

// ---------------------------------------------------------------------------
// F11: Climax-Learning 2.0 — per-template stats + auto-tuning.
// ---------------------------------------------------------------------------

/** Merge one finished session into the per-template learning record. */
export function updatePerTemplateLearning(perTemplate, templateId, snap) {
  const tpl = {
    sessions: 0,
    climaxes: 0,
    cyclesSum: 0,
    cyclesN: 0,
    timeToClimaxSum: 0,
    timeToClimaxN: 0,
    ...((perTemplate && perTemplate[templateId]) || {}),
  };
  tpl.sessions += 1;
  if (snap.marked) {
    tpl.climaxes += 1;
    if (typeof snap.durationMs === "number" && snap.durationMs > 0) {
      tpl.timeToClimaxSum += snap.durationMs;
      tpl.timeToClimaxN += 1;
    }
  }
  const cycles = snap.holdCycleIdx || 0;
  if (cycles > 0) {
    tpl.cyclesSum += cycles;
    tpl.cyclesN += 1;
  }
  return { ...(perTemplate || {}), [templateId]: tpl };
}

/** @returns {{sessions: number, avgCycles: number, avgTimeToClimaxMs: number}|null} */
export function getTemplateLearning(templateId) {
  try {
    const tpl = loadLearning().perTemplate?.[templateId];
    if (!tpl || !tpl.sessions) return null;
    return {
      sessions: tpl.sessions,
      avgCycles: tpl.cyclesN ? Math.round(tpl.cyclesSum / tpl.cyclesN) : 0,
      avgTimeToClimaxMs: tpl.timeToClimaxN ? tpl.timeToClimaxSum / tpl.timeToClimaxN : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Auto-tune a config from per-template learning: after ≥3 sessions, reuse the
 * average edging-cycle count for the next run (bounded 1–4).
 */
function autoTuneFromLearning(cfg) {
  const tpl = getTemplateLearning(cfg.templateId || "custom");
  if (!tpl || tpl.sessions < 3 || !cfg.edgeLoops) return cfg;
  const cycles = Math.max(1, Math.min(4, tpl.avgCycles));
  return { ...cfg, edgeCycleTarget: cycles };
}

export function isAutodriveActive() {
  return !!(engineState && engineState.phase && engineState.phase !== "IDLE");
}

export function getAutodriveState() {
  if (!engineState) {
    const config = loadAutodriveConfig();
    return {
      phase: "IDLE",
      phaseLabel: getPhaseLabel("IDLE"),
      progress: 0,
      phaseProgress: 0,
      silenced: true,
      edgeCountDone: 0,
      edgeCountTarget: 0,
      userMarkedClimax: false,
      relStrength: 0,
      remainingMs: 0,
      phaseRemainingMs: 0,
      tip: "Setup wählen und Start drücken",
      patternHint: null,
      wireFreq: 0,
      wireFreqEnvelope: estimateWireFreqEnvelope(config),
      config,
      learning: loadLearning(),
    };
  }
  const out = computeAutodriveOutput(engineState, Date.now());
  return {
    ...out,
    config: engineState.config,
    edgeCountDone: engineState.edgeCountDone,
    edgeCountTarget: engineState.edgeCountTarget,
    userMarkedClimax: engineState.userMarkedClimax,
    resumePhase: engineState.resumePhase,
    phase: engineState.phase,
    phaseLabel: out.phaseLabel || getPhaseLabel(engineState.phase),
    learning: loadLearning(),
    comfortFloor: engineState.comfortFloor,
    comfortCeiling: engineState.comfortCeiling,
    climbRate: engineState.climbRate,
  };
}

export function clearAutodriveAppliedMarkers() {
  AppState._autodriveLastAppliedA = null;
  AppState._autodriveLastAppliedB = null;
}

/**
 * @param {object} [patch]
 * @returns {{ ok: boolean, error?: string }}
 */
export function startAutodrive(patch = {}) {
  if (!isFlagEnabled("autodrive")) {
    return { ok: false, error: "Autodrive ist deaktiviert." };
  }
  if (!AppState.isConnected) {
    return { ok: false, error: "Nicht verbunden — zuerst Bluetooth." };
  }
  if (blockDuringPanicCooldown("Autodrive-Start")) {
    return { ok: false, error: "Panic-Cooldown aktiv." };
  }
  if (blockIfPinLocked("Autodrive-Start")) {
    return { ok: false, error: "Session-PIN gesperrt." };
  }
  if (isAutodriveActive()) {
    return { ok: false, error: "Autodrive läuft bereits." };
  }

  const firstRun = !localStorage.getItem(SEEN_KEY);
  let cfg = sanitiseAutodriveConfig({ ...loadAutodriveConfig(), ...patch });
  // F11: auto-tune from per-template learning (edge cycles etc.).
  cfg = autoTuneFromLearning(cfg);
  if (firstRun) {
    cfg = { ...cfg, skipCalibration: false };
  }

  if ((AppState.softLimitA || 0) < 20 || (AppState.softLimitB || 0) < 20) {
    return { ok: false, error: "Soft-Limits zu niedrig (min. 20)." };
  }

  const claim = claimOutput("autodrive");
  if (!claim.ok) {
    return { ok: false, error: claim.error || "Claim fehlgeschlagen." };
  }

  const now = Date.now();
  const learn = loadLearning();
  engineState = createInitialState(cfg, now, learn);
  engineState.softA = AppState.softLimitA;
  engineState.softB = AppState.softLimitB;
  // F19: fresh replay timeline per session.
  timeline = [];
  timelineStart = now;

  const factor = cfg.maxSessionIntensityFactor ?? 0.95;
  const ceil = Math.max(
    Math.round(AppState.softLimitA * factor),
    Math.round(AppState.softLimitB * factor)
  );
  if (ceil > 0) setPatternCeiling(ceil);

  AppState.activePattern = "autodrive";
  silenced = false;
  lastLoggedPhase = engineState.phase;
  clearAutodriveAppliedMarkers();

  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(engineTick, TICK_MS);

  try {
    localStorage.setItem(SEEN_KEY, "1");
    trackStat("autodrive_starts");
    trackStat(`autodrive_tpl_${cfg.templateId || "custom"}`);
  } catch {
    /* ignore */
  }

  log(
    `Autodrive gestartet: ${cfg.templateId || "custom"} · ${cfg.targetDurationMin} Min · Ziel ${cfg.goal}`,
    "success"
  );
  // F11: log learned per-template tuning when it changed the run.
  try {
    const tpl = getTemplateLearning(cfg.templateId || "custom");
    if (tpl && tpl.sessions >= 3 && cfg.edgeLoops) {
      log(
        `Learning (${cfg.templateId}): ${tpl.sessions} Sessions · Ø ${tpl.avgCycles} Loop-Zyklen · Ø bis Climax ${Math.round(
          (tpl.avgTimeToClimaxMs || 0) / 60000
        )} Min`,
        "info"
      );
    }
  } catch {
    /* optional */
  }
  try {
    startAutoRecording("autodrive");
  } catch {
    /* optional */
  }
  requestWakeLock();
  notifyUi();
  return { ok: true };
}

async function requestWakeLock() {
  try {
    if (typeof navigator !== "undefined" && navigator.wakeLock?.request) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener?.("release", () => {
        wakeLock = null;
      });
    }
  } catch {
    /* unsupported / denied */
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release?.();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

/** Optional short vibration for prompts / phase changes (if supported). */
export function hapticPulse(pattern = [40, 30, 40]) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

export function pauseAutodrive() {
  if (!isAutodriveActive() || engineState.phase === "PAUSED") return;
  engineState = reduceAutodrive(engineState, {
    type: "PAUSE",
    nowMs: Date.now(),
    strengthA: AppState.strengthA,
    strengthB: AppState.strengthB,
  });
  silenced = true;
  try {
    sendSoftStop({ keepStrength: true, writer: "safety" });
  } catch {
    /* ignore */
  }
  log("Autodrive pausiert.", "info");
  notifyUi();
}

export function resumeAutodrive() {
  if (!engineState || engineState.phase !== "PAUSED") return;
  engineState = reduceAutodrive(engineState, { type: "RESUME", nowMs: Date.now() });
  silenced = false;
  AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
  clearAutodriveAppliedMarkers();
  log("Autodrive fortgesetzt.", "info");
  notifyUi();
}

/**
 * @param {string} [reason]
 */
export function stopAutodrive(reason = "manuell") {
  if (!engineState && !tickHandle) return;
  const wasActive = isAutodriveActive();
  const snap = engineState
    ? {
        marked: !!engineState.userMarkedClimax,
        bias: engineState.feedbackBias,
        phase: engineState.phase,
        peakRel: engineState.peakRel,
        placement: engineState.config?.placement,
        lastPattern: engineState.lastPatternId,
        config: { ...engineState.config },
        tooWeak: engineState.sessionTooWeakCount || 0,
        tooStrong: engineState.sessionTooStrongCount || 0,
        almost: engineState.sessionAlmostCount || 0,
        good: engineState.sessionGoodCount || 0,
        edges: engineState.edgeCountDone || 0,
        durationMs: engineState.effectiveElapsedMs || 0,
        holdCycleIdx: engineState.holdCycleIdx || 0,
        pushRetriesUsed: engineState.pushRetriesUsed || 0,
        // v6.2: silent-commit + auto-climax observability
        commitUsed: engineState.commitMode || false,
        autoClimaxMarked: engineState.autoClimaxMarked || false,
        reason,
      }
    : null;

  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  if (engineState) {
    engineState = reduceAutodrive(engineState, { type: "STOP", nowMs: Date.now() });
  }
  engineState = null;
  silenced = false;
  lastLoggedPhase = null;
  clearAutodriveAppliedMarkers();

  if (AppState.activePattern === "autodrive") {
    AppState.activePattern = null;
  }
  try {
    clearPatternCeiling();
  } catch {
    /* ignore */
  }
  if (getOutputOwner() === "autodrive") {
    releaseOutput("autodrive");
  }

  if (reason !== "panic" && reason !== "owner-claim") {
    try {
      // Zero device + UI so idle wave-loop cannot re-arm high residual strength
      // on the next absolute B0 (master/slider/reconnect).
      sendSoftStop({ keepStrength: false, zeroUiStrength: true, writer: "safety" });
      AppState.strengthA = 0;
      AppState.strengthB = 0;
      if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = "0";
      if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = "0";
      if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = "0";
      if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = "0";
      if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = "0";
      if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = "0";
    } catch {
      /* ignore */
    }
  }

  releaseWakeLock();

  // F5: stop auto-recording when the session ends.
  try {
    stopAutoRecording(reason);
  } catch {
    /* optional */
  }

  if (wasActive && snap) {
    log(`Autodrive gestoppt (${reason}).`, "info");
    try {
      trackStat("autodrive_stops");
      if (snap.marked) trackStat("autodrive_success");
      if (snap.commitUsed) trackStat("autodrive_commit_used");
      if (snap.autoClimaxMarked) trackStat("autodrive_autoclimax");
      const learn = loadLearning();
      const sessions = (learn.sessions || 0) + 1;
      const climaxHits = (learn.climaxHits || 0) + (snap.marked ? 1 : 0);
      const preferredBias =
        typeof snap.bias === "number"
          ? clamp((learn.preferredBias || 0) * 0.7 + snap.bias * 0.3, -0.15, 0.2)
          : learn.preferredBias || 0;
      const lastPeakRel =
        typeof snap.peakRel === "number"
          ? clamp((learn.lastPeakRel || 0.5) * 0.6 + snap.peakRel * 0.4, 0.3, 0.95)
          : learn.lastPeakRel || 0;
      saveLearning({
        sessions,
        climaxHits,
        climaxRate: climaxHits / sessions,
        preferredBias,
        lastPeakRel,
        preferredPlacement: snap.marked
          ? snap.placement || learn.preferredPlacement
          : learn.preferredPlacement,
        preferredPatternFamily: snap.lastPattern || learn.preferredPatternFamily,
        lastPhase: snap.phase,
        lastTooWeak: snap.tooWeak,
        softLimitCoachPending:
          !snap.marked &&
          snap.tooWeak >= 3 &&
          (AppState.softLimitA || 0) < 120 &&
          (AppState.softLimitB || 0) < 120,
        // F11: per-template learning (edging cycles, time-to-climax).
        perTemplate: updatePerTemplateLearning(
          learn.perTemplate,
          snap.config?.templateId || "custom",
          snap
        ),
      });
      // Persist last session for debrief UI
      localStorage.setItem(
        LAST_SESSION_KEY,
        JSON.stringify({
          ...snap,
          endedAt: Date.now(),
          softLimitA: AppState.softLimitA,
          softLimitB: AppState.softLimitB,
        })
      );
      // F4: session history ring buffer (dashboard list + 1-click restart).
      try {
        const entry = {
          endedAt: Date.now(),
          durationMs: snap.durationMs || 0,
          phase: snap.phase || "",
          marked: !!snap.marked,
          edges: snap.edges || 0,
          pushRetriesUsed: snap.pushRetriesUsed || 0,
          tooWeak: snap.tooWeak || 0,
          tooStrong: snap.tooStrong || 0,
          almost: snap.almost || 0,
          peakRel: snap.peakRel || 0,
          templateId: snap.config?.templateId || "",
          reason: snap.reason || "manuell",
          config: snap.config ? { ...snap.config } : null,
          // F19: replay chart data (kept when ≥ 2 samples).
          timeline: timeline.length >= 2 ? timeline.slice(-600) : undefined,
        };
        const history = loadSessionHistory();
        history.push(entry);
        if (history.length > SESSION_HISTORY_MAX) {
          history.splice(0, history.length - SESSION_HISTORY_MAX);
        }
        localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history));
      } catch {
        /* history optional */
      }
      timeline = [];
      timelineStart = 0;
      if (snap.marked && snap.config) {
        const c = snap.config;
        localStorage.setItem(
          LAST_SUCCESS_KEY,
          JSON.stringify({
            templateId: c.templateId,
            placement: c.placement,
            sensitivity: c.sensitivity,
            channelFocus: c.channelFocus,
            targetDurationMin: c.targetDurationMin,
            abRole: c.abRole,
            goal: c.goal,
            edgeCount: c.edgeCount,
            aggression: c.aggression,
            maxSessionIntensityFactor: c.maxSessionIntensityFactor,
            allowClimaxPatterns: c.allowClimaxPatterns,
            // Full ESTIM setup so "Letzte Erfolg" restores loops/wiring/sites
            electrodeKind: c.electrodeKind,
            wiringMode: c.wiringMode,
            siteA1: c.siteA1,
            siteA2: c.siteA2,
            siteB1: c.siteB1,
            siteB2: c.siteB2,
            balanceB: c.balanceB,
            setupPresetId: c.setupPresetId,
            savedAt: Date.now(),
          })
        );
      }
    } catch {
      /* ignore */
    }
  }
  notifyUi();
}

/** One-tap classic start (Home). Skips calib after successful prior sessions. */
export function startQuickClassic() {
  const learn = loadLearning();
  const seen = !!localStorage.getItem(SEEN_KEY);
  const skipCal = seen && ((learn.climaxHits || 0) >= 1 || (learn.sessions || 0) >= 2);
  return startAutodrive({
    templateId: "classic",
    skipCalibration: skipCal,
  });
}

/** Replay last successful session config. */
export function startLastSuccess() {
  try {
    const raw = localStorage.getItem(LAST_SUCCESS_KEY);
    if (!raw) return { ok: false, error: "Noch keine erfolgreiche Session gespeichert." };
    const cfg = JSON.parse(raw);
    return startAutodrive({ ...cfg, skipCalibration: true });
  } catch {
    return { ok: false, error: "Letzte Session ungültig." };
  }
}

export function hasLastSuccess() {
  try {
    return !!localStorage.getItem(LAST_SUCCESS_KEY);
  } catch {
    return false;
  }
}

/** Replay the LAST session (regardless of outcome) with its config. */
export function startLastSession() {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return { ok: false, error: "Noch keine Session gespeichert." };
    const snap = JSON.parse(raw);
    const cfg = snap.config || {};
    return startAutodrive({ ...cfg, skipCalibration: true });
  } catch {
    return { ok: false, error: "Letzte Session ungültig." };
  }
}

export function hasLastSession() {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    return !!snap.config;
  } catch {
    return false;
  }
}

/** @returns {Array<object>} finished sessions, oldest → newest. */
export function loadSessionHistory() {
  try {
    const raw = localStorage.getItem(SESSION_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Clear the session history (Settings/Stats reset path). */
export function clearSessionHistory() {
  try {
    localStorage.removeItem(SESSION_HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

export function getLastSessionSnapshot() {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Apply post-session debrief answers into learning.
 * @param {{ climax?: "yes"|"almost"|"no", overall?: "weak"|"ok"|"strong" }} answers
 */
export function applyDebrief(answers = {}) {
  const learn = loadLearning();
  const patch = { ...learn, lastDebriefAt: Date.now() };
  if (answers.climax === "yes") {
    patch.debriefYes = (learn.debriefYes || 0) + 1;
    // Not everyone reaches for the climax button mid-session. When the session
    // went unmarked, the debrief is the first time we hear about it — count it
    // here, or climaxRate under-reports every such session.
    // endedAt identifies the session, so re-submitting a debrief cannot
    // double-count.
    const last = getLastSessionSnapshot();
    const sessionId = last?.endedAt ?? null;
    const alreadyCounted =
      !last ||
      last.marked === true ||
      (sessionId !== null && learn.debriefCountedFor === sessionId);
    if (!alreadyCounted) {
      patch.climaxHits = (learn.climaxHits || 0) + 1;
      patch.debriefCountedFor = sessionId;
      if (learn.sessions > 0) {
        patch.climaxRate = patch.climaxHits / learn.sessions;
      }
    }
  } else if (answers.climax === "almost") {
    patch.debriefAlmost = (learn.debriefAlmost || 0) + 1;
    patch.preferredBias = clamp((learn.preferredBias || 0) + 0.03, -0.15, 0.2);
  } else if (answers.climax === "no") {
    patch.debriefNo = (learn.debriefNo || 0) + 1;
  }
  if (answers.overall === "weak") {
    patch.preferredBias = clamp((learn.preferredBias || 0) + 0.05, -0.15, 0.2);
    patch.softLimitCoachPending = true;
  } else if (answers.overall === "strong") {
    patch.preferredBias = clamp((learn.preferredBias || 0) - 0.04, -0.15, 0.2);
  }
  saveLearning(patch);
  try {
    trackStat("autodrive_debrief");
  } catch {
    /* ignore */
  }
  return patch;
}

export function getSoftLimitCoachMessage() {
  const learn = loadLearning();
  const cfg = loadAutodriveConfig();
  const place = cfg.placement || learn.preferredPlacement || "";
  const softA = AppState.softLimitA || 0;
  const softB = AppState.softLimitB || 0;
  const tips = [];

  // Placement / setup-aware soft-limit guidance (never auto-raises limits)
  const ratio =
    typeof cfg.balanceB === "number" && cfg.balanceB > 0
      ? Math.min(0.95, Math.max(0.7, cfg.balanceB / 100))
      : place === "loops_ab_glans_hot"
        ? 0.75
        : 0.85;
  if (
    (place === "loops_ab_glans_hot" || place === "loops_ab_penis") &&
    cfg.wiringMode !== "single_channel_2" &&
    softB > 0 &&
    softA > 0 &&
    softB > softA * (ratio + 0.08)
  ) {
    const suggestB = Math.max(10, Math.round(softA * ratio));
    tips.push(
      `Loops/Glans: Soft-Limit B oft etwas unter A — z. B. B≈${suggestB} bei A=${softA} (manuell in Einstellungen).`
    );
  }
  if (cfg.wiringMode === "single_channel_2") {
    const focus = cfg.channelFocus === "B" ? "B" : "A";
    const soft = focus === "B" ? softB : softA;
    if (soft > 0 && soft < 40) {
      tips.push(
        `1-Kanal (2 Loops): Soft-Limit ${focus} zählt — aktuell ${soft}, oft 60+ nach Kalibrierung sinnvoller.`
      );
    }
  }
  if (place === "insertable" && Math.min(softA, softB) > 100) {
    tips.push("Insertable: hohe Soft-Limits vorsichtig — Cap ist ohnehin strenger.");
  }
  if (learn.softLimitCoachPending && Math.min(softA, softB) < 120) {
    tips.push(
      "Oft „zu schwach“ bei niedrigen Soft-Limits. Limits etwas erhöhen? (nie automatisch)"
    );
  }
  if (!tips.length) return null;
  return {
    message: tips.join(" "),
    softA,
    softB,
    placement: place,
  };
}

/**
 * One-line trust string for live UI: phase · strengths · freq (max).
 * @param {object} st getAutodriveState()-like
 */
export function buildTrustLine(st) {
  const phase = st?.phaseLabel || st?.phase || "—";
  const a = AppState.strengthA ?? 0;
  const b = AppState.strengthB ?? 0;
  const f = st?.wireFreq;
  const env = st?.wireFreqEnvelope || estimateWireFreqEnvelope(st?.config || loadAutodriveConfig());
  const maxF = env?.hi;
  const parts = [phase, `A ${a} · B ${b}`];
  if (f != null && f > 0) {
    parts.push(maxF != null ? `Freq ${f} (max ${maxF})` : `Freq ${f}`);
  } else if (maxF != null) {
    parts.push(`Freq max ${maxF}`);
  }
  return parts.join(" · ");
}

/** @type {ReturnType<typeof setTimeout>|null} */
let probeTimer = null;

// F19: per-session replay timeline (1 sample per 2 s, ring-capped).
let timeline = [];
let timelineStart = 0;

/**
 * Short A or B probe pulse for first-run / contact check.
 * @param {"A"|"B"} channel
 * @param {{ strength?: number, ms?: number, freq?: number }} [opts]
 * @returns {{ ok: boolean, error?: string }}
 */
export function probeChannel(channel, opts = {}) {
  if (!AppState.isConnected || !AppState.writeChar) {
    return { ok: false, error: "Nicht verbunden" };
  }
  if (isAutodriveActive()) {
    return { ok: false, error: "Während Autodrive nicht — zuerst stoppen" };
  }
  const ch = String(channel || "A").toUpperCase() === "B" ? "B" : "A";
  const soft = ch === "B" ? AppState.softLimitB || 40 : AppState.softLimitA || 40;
  const level = Math.min(
    soft,
    Math.max(8, Math.round(Number(opts.strength) || Math.min(25, Math.round(soft * 0.22))))
  );
  const ms = Math.min(2500, Math.max(400, Number(opts.ms) || 900));
  const freq = Math.min(240, Math.max(10, Number(opts.freq) || 45));

  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }

  const strA = ch === "A" ? level : 0;
  const strB = ch === "B" ? level : 0;
  AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
  sendStrengthCommand(strA, strB, { writer: "manual" });
  sendWaveformCommand(freq, ch === "A" ? 70 : 0, freq, ch === "B" ? 70 : 0, {
    writer: "wave-loop",
    force: true,
  });
  log(`Probe ${ch}: Strength ${level} · ${ms}ms · f${freq}`, "info");

  probeTimer = setTimeout(() => {
    probeTimer = null;
    try {
      sendSoftStop({ keepStrength: false, zeroUiStrength: true, writer: "safety" });
      AppState.strengthA = 0;
      AppState.strengthB = 0;
    } catch {
      /* ignore */
    }
  }, ms);

  return { ok: true, channel: ch, level, ms };
}

/** @returns {boolean} true if first-run checklist should show */
export function needsAutodriveOnboarding() {
  try {
    return !localStorage.getItem(SEEN_KEY);
  } catch {
    return true;
  }
}

export function markAutodriveOnboardingSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearSoftLimitCoach() {
  saveLearning({ softLimitCoachPending: false });
}

export function getAutodriveStatsSummary() {
  const learn = loadLearning();
  const sessions = learn.sessions || 0;
  const climaxHits = learn.climaxHits || 0;
  return {
    sessions,
    climaxHits,
    climaxRate: sessions > 0 ? climaxHits / sessions : 0,
    preferredBias: learn.preferredBias || 0,
    lastPeakRel: learn.lastPeakRel || 0,
    hasLastSuccess: hasLastSuccess(),
  };
}

// ---------------------------------------------------------------------------
// F4: Autodrive setup export / import (share + restore wizard state).
// ---------------------------------------------------------------------------

/** Download the current Autodrive wizard config as JSON. */
export function exportAutodriveSetup() {
  const payload = {
    app: "StimApp",
    type: "autodrive-setup",
    version: 1,
    config: loadAutodriveConfig(),
    exportedAt: new Date().toISOString(),
  };
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autodrive-setup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Import + validate an Autodrive setup JSON file. */
export async function importAutodriveSetup(file) {
  try {
    if (file && file.size > 512 * 1024) {
      return { ok: false, error: "Datei zu groß (max 512 KB)." };
    }
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.type !== "autodrive-setup" || !data.config) {
      return { ok: false, error: "Keine gültige Autodrive-Setup-Datei." };
    }
    const cfg = sanitiseAutodriveConfig({ ...loadAutodriveConfig(), ...data.config });
    saveAutodriveConfig(cfg);
    return { ok: true, config: cfg };
  } catch (err) {
    return { ok: false, error: `Import fehlgeschlagen: ${err.message}` };
  }
}

/**
 * @param {string} feedback
 */
export function injectFeedback(feedback) {
  if (!isAutodriveActive() || engineState.phase === "PAUSED") return;
  const before = engineState.phase;
  engineState = reduceAutodrive(engineState, {
    type: "FEEDBACK",
    feedback,
    nowMs: Date.now(),
    softA: AppState.softLimitA,
    softB: AppState.softLimitB,
  });
  try {
    trackStat(`autodrive_fb_${feedback}`);
    if (feedback === "climaxed") trackStat("autodrive_climax_marked");
  } catch {
    /* ignore */
  }
  if (engineState.phase === "IDLE") {
    stopAutodrive("session-end");
    return;
  }
  if (engineState.phase !== before) {
    log(`Autodrive: ${getPhaseLabel(before)} → ${getPhaseLabel(engineState.phase)}`, "info");
    lastLoggedPhase = engineState.phase;
  }
  // F1: celebration overlay when the user marks the climax.
  if (feedback === "climaxed") {
    try {
      window.dispatchEvent(new CustomEvent("stim:autodrive-climax"));
    } catch {
      /* optional */
    }
  }
  notifyUi();
}

/**
 * v6.2: Feed a biofeedback sample (HR delta over baseline) into the engine.
 * Does NOT mutate strength directly — the engine uses it for the silent-commit
 * + opt-in auto-climax heuristics (see autodrive-engine.js BIO_FEEDBACK).
 * Called by heart-rate.js / breath-sensor.js when hrAdaptive is on.
 * @param {number} hrDelta bpm over baseline (positive = arousal)
 */
export function injectBioFeedback(hrDelta) {
  if (!isAutodriveActive() || engineState.phase === "PAUSED") return;
  if (typeof hrDelta !== "number" || !Number.isFinite(hrDelta)) return;
  engineState = reduceAutodrive(engineState, {
    type: "BIO_FEEDBACK",
    hrDelta,
    nowMs: Date.now(),
    softA: AppState.softLimitA,
    softB: AppState.softLimitB,
  });
  // Auto-climax path may have ended the push → enter aftercare UI flow.
  if (engineState.phase === "IDLE") {
    stopAutodrive("session-end");
    return;
  }
  notifyUi();
}

// F16: HR biofeedback may end the refractory rest early (HR settled).
export function endRefractoryEarly() {
  if (!engineState || engineState.phase !== "COOLDOWN") return false;
  const before = engineState.phase;
  engineState = reduceAutodrive(engineState, {
    type: "REFRACTORY_DONE",
    nowMs: Date.now(),
    softA: AppState.softLimitA,
    softB: AppState.softLimitB,
  });
  if (engineState.phase !== before) {
    log(
      `HR-Refraktär beendet → ${getPhaseLabel(engineState.phase)} (Versuch ${engineState.climaxCount || 1}/${engineState.config.climaxTarget || 1}).`,
      "info"
    );
  }
  notifyUi();
  return engineState.phase === "BUILD";
}

function engineTick() {
  if (!engineState || engineState.phase === "IDLE") {
    stopAutodrive("idle");
    return;
  }
  if (!AppState.isConnected) {
    stopAutodrive("disconnect");
    return;
  }
  if (engineState.phase === "PAUSED") {
    notifyUi();
    return;
  }

  const now = Date.now();
  const before = engineState.phase;
  engineState = reduceAutodrive(engineState, {
    type: "TICK",
    nowMs: now,
    softA: AppState.softLimitA,
    softB: AppState.softLimitB,
  });

  if (engineState.phase === "IDLE") {
    stopAutodrive("complete");
    return;
  }
  if (engineState.phase !== before && engineState.phase !== lastLoggedPhase) {
    log(`Autodrive Phase: ${getPhaseLabel(engineState.phase)}`, "info");
    lastLoggedPhase = engineState.phase;
    // v6.1: an unmarked CLIMAX_PUSH that re-armed into TEASE counts as a
    // push-retry — observable proxy for the „Abspritzgarantie“ heuristics.
    if (
      before === "CLIMAX_PUSH" &&
      engineState.phase === "TEASE" &&
      (engineState.pushRetriesUsed || 0) > 0
    ) {
      try {
        trackStat("autodrive_push_retry");
      } catch {
        /* optional */
      }
    }
    if (engineState.phase === "CLIMAX_PUSH" || engineState.phase === "EDGE_HOLD") {
      hapticPulse([50, 40, 80]);
    } else if (engineState.phase === "SURGE") {
      hapticPulse([30, 20, 30]);
    }
    // Notify UI listeners about phase change (fullscreen auto-open etc.)
    try {
      window.dispatchEvent(
        new CustomEvent("stim:autodrive-phase", {
          detail: { phase: engineState.phase, before },
        })
      );
    } catch {
      /* ignore */
    }
  }
  if (engineState.pendingPrompt && engineState.lastPromptAt === now) {
    hapticPulse([25, 40, 25]);
  }

  // F19: record replay timeline (~1 sample / 2 s).
  if (!timelineStart) timelineStart = now;
  const tSec = (now - timelineStart) / 1000;
  const lastT = timeline[timeline.length - 1];
  if (!lastT || tSec - lastT.t >= 2) {
    timeline.push({
      t: Math.round(tSec),
      rel: Math.round((engineState.relStrength || 0) * 100),
      phase: engineState.phase,
    });
    if (timeline.length > 1200) timeline.splice(0, timeline.length - 1200);
  }

  notifyUi();
}

/**
 * @param {(fA:number,aA:number,fB:number,aB:number,opts?:object) => Promise<void>|void} sendWave
 * @param {(patternId: string, loopCounter: number) => {fA:number,aA:number,fB:number,aB:number}} computePattern
 */
export async function applyAutodriveWaveTick(sendWave, computePattern) {
  if (!engineState || engineState.phase === "IDLE") return false;
  // Pause: soft-stop already issued; keep wire strength, do not thrash B0.
  if (engineState.phase === "PAUSED" || silenced) {
    return true;
  }

  const now = Date.now();
  const out = computeAutodriveOutput(engineState, now);

  // Always sync logical strength (incl. COOLDOWN → 0). Early-return on
  // out.silenced used to skip this, leaving AppState/UI high while phase was quiet.
  const nextA = clampStrengthWithCeiling(out.strengthA, "A");
  const nextB = clampStrengthWithCeiling(out.strengthB, "B");

  const strengthDirty =
    nextA !== AppState.strengthA ||
    nextB !== AppState.strengthB ||
    nextA !== AppState._autodriveLastAppliedA ||
    nextB !== AppState._autodriveLastAppliedB;

  AppState.strengthA = nextA;
  AppState.strengthB = nextB;

  if (strengthDirty) {
    AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
    AppState._autodriveLastAppliedA = nextA;
    AppState._autodriveLastAppliedB = nextB;
  }
  if (AppState.btAwaitingAck && strengthDirty) {
    AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
  }

  if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = String(nextA);
  if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = String(nextA);
  if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = String(nextA);
  if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = String(nextB);
  if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = String(nextB);
  if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = String(nextB);

  // COOLDOWN / soft-reset / no pattern: absolute strength (may be 0) + inactive wave
  if (out.silenced || out.waveSilenced || !out.patternId) {
    AppState.lastWaveAmpA = 0;
    AppState.lastWaveAmpB = 0;
    await sendWave(0, 0, 0, 0, { writer: "wave-loop" });
    return true;
  }

  let fA = AppState.frequencyA;
  let aA = 70;
  let fB = AppState.frequencyB;
  let aB = 70;
  if (out.patternId && typeof computePattern === "function") {
    const w = computePattern(out.patternId, AppState.loopTimeCounter);
    fA = w.fA;
    aA = w.aA;
    fB = w.fB;
    aB = w.aB;
    engineState.lastPatternId = out.patternId;
  }

  // Sensation plane: wire freq from engine (lerp already in reduce)
  const wireF = Math.round(out.wireFreq || 45);
  if (wireF >= 10) {
    fA = wireF;
    fB = wireF;
  }
  if (out.patternParams?.freqBias) {
    fA = Math.max(10, Math.min(240, fA + out.patternParams.freqBias));
    fB = Math.max(10, Math.min(240, fB + out.patternParams.freqBias));
  }

  const scale = out.patternParams?.ampScale ?? 1;
  const dutyGate = out.patternParams?.dutyGate;
  const gate = dutyGate === 0 ? 0 : 1;
  aA = Math.round(Math.min(100, Math.max(0, aA * scale * gate)));
  aB = Math.round(Math.min(100, Math.max(0, aB * scale * gate)));

  // Channel mode + A/B roles (skip dual modulation for true single-channel wiring)
  const wiring = engineState?.config?.wiringMode || "";
  const singleCh = wiring === "single_channel_2";
  const focusCh = engineState?.config?.channelFocus || "A";
  if (singleCh) {
    if (focusCh === "B") {
      aA = 0;
      fA = fB;
    } else {
      aB = 0;
      fB = fA;
    }
  } else {
    const mode = out.patternParams?.channelMode || out.channelMode || "both";
    const abRole = out.abRole || engineState?.config?.abRole || "sync";
    if (abRole === "aRhythm_bSteady") {
      aB = Math.round(Math.max(aB * 0.55, aB * 0.4 + 20));
    } else if (abRole === "aSteady_bRhythm") {
      aA = Math.round(Math.max(aA * 0.55, aA * 0.4 + 20));
    } else if (mode === "alt") {
      const flip = (AppState.loopTimeCounter || 0) % 8 < 4;
      if (flip) aB = Math.round(aB * 0.15);
      else aA = Math.round(aA * 0.15);
    } else if (mode === "aLead") {
      aB = Math.round(aB * 0.35);
    } else if (mode === "bLead") {
      aA = Math.round(aA * 0.35);
    }
  }

  AppState.lastWaveFreqA = fA;
  AppState.lastWaveAmpA = aA;
  AppState.lastWaveFreqB = fB;
  AppState.lastWaveAmpB = aB;

  await sendWave(fA, aA, fB, aB, { writer: "wave-loop" });
  return true;
}

/**
 * @param {(snap: object) => void} fn
 */
export function onAutodriveUi(fn) {
  uiListener = typeof fn === "function" ? fn : null;
}

function notifyUi() {
  const st = getAutodriveState();
  if (typeof uiListener === "function") {
    try {
      uiListener(st);
    } catch {
      /* ignore */
    }
  }
  // Lightweight DOM fallbacks (UI module does richer paint)
  setText("autodrive-phase", st.phaseLabel || st.phase || "IDLE");
  setText("autodrive-phase-raw", st.phase || "IDLE");
  setWidth("autodrive-progress", Math.round((st.progress || 0) * 100));
  setWidth("autodrive-phase-progress", Math.round((st.phaseProgress || 0) * 100));
  setText("autodrive-edges", `${st.edgeCountDone || 0} / ${st.edgeCountTarget || 0}`);
  setText("autodrive-rel", `${Math.round((st.relStrength || 0) * 100)}%`);
  setText("autodrive-pattern", st.patternHint || "—");
  setText("autodrive-tip", st.tip || "");
  setText("autodrive-eta", formatMs(st.remainingMs));
  setText("autodrive-phase-eta", formatMs(st.phaseRemainingMs));
  setWidth("autodrive-meter-a", intensityPct(AppState.strengthA, AppState.softLimitA));
  setWidth("autodrive-meter-b", intensityPct(AppState.strengthB, AppState.softLimitB));
  setText("autodrive-str-a", String(AppState.strengthA || 0));
  setText("autodrive-str-b", String(AppState.strengthB || 0));
  setText("autodrive-edge-score", String(Math.round(st.edgeScore || 0)));
  setWidth("autodrive-edge-bar", st.edgeScore || 0);
  setText("autodrive-freq", String(st.wireFreq || "—"));
  {
    const env = st.wireFreqEnvelope || estimateWireFreqEnvelope(st.config);
    const maxEl = document.getElementById("autodrive-freq-max");
    if (maxEl && env) maxEl.innerHTML = `· max <strong>${env.hi}</strong>`;
    paintFreqMeter(st.wireFreq, env);
  }
  setText("autodrive-duty", st.dutyCycle != null ? `${Math.round(st.dutyCycle * 100)}%` : "—");
  setText(
    "autodrive-baseline",
    st.sessionBaseline != null ? `${Math.round(st.sessionBaseline * 100)}%` : "—"
  );
  setText("autodrive-next-step", st.nextStepHint || "");
  setText("autodrive-hold-eta", st.holdRemainingMs > 0 ? formatMs(st.holdRemainingMs) : "—");
  const promptEl = document.getElementById("autodrive-prompt");
  if (promptEl) {
    if (st.pendingPrompt) {
      promptEl.style.display = "block";
      promptEl.textContent = st.pendingPrompt;
    } else {
      promptEl.style.display = "none";
    }
  }
  setText("ad-fs-phase", st.phaseLabel || st.phase || "—");
  setText("ad-fs-tip", st.pendingPrompt || st.tip || "");
  setText("ad-fs-next", st.nextStepHint || "");
  setText("ad-fs-edges", `${st.edgeCountDone || 0}/${st.edgeCountTarget || 0}`);
  setText("autodrive-trust", buildTrustLine(st));
  setText("ad-fs-hold", st.holdRemainingMs > 0 ? formatMs(st.holdRemainingMs) : "");
  setWidth("ad-fs-progress", Math.round((st.progress || 0) * 100));
  setWidth("ad-fs-rel", Math.round((st.relStrength || 0) * 100));
  setWidth("ad-fs-edge", st.edgeScore || 0);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Slim 10–240 wire-freq band meter (session envelope + current marker). */
function paintFreqMeter(nowWire, env) {
  if (!env) return;
  const span = Math.max(1, env.hi - env.lo);
  const fill = document.getElementById("autodrive-freq-meter-fill");
  if (fill) {
    // Full track represents protocol 10–240; fill shows session lo–hi window
    const left = ((env.lo - 10) / 230) * 100;
    const width = (span / 230) * 100;
    fill.style.left = `${Math.max(0, left)}%`;
    fill.style.width = `${Math.min(100 - left, width)}%`;
  }
  const nowEl = document.getElementById("autodrive-freq-meter-now");
  if (nowEl) {
    const w = Number(nowWire);
    if (Number.isFinite(w) && w > 0) {
      nowEl.style.display = "block";
      nowEl.style.left = `${Math.max(0, Math.min(100, ((w - 10) / 230) * 100))}%`;
    } else {
      nowEl.style.display = "none";
    }
  }
  const lab = document.getElementById("autodrive-freq-band-label");
  if (lab) lab.textContent = `${env.lo}–${env.hi} · max ${env.hi}`;
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function intensityPct(val, soft) {
  const cap = soft > 0 ? soft : 200;
  return Math.round(((val || 0) / cap) * 100);
}

function formatMs(ms) {
  if (!ms || ms < 0) return "0:00";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
