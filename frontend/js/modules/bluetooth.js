// bluetooth.js - BLE connection and V3 protocol for DG-LAB Coyote 3.0
// Based on DG-Kit reference implementation (github.com/0xNullAI/DG-Kit)
import { AppState, DOM, log, CONSTANTS, initDOMCache } from "../state.js";
import * as ProtocolUtils from "../lib/protocol-utils.js";
import { startWaveLoop, stopWaveLoop, updateSlidersA, updateSlidersB } from "../control-deck.js";
import { updateOutputStatus } from "./status-ui.js";
import { trackStat, recordBatterySample } from "./stats.js";
import { maybeAutoLoadAssignedProfile } from "./profiles.js";
import { syncExternalDevices } from "./buttplug.js";
import {
  blockDuringPanicCooldown,
  isPanicCooldownActive,
  clampStrengthWithCeiling,
  noteGattActivity,
  armSignalLossWatcher,
  disarmSignalLossWatcher,
  resetSignalLossFlag,
} from "./safety-extras.js";
import { blockIfLocked as blockIfPinLocked } from "./session-pin.js";
import { assertCanWrite, forceReleaseAll } from "./output-owner.js";

// V3 Protocol overview:
//   0xB0 packet (20 bytes): combined strength + waveform, sent every 100ms
//     byte 0:  0xB0
//     byte 1:  ((seq & 0x0f) << 4) | (mode & 0x0f)
//               mode bits 3-2: channel A (0=none, 1=+delta, 2=-delta, 3=absolute)
//               mode bits 1-0: channel B
//     byte 2:  strengthA (0-200)
//     byte 3:  strengthB (0-200)
//     bytes 4-7:   frequency[4] for channel A (0=inactive, 10-240=active)
//     bytes 8-11:  intensity[4] for channel A (0-100=active, 101=inactive)
//     bytes 12-15: frequency[4] for channel B
//     bytes 16-19: intensity[4] for channel B
//
//   0xBF packet (7 bytes): set device limits
//     byte 0: 0xBF, bytes 1-2: limitA/B, bytes 3-4: freqBalA/B, bytes 5-6: waveBalA/B
//
//   0xB1 notification: device ACK + strength feedback
//     byte 0: 0xB1, byte 1: ackSeq, byte 2: strengthA, byte 3: strengthB

/** Prevent overlapping connect attempts (double-click / auto-reconnect). */
let connectInProgress = false;
/** True while the user intentionally disconnects (suppresses lost-link notification). */
let manualDisconnect = false;
/** True once a low-battery notification was shown this charge cycle. */
let batteryLowNotified = false;
/** Stable disconnect handler so we don't stack gattserverdisconnected listeners. */
let onGattDisconnected = null;

// ---------------------------------------------------------------------------
// Debug hex-dump (Fix 8: Debug-Mode)
// ---------------------------------------------------------------------------
function debugHex(label, data) {
  if (!AppState.debugMode) return;
  const hex = ProtocolUtils.bytesToHex(data);
  log(`[BLE-DEBUG] ${label}: ${hex}`, "info");
}

// ---------------------------------------------------------------------------
// Core BLE write (Fix 6: error logging)
// ---------------------------------------------------------------------------
export function sendBluetoothCommand(data) {
  return new Promise((resolve) => {
    if (!AppState.writeChar) {
      resolve();
      return;
    }
    try {
      debugHex("B0-write", data);
      const writeOp = AppState.writeChar.writeValueWithoutResponse
        ? AppState.writeChar.writeValueWithoutResponse(data)
        : AppState.writeChar.writeValue(data);
      if (writeOp && writeOp.then) {
        writeOp
          .then(() => {
            noteGattActivity();
            resolve();
          })
          .catch((err) => {
            if (err && err.message && !err.message.includes("GATT operation already in progress")) {
              console.warn("BT Write Error:", err);
            }
            resolve();
          });
      } else {
        noteGattActivity();
        resolve();
      }
    } catch (err) {
      if (err && err.message && !err.message.includes("GATT operation already in progress")) {
        console.warn("BT Write Error:", err);
      }
      resolve();
    }
  });
}

async function drainBluetoothQueue() {
  if (AppState.isBluetoothWriting || !AppState.writeChar) return;

  const dataToWrite = AppState.pendingWaveformData;
  if (!dataToWrite) return;
  AppState.pendingWaveformData = null;

  AppState.isBluetoothWriting = true;
  await sendBluetoothCommand(dataToWrite);
  AppState.isBluetoothWriting = false;

  drainBluetoothQueue();
}

// ==========================================
// V3 PROTOCOL FUNCTIONS
// ==========================================

export function sendV3Init() {
  if (!AppState.writeChar) return;
  const limitA = Math.min(200, Math.max(0, AppState.softLimitA));
  const limitB = Math.min(200, Math.max(0, AppState.softLimitB));
  // BF: limits + frequency balance + wave/intensity balance (each 0–255)
  const fbA = Math.min(255, Math.max(0, Math.round(AppState.freqBalanceA ?? 160)));
  const fbB = Math.min(255, Math.max(0, Math.round(AppState.freqBalanceB ?? 160)));
  const wbA = Math.min(255, Math.max(0, Math.round(AppState.waveBalanceA ?? 0)));
  const wbB = Math.min(255, Math.max(0, Math.round(AppState.waveBalanceB ?? 0)));
  const payload = new Uint8Array([0xbf, limitA, limitB, fbA, fbB, wbA, wbB]);
  debugHex("BF-write", payload);
  sendBluetoothCommand(payload);
  log(
    `V3 BF gesendet (Limits ${limitA}/${limitB}, FreqBal ${fbA}/${fbB}, WaveBal ${wbA}/${wbB})`,
    "info"
  );
}

/**
 * V3 needs channel strength > 0 for wave amps to be felt. Raise strength
 * gently to a minimum if the user left the sliders at 0 (used by STIM /
 * pattern editor before starting an output).
 */
export function ensureGameStrength(minLevel) {
  const min = Math.max(10, Math.min(80, Number(minLevel) || 40));
  const targetA = Math.min(AppState.softLimitA, Math.max(AppState.strengthA || 0, min));
  const targetB = Math.min(AppState.softLimitB, Math.max(AppState.strengthB || 0, min));
  let raised = false;
  if ((AppState.strengthA || 0) < min) {
    updateSlidersA(targetA);
    raised = true;
  }
  if ((AppState.strengthB || 0) < min) {
    updateSlidersB(targetB);
    raised = true;
  }
  if (raised) {
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
    log(
      `Basisstärke ${min} gesetzt (Soft-Limits: ${AppState.softLimitA}/${AppState.softLimitB}).`,
      "info"
    );
  }
}

function getDeviceStrength(val, softLimit) {
  // UI/logical intensity stays unscaled; masterScale applies only to device output.
  return ProtocolUtils.getDeviceStrength(val, softLimit, AppState.masterScale);
}

// ---------------------------------------------------------------------------
// Fix 1: Combined Strength+Waveform immediate B0 send
// ---------------------------------------------------------------------------
// Instead of just setting btPendingMode and waiting for the next wave loop
// tick, we immediately build and send a complete B0 packet with both strength
// and waveform. This eliminates the 100ms delay and prevents the drain queue
// from losing one of the two pending packets.
// ---------------------------------------------------------------------------

/**
 * Logical channel strength → device wire strength (soft limit + masterScale).
 * Exported for B1 feedback comparisons / tests.
 * @param {number} val
 * @param {"A"|"B"} channel
 * @returns {number}
 */
export function logicalToDeviceStrength(val, channel) {
  const soft = channel === "B" ? AppState.softLimitB : AppState.softLimitA;
  return getDeviceStrength(val, soft);
}

/**
 * Device-reported strength → logical UI strength (inverse of masterScale).
 * Soft limit applied after inverse so sliders stay within the configured cap.
 * @param {number} deviceStr
 * @param {"A"|"B"} channel
 * @returns {number}
 */
export function deviceToLogicalStrength(deviceStr, channel) {
  const soft = channel === "B" ? AppState.softLimitB : AppState.softLimitA;
  const raw = Math.round(Number(deviceStr) || 0);
  const clampedDev = Math.min(200, Math.max(0, raw));
  const scale = AppState.masterScale;
  if (typeof scale !== "number" || Number.isNaN(scale) || scale <= 0) {
    // Master at 0 % → no output path; surface device reading as-is (capped).
    return Math.min(soft, clampedDev);
  }
  const logical = Math.round(clampedDev / scale);
  return Math.min(soft, Math.max(0, logical));
}

/**
 * Build and immediately queue a full B0 packet using current state values.
 * This is the single entry-point for all B0 writes.
 * @param {number} freqA - Wire frequency for channel A (10-240)
 * @param {number} ampA - Wave amplitude for channel A (0-100, pre-scaling)
 * @param {number} freqB - Wire frequency for channel B (10-240)
 * @param {number} ampB - Wave amplitude for channel B (0-100, pre-scaling)
 * @param {object} [opts] - Options
 * @param {boolean} [opts.keepStrength=false] - Don't include pending strength change
 */
export function sendB0Now(freqA, ampA, freqB, ampB, opts) {
  if (!AppState.writeChar) return;
  const o = opts || {};

  // During panic cooldown, refuse non-zero wave amps (strength is already 0).
  // Emergency/soft-stop packets still pass through with amp 0 → intensity 101.
  if (!o.force && isPanicCooldownActive() && ((Number(ampA) || 0) > 0 || (Number(ampB) || 0) > 0)) {
    return;
  }

  // Keep lastWave* as LOGICAL inputs so sendStrengthCommand can re-issue them
  // without double-applying masterScale / swapChannels.
  const inAmpA = Math.min(100, Math.max(0, Math.round(Number(ampA) || 0)));
  const inAmpB = Math.min(100, Math.max(0, Math.round(Number(ampB) || 0)));
  AppState.lastWaveFreqA = inAmpA > 0 ? ProtocolUtils.clampWireFreq(freqA) : 0;
  AppState.lastWaveAmpA = inAmpA;
  AppState.lastWaveFreqB = inAmpB > 0 ? ProtocolUtils.clampWireFreq(freqB) : 0;
  AppState.lastWaveAmpB = inAmpB;

  // Pulse-width sliders scale logical wave amplitude (0–100%)
  const logicalA = ProtocolUtils.applyPulseWidthScale(ampA, AppState.pulseWidthA);
  const logicalB = ProtocolUtils.applyPulseWidthScale(ampB, AppState.pulseWidthB);

  // Master scale on wave amplitudes
  const scaledA = ProtocolUtils.scaleWaveAmp(logicalA, AppState.masterScale);
  const scaledB = ProtocolUtils.scaleWaveAmp(logicalB, AppState.masterScale);

  let segA = ProtocolUtils.resolveWaveSegment(freqA, scaledA);
  let segB = ProtocolUtils.resolveWaveSegment(freqB, scaledB);

  // F10: 4×25 ms micro-slots for smoother sensations. Slots carry RAW
  // pattern amplitudes; pulse-width + master scaling applies per slot here.
  let slotsA = null;
  let slotsB = null;
  if (Array.isArray(o.slotsA) && o.slotsA.length === 4) {
    slotsA = o.slotsA.map((s) =>
      ProtocolUtils.resolveWaveSegment(
        s.freq,
        ProtocolUtils.scaleWaveAmp(
          ProtocolUtils.applyPulseWidthScale(s.intensity, AppState.pulseWidthA),
          AppState.masterScale
        )
      )
    );
  }
  if (Array.isArray(o.slotsB) && o.slotsB.length === 4) {
    slotsB = o.slotsB.map((s) =>
      ProtocolUtils.resolveWaveSegment(
        s.freq,
        ProtocolUtils.scaleWaveAmp(
          ProtocolUtils.applyPulseWidthScale(s.intensity, AppState.pulseWidthB),
          AppState.masterScale
        )
      )
    );
  }

  // Logical UI strength  device wire (soft + masterScale)
  let strA = getDeviceStrength(AppState.strengthA, AppState.softLimitA);
  let strB = getDeviceStrength(AppState.strengthB, AppState.softLimitB);

  // Full channel swap: both strength and wave map to opposite physical outputs
  if (AppState.swapChannels) {
    const tmpSeg = segA;
    segA = segB;
    segB = tmpSeg;
    const tmpSlots = slotsA;
    slotsA = slotsB;
    slotsB = tmpSlots;
    const tmpStr = strA;
    strA = strB;
    strB = tmpStr;
  }

  // Determine if strength changed (pending mode)
  let mode = 0;
  let seq = 0;
  if (!AppState.btAwaitingAck && AppState.btPendingMode !== 0 && !o.keepStrength) {
    AppState.btSeq = AppState.btSeq >= 15 ? 1 : AppState.btSeq + 1;
    seq = AppState.btSeq;
    mode = AppState.btPendingMode;
    AppState.btAwaitingAck = true;
    AppState.btPendingMode = 0;
    AppState._lastStrengthSeq = seq;
    // Fallback: clear awaitingAck after timeout if no matching ACK arrives.
    // Keep _lastStrengthSeq so a late B1 is not misclassified as a wheel event.
    const sentSeq = seq;
    const timeout = CONSTANTS.B1_ACK_TIMEOUT_MS || 300;
    setTimeout(() => {
      if (AppState.btAwaitingAck && AppState.btSeq === sentSeq) {
        AppState.btAwaitingAck = false;
        AppState.btSeq = 0;
        console.warn("B1 ACK timeout — seq", sentSeq, "not acknowledged");
      }
    }, timeout);
  }

  // Coyote V3 needs a fresh 0xB0 about every 100ms for continuous wave output
  // (4×25ms segments). Skipping "identical" packets stops stimulation after one
  // frame — users only feel a blip when moving a slider. Only coalesce true
  // duplicate calls within a short window (e.g. strength + wave in same event).
  // Wave-loop always passes force:true so the heartbeat is never skipped.
  const nowMs = Date.now();
  const lastSendMs = AppState._lastB0SendMs || 0;
  const samePayload =
    mode === 0 &&
    AppState._lastSentStrA === strA &&
    AppState._lastSentStrB === strB &&
    AppState._lastSentFreqA === segA.freq &&
    AppState._lastSentAmpA === segA.intensity &&
    AppState._lastSentFreqB === segB.freq &&
    AppState._lastSentAmpB === segB.intensity;
  if (!o.force && !o.keepStrength && samePayload && nowMs - lastSendMs < 40) {
    return;
  }
  AppState._lastB0SendMs = nowMs;
  AppState._lastSentStrA = strA;
  AppState._lastSentStrB = strB;
  AppState._lastSentFreqA = segA.freq;
  AppState._lastSentAmpA = segA.intensity;
  AppState._lastSentFreqB = segB.freq;
  AppState._lastSentAmpB = segB.intensity;

  const data = new Uint8Array(20);
  data[0] = 0xb0;
  data[1] = ((seq & 0x0f) << 4) | (mode & 0x0f);
  data[2] = strA;
  data[3] = strB;

  if (ProtocolUtils.fillChannelWave) {
    if (slotsA && ProtocolUtils.fillChannelWaveSlots) {
      ProtocolUtils.fillChannelWaveSlots(data, 4, 8, slotsA);
    } else {
      ProtocolUtils.fillChannelWave(data, 4, 8, segA.freq, segA.intensity);
    }
    if (slotsB && ProtocolUtils.fillChannelWaveSlots) {
      ProtocolUtils.fillChannelWaveSlots(data, 12, 16, slotsB);
    } else {
      ProtocolUtils.fillChannelWave(data, 12, 16, segB.freq, segB.intensity);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      data[4 + i] = segA.freq;
      data[8 + i] = segA.intensity;
      data[12 + i] = segB.freq;
      data[16 + i] = segB.intensity;
    }
  }

  AppState.pendingWaveformData = data;
  drainBluetoothQueue();
}

/**
 * @param {number} valA
 * @param {number} valB
 * @param {{ writer?: string }} [opts]
 */
export function sendStrengthCommand(valA, valB, opts = {}) {
  if (!AppState.writeChar) return;
  if (blockDuringPanicCooldown("Strength-Befehl")) return;
  if (blockIfPinLocked("Strength-Befehl")) return;

  // Output ownership (K26): default writer = external
  const writer = opts?.writer || "external";
  if (!assertCanWrite(writer, { kind: "strength" })) return;

  // Keep AppState as logical (UI) values; do not bake masterScale into state.
  // Apply panic-cooldown + active pattern/ramp ceiling.
  AppState.strengthA = clampStrengthWithCeiling(valA, "A");
  AppState.strengthB = clampStrengthWithCeiling(valB, "B");
  AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;

  // Immediately send combined B0 with current waveform values.
  // Manual idle (no pattern): full wave amp so strength is felt continuously.
  // Pattern/autodrive: re-use last logical wave (or 0 if not yet ticked).
  const fA = AppState.activePattern
    ? AppState.lastWaveFreqA || AppState.frequencyA
    : AppState.frequencyA;
  const fB = AppState.activePattern
    ? AppState.lastWaveFreqB || AppState.frequencyB
    : AppState.frequencyB;
  const aA = AppState.activePattern ? AppState.lastWaveAmpA || 0 : 100;
  const aB = AppState.activePattern ? AppState.lastWaveAmpB || 0 : 100;
  // force: master/strength changes must always hit the wire (not coalesced away)
  sendB0Now(fA, aA, fB, aB, { force: true });
  // F17: sync external Buttplug devices with the normalized strength level.
  try {
    syncExternalDevices(AppState.strengthA, AppState.strengthB);
  } catch {
    /* optional */
  }
}

/**
 * @param {number} freqA
 * @param {number} ampA
 * @param {number} freqB
 * @param {number} ampB
 * @param {{ writer?: string }} [opts]
 */
/**
 * @param {number} freqA
 * @param {number} ampA
 * @param {number} freqB
 * @param {number} ampB
 * @param {{ writer?: string, force?: boolean, keepStrength?: boolean }} [opts]
 */
export function sendWaveformCommand(freqA, ampA, freqB, ampB, opts = {}) {
  const writer = opts?.writer || "external";
  if (!assertCanWrite(writer, { kind: "wave" })) return;
  // Wave-loop is the continuous V3 heartbeat — never skip as "duplicate".
  const force = opts.force === true || writer === "wave-loop";
  sendB0Now(freqA, ampA, freqB, ampB, {
    force,
    keepStrength: opts.keepStrength,
    slotsA: opts.slotsA,
    slotsB: opts.slotsB,
  });
}

/**
 * Soft-stop: inactive waveforms (freq 0, intensity 101).
 * @param {{ keepStrength?: boolean, zeroUiStrength?: boolean, reassertStrength?: boolean, writer?: string }} opts
 *   keepStrength: leave channel strength as-is (for short gaps between pulses)
 *   zeroUiStrength: also set AppState/UI strength to 0 (pattern stop etc.)
 *   reassertStrength: with keepStrength, still send absolute mode so wire values apply
 *   writer: optional ownership tag (soft-stop is always allowed; used for logging only)
 */
export function sendSoftStop(opts = {}) {
  if (!AppState.writeChar) return;
  const keepStrength = !!opts.keepStrength;
  const zeroUi = !!opts.zeroUiStrength;
  const reassert = !!opts.reassertStrength;

  if (zeroUi) {
    AppState.strengthA = 0;
    AppState.strengthB = 0;
  }

  let strA = keepStrength ? getDeviceStrength(AppState.strengthA, AppState.softLimitA) : 0;
  let strB = keepStrength ? getDeviceStrength(AppState.strengthB, AppState.softLimitB) : 0;
  if (AppState.swapChannels) {
    const tmp = strA;
    strA = strB;
    strB = tmp;
  }

  // Absolute mode when zeroing strength, or when caller must re-assert keepStrength values.
  // Mode 0 + keepStrength: device keeps prior absolute strength (wave only off).
  const useAbsolute = !keepStrength || reassert;
  const data = ProtocolUtils.buildSoftStopBytes({
    strengthA: strA,
    strengthB: strB,
    modeNibble: useAbsolute ? 0x0f : 0,
  });

  debugHex("B0-soft-stop", data);

  AppState.lastWaveAmpA = 0;
  AppState.lastWaveAmpB = 0;
  AppState.lastWaveFreqA = 0;
  AppState.lastWaveFreqB = 0;
  // Dirty tracking: inactive wave + actual wire strengths we just queued
  AppState._lastSentFreqA = 0;
  AppState._lastSentAmpA = 101;
  AppState._lastSentFreqB = 0;
  AppState._lastSentAmpB = 101;
  AppState._lastSentStrA = strA;
  AppState._lastSentStrB = strB;

  if (!keepStrength || reassert) {
    AppState.btPendingMode = 0;
    AppState.btSeq = 0;
    AppState.btAwaitingAck = false;
  }

  AppState.pendingWaveformData = data;
  drainBluetoothQueue();
}

export function sendV3EmergencyStop() {
  if (!AppState.writeChar) return;

  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.btPendingMode = 0;
  AppState.btSeq = 0;
  AppState.btAwaitingAck = false;
  AppState._lastStrengthSeq = 0;
  AppState.lastWaveAmpA = 0;
  AppState.lastWaveAmpB = 0;
  AppState.lastWaveFreqA = 0;
  AppState.lastWaveFreqB = 0;
  AppState._lastSentStrA = 0;
  AppState._lastSentStrB = 0;
  AppState._lastSentFreqA = 0;
  AppState._lastSentAmpA = 101;
  AppState._lastSentFreqB = 0;
  AppState._lastSentAmpB = 101;

  const data = ProtocolUtils.buildEmergencyStopBytes();

  debugHex("B0-emergency", data);

  AppState.pendingWaveformData = data;
  drainBluetoothQueue();
}

// ---------------------------------------------------------------------------
// Fix 7: Heartbeat / connection monitoring
// ---------------------------------------------------------------------------
export function updateHeartbeat() {
  if (!AppState.isConnected) return;
  const now = Date.now();
  // If we haven't received a B1 in B1_STALE_WARNING_MS and we have strength > 0, warn
  if (
    AppState.lastB1Time > 0 &&
    now - AppState.lastB1Time > CONSTANTS.B1_STALE_WARNING_MS &&
    (AppState.strengthA > 0 || AppState.strengthB > 0 || AppState.activePattern)
  ) {
    console.warn(
      `Heartbeat: keine B1-Antwort seit ${((now - AppState.lastB1Time) / 1000).toFixed(1)}s`
    );
    // Reset warning to avoid spamming (will re-warn after another timeout)
    AppState.lastB1Time = now;
  }
}

/**
 * Process a V3 B1 notification (ACK + device strength).
 * Exported for unit tests.
 * @param {Uint8Array} data
 */
export function processB1Notification(data) {
  if (!data || data[0] !== 0xb1 || data.length < 4) return;

  AppState.lastB1Time = Date.now();
  noteGattActivity();
  const ackSeq = data[1] & 0x0f;
  let deviceStrA = data[2];
  let deviceStrB = data[3];
  debugHex("B1-recv", data);

  // Device reports physical channels; map back to logical A/B when swapped.
  if (AppState.swapChannels) {
    const tmp = deviceStrA;
    deviceStrA = deviceStrB;
    deviceStrB = tmp;
  }

  // Our own strength write (current or late ACK after timeout).
  // Never overwrite logical AppState from our own echo — masterScale would desync.
  const isOurAck =
    ackSeq !== 0 && (ackSeq === AppState.btSeq || ackSeq === (AppState._lastStrengthSeq || 0));
  if (isOurAck) {
    if (AppState.btAwaitingAck && (ackSeq === AppState.btSeq || AppState.btSeq === 0)) {
      AppState.btAwaitingAck = false;
      AppState.btSeq = 0;
    }
    return;
  }

  // Matches what we believe is already on the wire (scaled logical) — no UI change.
  const expectedA = getDeviceStrength(AppState.strengthA, AppState.softLimitA);
  const expectedB = getDeviceStrength(AppState.strengthB, AppState.softLimitB);
  if (deviceStrA === expectedA && deviceStrB === expectedB) {
    return;
  }

  // External strength change (physical wheel etc.). Invert masterScale → logical UI.
  const logicalA = deviceToLogicalStrength(deviceStrA, "A");
  const logicalB = deviceToLogicalStrength(deviceStrB, "B");
  if (logicalA === AppState.strengthA && logicalB === AppState.strengthB) {
    return;
  }

  log(
    `Ger\u00e4t-Strength extern ge\u00e4ndert: A=${logicalA} B=${logicalB} (wire ${deviceStrA}/${deviceStrB})`,
    "info"
  );
  AppState.strengthA = logicalA;
  AppState.strengthB = logicalB;
  if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = logicalA;
  if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = logicalA;
  if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = logicalA;
  if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = logicalB;
  if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = logicalB;
  if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = logicalB;
  updateOutputStatus();
}

function handleDeviceNotification(event) {
  const value = event.target.value;
  const data = new Uint8Array(value.buffer);
  processB1Notification(data);
}

export function updateBatteryUI(level) {
  if (DOM["battery-level-bar"]) DOM["battery-level-bar"].style.height = `${level}%`;
  if (DOM["battery-text"]) DOM["battery-text"].textContent = `${level}%`;
}

async function readBatteryStatus() {
  if (!AppState.batteryChar) return;
  try {
    const value = await AppState.batteryChar.readValue();
    AppState.batteryLevel = value.getUint8(0);
    updateBatteryUI(AppState.batteryLevel);
    // Record into the stats battery history (ring buffer, no PII).
    try {
      recordBatterySample(AppState.batteryLevel);
    } catch {
      /* stats optional */
    }
    // Low-battery alarm: notify once per charge cycle, re-arm above 25 %.
    if (AppState.batteryLevel <= 20 && !batteryLowNotified) {
      batteryLowNotified = true;
      try {
        if (window.electronAPI && typeof window.electronAPI.notify === "function") {
          window.electronAPI.notify(
            "Batterie niedrig",
            `Coyote-Batterie bei ${AppState.batteryLevel}% – Aufladen empfohlen.`
          );
        }
      } catch {
        /* optional */
      }
      log(`Batterie niedrig: ${AppState.batteryLevel}%`, "warning");
    } else if (AppState.batteryLevel >= 25) {
      batteryLowNotified = false;
    }
    log(`Batterieladestand: ${AppState.batteryLevel}%`, "info");
  } catch (err) {
    console.warn("Could not read battery level:", err);
  }
}

function setReconnectStatus(message) {
  const el = document.getElementById("reconnect-status");
  if (!el) return;
  if (!message) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = message;
}

function setDeviceListHint(names) {
  const el = document.getElementById("bt-device-list");
  if (!el) return;
  if (!names || names.length === 0) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.style.display = "block";
  el.innerHTML = names.map((n) => `<div class="bt-device-item">${escapeBtHtml(n)}</div>`).join("");
}

function escapeBtHtml(value) {
  return ProtocolUtils.escapeHtml(value);
}

function friendlyBtError(err) {
  const msg = err?.message || String(err || "Unbekannter Fehler");
  if (/User cancelled|NotFoundError|canceled|No device selected|chooser/i.test(msg)) {
    return (
      "Kein Coyote gefunden oder abgebrochen. Gerät einschalten, nah am PC halten, " +
      "Bluetooth am PC an, und Name beginnt typisch mit 47L121. Erneut verbinden."
    );
  }
  if (/NetworkError|GATT Server is disconnected/i.test(msg)) {
    return "Bluetooth-Verbindung unterbrochen (GATT). Bitte erneut verbinden.";
  }
  if (/SecurityError|NotAllowedError/i.test(msg)) {
    return "Bluetooth-Zugriff verweigert. Windows-Bluetooth-Berechtigung prüfen und erneut versuchen.";
  }
  if (/Unsupported|NotSupportedError/i.test(msg)) {
    return "Web Bluetooth wird hier nicht unterstützt (Electron/OS).";
  }
  if (/getPrimaryService|Service not found|UUID/i.test(msg)) {
    return "Coyote verbunden, aber V3-Service nicht gefunden. Gerät neu starten und erneut koppeln.";
  }
  return `Verbindungsfehler: ${msg}`;
}

function scheduleReconnect() {
  if (AppState.reconnectTimer) return;
  if (AppState.reconnectAttempts >= CONSTANTS.MAX_RECONNECT_ATTEMPTS) {
    log("Maximale Reconnect-Versuche erreicht.", "error");
    setReconnectStatus("Reconnect fehlgeschlagen – manuell verbinden.");
    return;
  }
  AppState.reconnectAttempts += 1;
  const attempt = AppState.reconnectAttempts;
  const max = CONSTANTS.MAX_RECONNECT_ATTEMPTS;
  // Exponential backoff: base * 2^(attempt-1), capped at max
  const delay = Math.min(
    CONSTANTS.RECONNECT_DELAY_MAX_MS,
    CONSTANTS.RECONNECT_DELAY_BASE_MS * Math.pow(2, attempt - 1)
  );
  const secs = (delay / 1000).toFixed(1);
  log(`Versuche Reconnect in ${secs}s (Versuch ${attempt}/${max})...`, "warning");
  setReconnectStatus(`Reconnect ${attempt}/${max} in ${secs}s…`);
  AppState.reconnectTimer = setTimeout(() => {
    AppState.reconnectTimer = null;
    setReconnectStatus(`Reconnect ${attempt}/${max} läuft…`);
    DOM["btn-connect"]?.click();
  }, delay);
}

export function clearReconnect() {
  if (AppState.reconnectTimer) {
    clearTimeout(AppState.reconnectTimer);
    AppState.reconnectTimer = null;
  }
  setReconnectStatus("");
}

function clearBatteryPolling() {
  if (AppState.batteryIntervalId) {
    clearInterval(AppState.batteryIntervalId);
    AppState.batteryIntervalId = null;
  }
}

function onDisconnected() {
  const wasConnected = AppState.isConnected;
  connectInProgress = false;
  AppState.isConnected = false;
  AppState.writeChar = null;
  AppState.notifyChar = null;
  AppState.batteryChar = null;
  AppState.btSeq = 0;
  AppState.btAwaitingAck = false;
  AppState.btPendingMode = 0;
  AppState._lastStrengthSeq = 0;
  AppState.lastB1Time = 0;
  AppState.lastGattActivity = 0;
  AppState._lastSentStrA = undefined;
  AppState._lastSentStrB = undefined;
  AppState._lastSentFreqA = undefined;
  AppState._lastSentFreqB = undefined;
  AppState._lastSentAmpA = undefined;
  AppState._lastSentAmpB = undefined;
  AppState._lastB0SendMs = 0;
  clearBatteryPolling();
  stopWaveLoop();
  disarmSignalLossWatcher();
  try {
    forceReleaseAll("disconnect");
  } catch {
    /* ignore */
  }

  log("Bluetooth-Verbindung zum Coyote verloren.", "warning");
  if (DOM["connection-text"]) DOM["connection-text"].textContent = "Getrennt";
  if (DOM["connection-indicator"]) DOM["connection-indicator"].className = "status-indicator";
  if (DOM["btn-connect"]) DOM["btn-connect"].style.display = "block";
  if (DOM["btn-disconnect"]) DOM["btn-disconnect"].style.display = "none";
  if (DOM["battery-text"]) DOM["battery-text"].textContent = "--%";
  if (DOM["battery-level-bar"]) DOM["battery-level-bar"].style.height = "0%";
  setDeviceListHint([]);
  updateOutputStatus();

  if (DOM["info-device-name"]) DOM["info-device-name"].textContent = "Nicht verbunden";
  if (DOM["info-manufacturer"]) DOM["info-manufacturer"].textContent = "--";
  if (DOM["info-firmware"]) DOM["info-firmware"].textContent = "--";
  if (DOM["info-hardware"]) DOM["info-hardware"].textContent = "--";

  if (window.electronAPI && typeof window.electronAPI.setConnected === "function") {
    window.electronAPI.setConnected(false);
  }

  // Notify when the link drops unexpectedly (not via the disconnect button)
  // so the user gets a system notification even with the window in the tray.
  if (wasConnected && !manualDisconnect) {
    try {
      if (window.electronAPI && typeof window.electronAPI.notify === "function") {
        window.electronAPI.notify(
          "Verbindung verloren",
          "Bluetooth-Verbindung zum Coyote unterbrochen – Reconnect läuft."
        );
      }
    } catch {
      /* optional */
    }
  }
  manualDisconnect = false;

  scheduleReconnect();
}

export function resetUIOnDisconnect() {
  AppState.isConnected = false;
  AppState.writeChar = null;
  AppState.notifyChar = null;
  AppState.batteryChar = null;
  AppState.lastB1Time = 0;
  clearBatteryPolling();
  if (DOM["connection-text"]) DOM["connection-text"].textContent = "Getrennt";
  if (DOM["connection-indicator"]) DOM["connection-indicator"].className = "status-indicator";
  if (DOM["btn-connect"]) DOM["btn-connect"].style.display = "block";
  if (DOM["btn-disconnect"]) DOM["btn-disconnect"].style.display = "none";
  if (window.electronAPI && typeof window.electronAPI.setConnected === "function") {
    window.electronAPI.setConnected(false);
  }
}

function el(id) {
  return DOM[id] || document.getElementById(id);
}

function wireConnectButton() {
  const btnConnect = el("btn-connect");
  if (!btnConnect) {
    // In Node tests there is no full HTML; in the app this is a real error.
    if (typeof document !== "undefined" && document.getElementById("app-container")) {
      console.error("[bluetooth] #btn-connect not found in DOM");
    }
    return;
  }
  // Avoid double-binding if init runs twice
  if (btnConnect.dataset.btWired === "1") return;
  btnConnect.dataset.btWired = "1";

  btnConnect.addEventListener("click", async () => {
    // Immediate visual feedback even if bluetooth API is missing
    try {
      log("Connect angeklickt…", "info");
    } catch {
      /* log needs terminal */
    }

    if (!navigator.bluetooth) {
      log("Web Bluetooth wird von diesem System/Browser nicht unterst\u00fctzt.", "error");
      setReconnectStatus("Web Bluetooth nicht verfügbar");
      return;
    }
    if (connectInProgress) {
      log("Verbindung läuft bereits – bitte warten…", "warning");
      return;
    }
    // Already linked?
    if (AppState.device?.gatt?.connected && AppState.writeChar) {
      log("Bereits mit dem Coyote verbunden.", "info");
      return;
    }

    connectInProgress = true;
    clearReconnect();

    log("Suche nach DG-LAB Coyote 3.0...", "info");
    if (DOM["connection-text"]) DOM["connection-text"].textContent = "Suche...";
    if (DOM["connection-indicator"])
      DOM["connection-indicator"].className = "status-indicator connecting";
    setReconnectStatus("Bluetooth-Suche läuft…");
    setDeviceListHint([`Filter: ${CONSTANTS.COYOTE_NAME_PREFIX}* / Coyote / Service 0x180C`]);

    try {
      // Multiple filters are OR'd — catch name variants + devices advertising V3 service.
      AppState.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: CONSTANTS.COYOTE_NAME_PREFIX },
          { namePrefix: "47L12" },
          { namePrefix: "Coyote" },
          { namePrefix: "coyote" },
          { services: [CONSTANTS.SERVICE_UUID] },
        ],
        optionalServices: [
          CONSTANTS.SERVICE_UUID,
          CONSTANTS.DEVICE_INFO_SERVICE,
          CONSTANTS.BATTERY_SERVICE,
          CONSTANTS.CUSTOM_BATTERY_SERVICE,
        ],
      });

      log(`Gerät gefunden: ${AppState.device.name || "(Name unbekannt)"}. Verbinde...`, "info");
      setDeviceListHint([AppState.device.name || "Coyote"]);
      setReconnectStatus("GATT-Verbindung wird aufgebaut…");

      // Avoid stacking disconnect listeners across reconnects
      if (onGattDisconnected && AppState.device) {
        try {
          AppState.device.removeEventListener("gattserverdisconnected", onGattDisconnected);
        } catch {
          /* ignore */
        }
      }
      onGattDisconnected = onDisconnected;
      AppState.device.addEventListener("gattserverdisconnected", onGattDisconnected);

      // Reconnect path if OS already has a handle
      if (AppState.device.gatt.connected) {
        log("GATT war noch verbunden – nutze bestehende Session.", "info");
      } else {
        AppState.server = await AppState.device.gatt.connect();
      }
      AppState.server = AppState.device.gatt;
      log("GATT Server verbunden. Suche Services...", "info");

      const service = await AppState.server.getPrimaryService(CONSTANTS.SERVICE_UUID);
      log("E-Stim Steuer-Service geladen.", "info");

      AppState.writeChar = await service.getCharacteristic(CONSTANTS.WRITE_UUID);
      AppState.notifyChar = await service.getCharacteristic(CONSTANTS.NOTIFY_UUID);

      await AppState.notifyChar.startNotifications();
      AppState.notifyChar.addEventListener("characteristicvaluechanged", handleDeviceNotification);

      try {
        const deviceInfoService = await AppState.server.getPrimaryService(
          CONSTANTS.DEVICE_INFO_SERVICE
        );
        AppState.batteryChar = await deviceInfoService.getCharacteristic(CONSTANTS.BATTERY_UUID);
        log("Batterie in Device Information (V3) gefunden.", "info");
      } catch (e1) {
        try {
          AppState.batteryChar = await service.getCharacteristic(CONSTANTS.BATTERY_UUID);
          log("Batterie auf Haupt-Service gefunden.", "info");
        } catch (e2) {
          try {
            const customService = await AppState.server.getPrimaryService(
              CONSTANTS.CUSTOM_BATTERY_SERVICE
            );
            AppState.batteryChar = await customService.getCharacteristic(CONSTANTS.BATTERY_UUID);
            log("Custom Batterie-Service gefunden.", "info");
          } catch (e3) {
            try {
              const stdService = await AppState.server.getPrimaryService(CONSTANTS.BATTERY_SERVICE);
              AppState.batteryChar = await stdService.getCharacteristic("battery_level");
              log("Standard Batterie-Service gefunden.", "info");
            } catch (e4) {
              console.warn("Battery service not available on this device:", e4);
            }
          }
        }
      }

      if (DOM["info-device-name"])
        DOM["info-device-name"].textContent = AppState.device.name || "Coyote 3.0";
      try {
        const deviceInfoService = await AppState.server.getPrimaryService(
          CONSTANTS.DEVICE_INFO_SERVICE
        );
        try {
          const allChars = await deviceInfoService.getCharacteristics();
          allChars.forEach((c) => log(`Gefundene Info-Charakteristik: ${c.uuid}`, "info"));
        } catch (e) {
          console.warn("Could not enumerate device info characteristics:", e);
        }

        const tryReadHex = async (uuid, elementId) => {
          try {
            const char = await deviceInfoService.getCharacteristic(uuid);
            const val = await char.readValue();
            const bytes = new Uint8Array(val.buffer);
            const hex = Array.from(bytes)
              .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
              .join(":");
            if (DOM[elementId]) DOM[elementId].textContent = hex || "Leer";
          } catch (e) {
            console.warn(`Could not read device info ${uuid}:`, e);
            if (DOM[elementId]) DOM[elementId].textContent = "Nicht verfügbar";
          }
        };

        await tryReadHex(CONSTANTS.DEVICE_INFO_MANUFACTURER, "info-manufacturer");
        await tryReadHex(CONSTANTS.DEVICE_INFO_FIRMWARE, "info-firmware");
        await tryReadHex(CONSTANTS.DEVICE_INFO_HARDWARE, "info-hardware");
      } catch (e) {
        log("Ger\u00e4te-Informationen nicht abrufbar.", "warning");
        if (DOM["info-manufacturer"]) DOM["info-manufacturer"].textContent = "Nicht abrufbar";
        if (DOM["info-firmware"]) DOM["info-firmware"].textContent = "Nicht abrufbar";
        if (DOM["info-hardware"]) DOM["info-hardware"].textContent = "Nicht abrufbar";
      }

      log("Abonniere Bluetooth-Notifications...", "info");

      if (AppState.batteryChar) {
        try {
          await AppState.batteryChar.startNotifications();
          AppState.batteryChar.addEventListener("characteristicvaluechanged", (e) => {
            const val = new Uint8Array(e.target.value.buffer);
            AppState.batteryLevel = val[0];
            updateBatteryUI(AppState.batteryLevel);
          });
          log("Abonnement f\u00fcr Akku-Meldungen aktiv.", "info");
        } catch (subErr) {
          console.warn(
            "Konnte Akku-Benachrichtigungen nicht aktivieren, verwende nur Read:",
            subErr
          );
        }
        await readBatteryStatus();
        clearBatteryPolling();
        AppState.batteryIntervalId = setInterval(
          readBatteryStatus,
          CONSTANTS.BATTERY_READ_INTERVAL_MS
        );
      }

      AppState.isConnected = true;
      AppState.reconnectAttempts = 0;
      AppState.lastB1Time = Date.now();
      resetSignalLossFlag();
      armSignalLossWatcher(() => {
        try {
          forceReleaseAll("signal-loss");
        } catch {
          /* ignore */
        }
      });
      trackStat("connection");
      log("Erfolgreich mit Coyote 3.0 verbunden!", "success");
      // F3: auto-load the assigned profile on connect.
      try {
        maybeAutoLoadAssignedProfile();
      } catch {
        /* optional */
      }
      setReconnectStatus("");
      setDeviceListHint([AppState.device?.name || "Coyote 3.0 · verbunden"]);

      if (DOM["connection-text"]) DOM["connection-text"].textContent = "Verbunden";
      if (DOM["connection-indicator"])
        DOM["connection-indicator"].className = "status-indicator connected";
      if (DOM["btn-connect"]) DOM["btn-connect"].style.display = "none";
      if (DOM["btn-disconnect"]) DOM["btn-disconnect"].style.display = "block";

      if (window.electronAPI && typeof window.electronAPI.setConnected === "function") {
        window.electronAPI.setConnected(true);
      }

      // V3 Protocol: Send 0xBF limit init packet
      sendV3Init();

      // Initialize strength to 0 with absolute mode
      AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;

      startWaveLoop();
      updateOutputStatus();
    } catch (err) {
      const friendly = friendlyBtError(err);
      log(friendly, "error");
      setReconnectStatus(friendly);
      setDeviceListHint([]);
      // Best-effort cleanup if half-connected
      try {
        if (AppState.device?.gatt?.connected) {
          AppState.device.gatt.disconnect();
        }
      } catch {
        /* ignore */
      }
      resetUIOnDisconnect();
    } finally {
      connectInProgress = false;
    }
  });

  const btnDisconnect = el("btn-disconnect");
  if (btnDisconnect && btnDisconnect.dataset.btWired !== "1") {
    btnDisconnect.dataset.btWired = "1";
    btnDisconnect.addEventListener("click", () => {
      if (AppState.device && AppState.device.gatt && AppState.device.gatt.connected) {
        log("Trenne Verbindung manuell...", "info");
        clearReconnect();
        manualDisconnect = true;
        AppState.device.gatt.disconnect();
      } else {
        resetUIOnDisconnect();
        log("Kein aktives Gerät zum Trennen.", "info");
      }
    });
  }
}

function wireBluetoothUi() {
  // Ensure cache is warm (order-safe even if other handlers race)
  try {
    if (!DOM["btn-connect"]) initDOMCache();
  } catch {
    /* ignore */
  }

  el("check-swap-channels")?.addEventListener("change", (e) => {
    AppState.swapChannels = e.target.checked;
    log(`Kanäle tauschen: ${AppState.swapChannels ? "Aktiv" : "Inaktiv"}`, "info");
  });

  el("check-debug-mode")?.addEventListener("change", (e) => {
    AppState.debugMode = e.target.checked;
    log(`Debug-Mode (BLE Hex-Dump): ${AppState.debugMode ? "Aktiv" : "Inaktiv"}`, "info");
  });

  wireConnectButton();
  console.info("[bluetooth] Connect/Disconnect buttons wired");
}

// Module scripts are deferred: if DOM is already ready, wire immediately.
// Otherwise wait for DOMContentLoaded. Prefer getElementById so we don't
// depend on DOM-cache order (initDOMCache must run first or we fall back).
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireBluetoothUi, { once: true });
  } else {
    wireBluetoothUi();
  }
}
