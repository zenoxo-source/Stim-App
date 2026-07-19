// ramp.js - Linear strength ramp ("Training Mode").
// Gradually increases strength from current value to a target over N minutes.
// Respects soft-limits, pattern ceiling, panic cooldown, and is cancellable.
//
// Public API:
//   startRamp({ targetA, targetB, durationMin }) → { ok, error? }
//   stopRamp(reason?)
//   isRampActive()
//   getRampState()

import { AppState, DOM, log } from "../state.js";
import { sendStrengthCommand } from "./bluetooth.js";
import {
  blockDuringPanicCooldown,
  clampStrengthWithCeiling,
  setPatternCeiling,
  clearPatternCeiling,
} from "./safety-extras.js";

const RAMP_TICK_MS = 1000; // 1 second ticks

/**
 * Begin a linear ramp.
 *
 * @param {object} opts
 * @param {number} opts.targetA  Final strength channel A (0..200)
 * @param {number} opts.targetB  Final strength channel B (0..200)
 * @param {number} opts.durationMin  Ramp duration in minutes (> 0)
 * @returns {{ ok: boolean, error?: string }}
 */
export function startRamp({ targetA, targetB, durationMin }) {
  if (AppState.rampState) {
    return { ok: false, error: "Es läuft bereits eine Ramp." };
  }
  if (blockDuringPanicCooldown("Ramp-Start")) {
    return { ok: false, error: "Panic-Cooldown aktiv — Ramp-Start blockiert." };
  }
  const tA = clampStrengthWithCeiling(Number(targetA), "A");
  const tB = clampStrengthWithCeiling(Number(targetB), "B");
  const durMin = Number(durationMin);
  if (!Number.isFinite(durMin) || durMin <= 0 || durMin > 180) {
    return { ok: false, error: "Dauer muss in 0.1 – 180 Minuten liegen." };
  }
  const totalTicks = Math.max(1, Math.round((durMin * 60 * 1000) / RAMP_TICK_MS));

  AppState.rampState = {
    startA: AppState.strengthA,
    startB: AppState.strengthB,
    targetA: tA,
    targetB: tB,
    startedAt: Date.now(),
    totalTicks,
    currentTick: 0,
    intervalId: null,
  };

  // Use pattern ceiling as a hard cap so nothing else (games, sessions, AI) can
  // push above target while the ramp runs.
  const ceiling = Math.max(tA, tB);
  if (ceiling > 0) setPatternCeiling(ceiling);

  AppState.rampState.intervalId = setInterval(rampTick, RAMP_TICK_MS);
  log(
    `Ramp gestartet: A ${AppState.strengthA}→${tA}, B ${AppState.strengthB}→${tB} über ${durMin} Min (${totalTicks} Ticks).`,
    "success"
  );
  updateRampUI();
  return { ok: true };
}

/**
 * Internal tick. Advances strength linearly. Stops when target reached, panic
 * cooldown active, or device disconnected.
 */
function rampTick() {
  const r = AppState.rampState;
  if (!r) return;

  if (!AppState.isConnected) {
    stopRamp("Gerät getrennt");
    return;
  }
  if (blockDuringPanicCooldown("Ramp-Tick")) {
    // Don't kill the ramp; just skip this tick. User can panic-stop separately.
    return;
  }

  r.currentTick += 1;
  const progress = Math.min(1, r.currentTick / r.totalTicks);
  const nextA = Math.round(r.startA + (r.targetA - r.startA) * progress);
  const nextB = Math.round(r.startB + (r.targetB - r.startB) * progress);

  sendStrengthCommand(nextA, nextB);

  if (r.currentTick >= r.totalTicks) {
    stopRamp("Ziel erreicht");
    return;
  }
  updateRampUI();
}

/**
 * Cancel the active ramp.
 * @param {string} [reason] logged reason
 */
export function stopRamp(reason = "manuell") {
  const r = AppState.rampState;
  if (!r) return;
  if (r.intervalId) clearInterval(r.intervalId);
  AppState.rampState = null;
  clearPatternCeiling();
  log(`Ramp gestoppt (${reason}).`, "info");
  updateRampUI();
}

/** @returns {boolean} */
export function isRampActive() {
  return AppState.rampState !== null;
}

/** @returns {object|null} snapshot of the active ramp state */
export function getRampState() {
  if (!AppState.rampState) return null;
  const r = AppState.rampState;
  return {
    startedAt: r.startedAt,
    elapsedMs: Date.now() - r.startedAt,
    totalMs: r.totalTicks * RAMP_TICK_MS,
    progress: Math.min(1, r.currentTick / r.totalTicks),
    currentA: AppState.strengthA,
    currentB: AppState.strengthB,
    targetA: r.targetA,
    targetB: r.targetB,
  };
}

/**
 * Update the (optional) ramp UI element. Safe when DOM is empty (tests).
 */
function updateRampUI() {
  const bar = DOM && DOM["ramp-progress"];
  const label = DOM && DOM["ramp-label"];
  const btnCancel = DOM && DOM["btn-ramp-cancel"];
  if (!bar && !label && !btnCancel) return;

  const r = getRampState();
  if (!r) {
    if (bar) bar.style.width = "0%";
    if (label) label.textContent = "Keine aktive Ramp";
    if (btnCancel) btnCancel.style.display = "none";
    return;
  }
  if (bar) bar.style.width = `${Math.round(r.progress * 100)}%`;
  if (label) {
    const elapsedSec = Math.round(r.elapsedMs / 1000);
    const totalSec = Math.round(r.totalMs / 1000);
    label.textContent = `Ramp: ${r.currentA}/${r.currentB} → ${r.targetA}/${r.targetB} (${elapsedSec}/${totalSec}s)`;
  }
  if (btnCancel) btnCancel.style.display = "inline-block";
}

// ---------------------------------------------------------------------------
// UI wiring (browser-only; no-op in Node tests where DOM elements are absent).
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const btnStart = document.getElementById("btn-ramp-start");
  const btnCancel = document.getElementById("btn-ramp-cancel");
  const inputA = document.getElementById("ramp-target-a");
  const inputB = document.getElementById("ramp-target-b");
  const inputDur = document.getElementById("ramp-duration");
  if (!btnStart) return;

  btnStart.addEventListener("click", () => {
    const targetA = parseInt(inputA?.value, 10);
    const targetB = parseInt(inputB?.value, 10);
    const durationMin = parseFloat(inputDur?.value);
    const result = startRamp({ targetA, targetB, durationMin });
    if (!result.ok) {
      log(`Ramp-Start fehlgeschlagen: ${result.error}`, "error");
    }
  });

  btnCancel?.addEventListener("click", () => {
    stopRamp("user");
  });
});
