// safety-extras.js - v3.1.0 safety additions.
// Pure helpers + side-effectful guards that the rest of the app hooks into.
//
// Three concerns:
//   1. PANIC COOLDOWN      — lock out strength changes for N ms after killAllOutput
//   2. PATTERN CEILING     — clamp strength to an absolute ceiling (pattern / ramp)
//   3. SIGNAL-LOSS WATCHER — soft-stop when BLE GATT/B1 stalls for > threshold
//
// The RAMP engine lives in modules/ramp.js but shares patternCeiling state.

import { AppState, DOM, log } from "../state.js";
import { sendSoftStop } from "./bluetooth.js";
import { updateOutputStatus } from "./status-ui.js";

// ---------------------------------------------------------------------------
// 1. Panic cooldown
// ---------------------------------------------------------------------------

/** Cooldown (ms) after a panic stop during which strength changes are blocked. */
export const PANIC_COOLDOWN_MS = 30_000;

/**
 * Arm the panic cooldown. Called by safety.killAllOutput() when invoked from a
 * panic source (button, hotkey, soft-stop timer). Slider handlers consult
 * isPanicCooldownActive() before sending any B0 strength change.
 * @param {number} [ms=PANIC_COOLDOWN_MS]
 */
export function armPanicCooldown(ms = PANIC_COOLDOWN_MS) {
  AppState.panicCooldownUntil = Date.now() + ms;
  updatePanicCooldownUI();
  log(
    `Panic-Cooldown aktiv (${Math.round(ms / 1000)}s) — Strength-Änderungen blockiert.`,
    "warning"
  );
}

/** @returns {boolean} true if strength changes are currently locked. */
export function isPanicCooldownActive() {
  return Date.now() < AppState.panicCooldownUntil;
}

/** Remaining cooldown in ms (0 if expired). */
export function panicCooldownRemaining() {
  return Math.max(0, AppState.panicCooldownUntil - Date.now());
}

/**
 * Reject a strength-change attempt if cooldown is active.
 * @returns {boolean} true if the change should be BLOCKED.
 */
export function blockDuringPanicCooldown(label = "Strength-Änderung") {
  if (!isPanicCooldownActive()) return false;
  const remaining = Math.ceil(panicCooldownRemaining() / 1000);
  log(`${label} blockiert — Panic-Cooldown noch ${remaining}s aktiv.`, "warning");
  return true;
}

/** Release the cooldown immediately (used by tests + the "Cancel cooldown" button if wired). */
export function releasePanicCooldown() {
  if (AppState.panicCooldownUntil === 0) return;
  AppState.panicCooldownUntil = 0;
  updatePanicCooldownUI();
  log("Panic-Cooldown vorzeitig aufgehoben.", "info");
}

/**
 * Refresh the cooldown indicator in the safety chip. Called on a 250ms interval
 * registered from status-ui's DOMContentLoaded. Safe to call when DOM is empty
 * (tests).
 */
export function updatePanicCooldownUI() {
  const chip = DOM && DOM["safety-chip"];
  const chipText = DOM && DOM["safety-chip-text"];
  if (!chip || !chipText) return;
  if (isPanicCooldownActive()) {
    const sec = Math.ceil(panicCooldownRemaining() / 1000);
    chipText.textContent = `PANIC-COOLDOWN ${sec}s`;
  }
  // Non-cooldown text is restored by status-ui's updateOutputStatus().
}

// ---------------------------------------------------------------------------
// 2. Pattern / ramp ceiling
// ---------------------------------------------------------------------------

/**
 * Activate an absolute strength ceiling. sendStrengthCommand clamps to
 * min(softLimit, ceiling). Pass 0 to disable.
 * @param {number} ceiling 0..200, 0 disables
 */
export function setPatternCeiling(ceiling) {
  const c = Math.max(0, Math.min(200, Math.round(Number(ceiling) || 0)));
  AppState.patternCeiling = c;
}

/** Clear the ceiling (equivalent to setPatternCeiling(0)). */
export function clearPatternCeiling() {
  AppState.patternCeiling = 0;
}

/**
 * Clamp a desired strength value against soft-limit + active ceiling.
 * @param {number} val desired strength
 * @param {"A"|"B"} channel which soft-limit to apply
 * @returns {number} clamped value 0..200
 */
export function clampStrengthWithCeiling(val, channel) {
  const soft = channel === "B" ? AppState.softLimitB : AppState.softLimitA;
  let v = Math.min(soft, Math.max(0, Math.round(val)));
  if (AppState.patternCeiling > 0) v = Math.min(v, AppState.patternCeiling);
  return v;
}

// ---------------------------------------------------------------------------
// 3. Signal-loss watchdog
// ---------------------------------------------------------------------------

/**
 * Watchdog threshold (ms). If no B1 notification AND no GATT activity for this
 * long while the device claims to be connected, we soft-stop.
 */
export const SIGNAL_LOSS_THRESHOLD_MS = 2000;

/** Watchdog interval handle (set when armSignalLossWatcher() is called). */
let signalWatchdogInterval = null;

/**
 * Mark GATT activity (called from bluetooth.js on every successful write /
 * notification). Cheap — just a timestamp update.
 */
export function noteGattActivity() {
  AppState.lastGattActivity = Date.now();
}

/**
 * Arm the watchdog. Idempotent.
 *
 * NB: does NOT reset lastGattActivity — callers manage that via
 * resetSignalLossFlag() (e.g. on connect / successful GATT activity).
 *
 * @param {() => void} [onLoss] optional callback (defaults to soft-stop + log)
 */
export function armSignalLossWatcher(onLoss) {
  if (signalWatchdogInterval) return;
  AppState.signalLossArmed = false;
  signalWatchdogInterval = setInterval(() => {
    if (!AppState.isConnected) return;
    if (AppState.lastGattActivity === 0) return;
    const stale = Date.now() - AppState.lastGattActivity;
    if (stale > SIGNAL_LOSS_THRESHOLD_MS && !AppState.signalLossArmed) {
      AppState.signalLossArmed = true;
      log(
        `BLE-Signalverlust erkannt (${(stale / 1000).toFixed(1)}s keine Aktivität) — Soft-Stop.`,
        "error"
      );
      try {
        sendSoftStop({ keepStrength: false });
      } catch (err) {
        console.warn("signal-loss soft-stop failed:", err);
      }
      try {
        updateOutputStatus({ panic: true });
      } catch {
        /* UI optional */
      }
      if (typeof onLoss === "function") {
        try {
          onLoss();
        } catch {
          /* swallow */
        }
      }
    }
  }, 500);
}

/** Disarm the watchdog (e.g. on clean disconnect). */
export function disarmSignalLossWatcher() {
  if (signalWatchdogInterval) {
    clearInterval(signalWatchdogInterval);
    signalWatchdogInterval = null;
  }
  AppState.signalLossArmed = false;
}

/** Reset the armed flag (called after reconnect). */
export function resetSignalLossFlag() {
  AppState.signalLossArmed = false;
  AppState.lastGattActivity = Date.now();
}
