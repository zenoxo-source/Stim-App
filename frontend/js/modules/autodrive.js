// autodrive.js — Autodrive façade: lifecycle, claim, wave-loop integration.

import { AppState, DOM, log, CONSTANTS } from "../state.js";
import {
  createInitialState,
  reduceAutodrive,
  computeAutodriveOutput,
  sanitiseAutodriveConfig,
  getPhaseLabel,
} from "../lib/autodrive-engine.js";
import { claimOutput, releaseOutput, registerOwnerStop, getOutputOwner } from "./output-owner.js";
import {
  blockDuringPanicCooldown,
  clampStrengthWithCeiling,
  setPatternCeiling,
  clearPatternCeiling,
} from "./safety-extras.js";
import { blockIfLocked as blockIfPinLocked } from "./session-pin.js";
import { sendSoftStop } from "./bluetooth.js";
import { trackStat } from "./stats.js";
import { isFlagEnabled } from "./feature-flags.js";

export {
  AUTODRIVE_TEMPLATES,
  AUTODRIVE_CONFIG_DEFAULTS,
  sanitiseAutodriveConfig,
  computeAutodriveOutput,
  getPhaseLabel,
} from "../lib/autodrive-engine.js";

const CONFIG_KEY = "stim_app_autodrive_v1";
const SEEN_KEY = "stim_app_autodrive_seen";
const LEARN_KEY = "stim_app_autodrive_learn_v1";
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

function loadLearning() {
  try {
    const raw = localStorage.getItem(LEARN_KEY);
    if (!raw) return { preferredBias: 0, sessions: 0, climaxRate: 0 };
    return JSON.parse(raw);
  } catch {
    return { preferredBias: 0, sessions: 0, climaxRate: 0 };
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

export function isAutodriveActive() {
  return !!(engineState && engineState.phase && engineState.phase !== "IDLE");
}

export function getAutodriveState() {
  if (!engineState) {
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
      tip: "Template wählen und Start drücken",
      patternHint: null,
      config: loadAutodriveConfig(),
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
  engineState = createInitialState(cfg, now);
  engineState.softA = AppState.softLimitA;
  engineState.softB = AppState.softLimitB;

  // Apply learned bias from prior sessions
  const learn = loadLearning();
  if (learn.preferredBias && Number.isFinite(learn.preferredBias)) {
    engineState.feedbackBias = clamp(learn.preferredBias, -0.15, 0.2);
  }

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
  notifyUi();
  return { ok: true };
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
  const marked = engineState?.userMarkedClimax;
  const bias = engineState?.feedbackBias;
  const phase = engineState?.phase;

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

  // Soft-stop output on stop (unless panic already zeroed)
  if (reason !== "panic" && reason !== "owner-claim") {
    try {
      sendSoftStop({ keepStrength: false, zeroUiStrength: false, writer: "safety" });
    } catch {
      /* ignore */
    }
  }

  if (wasActive) {
    log(`Autodrive gestoppt (${reason}).`, "info");
    try {
      trackStat("autodrive_stops");
      if (marked) trackStat("autodrive_success");
      // Learn preferred bias slowly
      if (typeof bias === "number") {
        const learn = loadLearning();
        const sessions = (learn.sessions || 0) + 1;
        const climaxHits = (learn.climaxHits || 0) + (marked ? 1 : 0);
        const preferredBias = clamp((learn.preferredBias || 0) * 0.7 + bias * 0.3, -0.15, 0.2);
        saveLearning({
          sessions,
          climaxHits,
          climaxRate: climaxHits / sessions,
          preferredBias,
          lastPhase: phase,
        });
      }
    } catch {
      /* ignore */
    }
  }
  notifyUi();
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
  notifyUi();
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
  }
  notifyUi();
}

/**
 * @param {(fA:number,aA:number,fB:number,aB:number,opts?:object) => Promise<void>|void} sendWave
 * @param {(patternId: string, loopCounter: number) => {fA:number,aA:number,fB:number,aB:number}} computePattern
 */
export async function applyAutodriveWaveTick(sendWave, computePattern) {
  if (!engineState || engineState.phase === "IDLE") return false;
  if (engineState.phase === "PAUSED" || silenced) {
    return true;
  }

  const now = Date.now();
  const out = computeAutodriveOutput(engineState, now);
  if (out.silenced) return true;

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
  }
  // freqBias from engine
  if (out.patternParams?.freqBias) {
    fA = Math.max(10, Math.min(240, fA + out.patternParams.freqBias));
    fB = Math.max(10, Math.min(240, fB + out.patternParams.freqBias));
  }
  const scale = out.patternParams?.ampScale ?? 1;
  aA = Math.round(Math.min(100, Math.max(0, aA * scale)));
  aB = Math.round(Math.min(100, Math.max(0, aB * scale)));

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
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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
