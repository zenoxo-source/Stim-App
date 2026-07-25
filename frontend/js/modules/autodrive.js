// autodrive.js — Autodrive façade: lifecycle, claim, wave-loop integration.
// Pure logic lives in lib/autodrive-engine.js.

import { AppState, DOM, log, CONSTANTS } from "../state.js";
import {
  createInitialState,
  reduceAutodrive,
  computeAutodriveOutput,
  sanitiseAutodriveConfig,
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
} from "../lib/autodrive-engine.js";

const CONFIG_KEY = "stim_app_autodrive_v1";
const SEEN_KEY = "stim_app_autodrive_seen";
const TICK_MS = CONSTANTS.WAVE_LOOP_INTERVAL_MS || 100;

/** @type {object|null} */
let engineState = null;
/** @type {ReturnType<typeof setInterval>|null} */
let tickHandle = null;
/** @type {boolean} */
let silenced = false;
/** @type {((snap: object) => void)|null} */
let uiListener = null;

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

export function isAutodriveActive() {
  return !!(engineState && engineState.phase && engineState.phase !== "IDLE");
}

export function getAutodriveState() {
  if (!engineState) {
    return {
      phase: "IDLE",
      progress: 0,
      phaseProgress: 0,
      silenced: true,
      edgeCountDone: 0,
      edgeCountTarget: 0,
      userMarkedClimax: false,
      relStrength: 0,
      config: loadAutodriveConfig(),
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
  };
}

/**
 * Clear dirty-tracking so next wave tick re-arms absolute mode (K28).
 */
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
    return { ok: false, error: "Nicht verbunden." };
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

  const factor = cfg.maxSessionIntensityFactor ?? 0.95;
  const ceil = Math.max(
    Math.round(AppState.softLimitA * factor),
    Math.round(AppState.softLimitB * factor)
  );
  if (ceil > 0) setPatternCeiling(ceil);

  AppState.activePattern = "autodrive";
  silenced = false;
  clearAutodriveAppliedMarkers();

  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(engineTick, TICK_MS);

  try {
    localStorage.setItem(SEEN_KEY, "1");
    trackStat("autodrive_starts");
  } catch {
    /* ignore */
  }

  log(`Autodrive gestartet (${cfg.templateId || "custom"}).`, "success");
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
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  if (engineState) {
    engineState = reduceAutodrive(engineState, { type: "STOP", nowMs: Date.now() });
  }
  engineState = null;
  silenced = false;
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

  if (wasActive) {
    log(`Autodrive gestoppt (${reason}).`, "info");
    try {
      trackStat("autodrive_stops");
    } catch {
      /* ignore */
    }
  }
  notifyUi();
}

/**
 * @param {import("../lib/autodrive-engine.js").AutodriveFeedback|string} feedback
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
    log(`Autodrive Phase: ${before} → ${engineState.phase}`, "info");
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
  notifyUi();
}

/**
 * Called from waveLoopTick when activePattern === "autodrive".
 * Sole B0 path for Autodrive (K13/K13b/K27).
 * @param {(fA:number,aA:number,fB:number,aB:number,opts?:object) => Promise<void>|void} sendWave
 * @param {(patternId: string, loopCounter: number) => {fA:number,aA:number,fB:number,aB:number}} computePattern
 */
export async function applyAutodriveWaveTick(sendWave, computePattern) {
  if (!engineState || engineState.phase === "IDLE") return false;
  if (engineState.phase === "PAUSED" || silenced) {
    return true; // handled — skip other branches
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

  // Sync UI sliders lightly
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
  if (typeof uiListener === "function") {
    try {
      uiListener(getAutodriveState());
    } catch {
      /* ignore */
    }
  }
  // DOM phase chip if present
  const chip = document.getElementById("autodrive-phase");
  if (chip) {
    const st = getAutodriveState();
    chip.textContent = st.phase || "IDLE";
  }
  const prog = document.getElementById("autodrive-progress");
  if (prog) {
    const st = getAutodriveState();
    prog.style.width = `${Math.round((st.progress || 0) * 100)}%`;
  }
  const edgeEl = document.getElementById("autodrive-edges");
  if (edgeEl) {
    const st = getAutodriveState();
    edgeEl.textContent = `${st.edgeCountDone || 0} / ${st.edgeCountTarget || 0}`;
  }
  const relEl = document.getElementById("autodrive-rel");
  if (relEl) {
    const st = getAutodriveState();
    relEl.textContent = `${Math.round((st.relStrength || 0) * 100)}%`;
  }
}
