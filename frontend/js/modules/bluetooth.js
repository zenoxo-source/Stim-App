// bluetooth.js - BLE connection and V3 protocol for DG-LAB Coyote 3.0
// Based on DG-Kit reference implementation (github.com/0xNullAI/DG-Kit)
import { AppState, DOM, log, CONSTANTS } from "../state.js";
import * as ProtocolUtils from "../lib/protocol-utils.js";
import { updateAIDashboard, startWaveLoop, stopWaveLoop } from "../control-deck.js";
import { updateOutputStatus } from "./status-ui.js";
import { trackStat } from "./stats.js";
import { unlockAchievement } from "./fun.js";
import {
  blockDuringPanicCooldown,
  clampStrengthWithCeiling,
  noteGattActivity,
  armSignalLossWatcher,
  disarmSignalLossWatcher,
  resetSignalLossFlag,
} from "./safety-extras.js";
import { blockIfLocked as blockIfPinLocked } from "./session-pin.js";

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

  // Pulse-width sliders scale logical wave amplitude (0–100%)
  const logicalA = ProtocolUtils.applyPulseWidthScale(ampA, AppState.pulseWidthA);
  const logicalB = ProtocolUtils.applyPulseWidthScale(ampB, AppState.pulseWidthB);

  // Master scale on wave amplitudes
  const scaledA = ProtocolUtils.scaleWaveAmp(logicalA, AppState.masterScale);
  const scaledB = ProtocolUtils.scaleWaveAmp(logicalB, AppState.masterScale);

  let segA = ProtocolUtils.resolveWaveSegment(freqA, scaledA);
  let segB = ProtocolUtils.resolveWaveSegment(freqB, scaledB);

  if (AppState.swapChannels) {
    const tmpSeg = segA;
    segA = segB;
    segB = tmpSeg;
  }

  // Track last-sent values for isDirty (Fix 5)
  AppState.lastWaveFreqA = segA.freq;
  AppState.lastWaveAmpA = segA.intensity === 101 ? 0 : segA.intensity;
  AppState.lastWaveFreqB = segB.freq;
  AppState.lastWaveAmpB = segB.intensity === 101 ? 0 : segB.intensity;

  // Determine if strength changed (pending mode)
  let mode = 0;
  let seq = 0;
  if (!AppState.btAwaitingAck && AppState.btPendingMode !== 0 && !o.keepStrength) {
    AppState.btSeq = AppState.btSeq >= 15 ? 1 : AppState.btSeq + 1;
    seq = AppState.btSeq;
    mode = AppState.btPendingMode;
    AppState.btAwaitingAck = true;
    AppState.btPendingMode = 0;
    // Fallback: clear awaitingAck after timeout if no matching ACK arrives
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

  // Fix 5: isDirty — skip if nothing changed
  const strA = getDeviceStrength(AppState.strengthA, AppState.softLimitA);
  const strB = getDeviceStrength(AppState.strengthB, AppState.softLimitB);
  if (
    !o.keepStrength &&
    mode === 0 &&
    AppState._lastSentStrA === strA &&
    AppState._lastSentStrB === strB &&
    AppState._lastSentFreqA === segA.freq &&
    AppState._lastSentAmpA === segA.intensity &&
    AppState._lastSentFreqB === segB.freq &&
    AppState._lastSentAmpB === segB.intensity
  ) {
    return;
  }
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
    ProtocolUtils.fillChannelWave(data, 4, 8, segA.freq, segA.intensity);
    ProtocolUtils.fillChannelWave(data, 12, 16, segB.freq, segB.intensity);
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

export function sendStrengthCommand(valA, valB) {
  if (!AppState.writeChar) return;
  if (blockDuringPanicCooldown("Strength-Befehl")) return;
  if (blockIfPinLocked("Strength-Befehl")) return;

  // Keep AppState as logical (UI) values; do not bake masterScale into state.
  // Apply panic-cooldown + active pattern/ramp ceiling.
  AppState.strengthA = clampStrengthWithCeiling(valA, "A");
  AppState.strengthB = clampStrengthWithCeiling(valB, "B");
  AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;

  // Immediately send combined B0 with current waveform values
  const fA = AppState.activePattern
    ? AppState.lastWaveFreqA || AppState.frequencyA
    : AppState.frequencyA;
  const fB = AppState.activePattern
    ? AppState.lastWaveFreqB || AppState.frequencyB
    : AppState.frequencyB;
  const aA = AppState.activePattern ? AppState.lastWaveAmpA || 0 : 100;
  const aB = AppState.activePattern ? AppState.lastWaveAmpB || 0 : 100;
  sendB0Now(fA, aA, fB, aB);
}

export function sendWaveformCommand(freqA, ampA, freqB, ampB) {
  // Delegate to unified B0 sender
  sendB0Now(freqA, ampA, freqB, ampB);
}

/**
 * Soft-stop: inactive waveforms (freq 0, intensity 101).
 * @param {{ keepStrength?: boolean, zeroUiStrength?: boolean }} opts
 *   keepStrength: leave channel strength as-is (for short gaps between pulses)
 *   zeroUiStrength: also set AppState/UI strength to 0 (pattern stop etc.)
 */
export function sendSoftStop(opts = {}) {
  if (!AppState.writeChar) return;
  const keepStrength = !!opts.keepStrength;
  const zeroUi = !!opts.zeroUiStrength;

  if (zeroUi) {
    AppState.strengthA = 0;
    AppState.strengthB = 0;
  }

  const strA = keepStrength ? getDeviceStrength(AppState.strengthA, AppState.softLimitA) : 0;
  const strB = keepStrength ? getDeviceStrength(AppState.strengthB, AppState.softLimitB) : 0;

  const data = ProtocolUtils.buildSoftStopBytes({
    strengthA: strA,
    strengthB: strB,
    modeNibble: keepStrength ? 0 : 0x0f,
  });

  debugHex("B0-soft-stop", data);

  AppState.lastWaveAmpA = 0;
  AppState.lastWaveAmpB = 0;
  AppState.lastWaveFreqA = 0;
  AppState.lastWaveFreqB = 0;
  // Reset dirty tracking so next send isn't skipped
  AppState._lastSentFreqA = 0;
  AppState._lastSentAmpA = 0;
  AppState._lastSentFreqB = 0;
  AppState._lastSentAmpB = 0;

  if (!keepStrength) {
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
  AppState.lastWaveAmpA = 0;
  AppState.lastWaveAmpB = 0;
  AppState._lastSentStrA = 0;
  AppState._lastSentStrB = 0;

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

function handleDeviceNotification(event) {
  const value = event.target.value;
  const data = new Uint8Array(value.buffer);

  if (data[0] === 0xb1 && data.length >= 4) {
    AppState.lastB1Time = Date.now();
    noteGattActivity();
    const ackSeq = data[1];
    const deviceStrA = data[2];
    const deviceStrB = data[3];
    debugHex("B1-recv", data);

    // ACK for our own B0 strength change — clear awaitingAck
    if (AppState.btAwaitingAck && ackSeq === AppState.btSeq) {
      AppState.btAwaitingAck = false;
      AppState.btSeq = 0;
      // Our own change was applied — AppState already has the correct values
      return;
    }

    // External strength change (e.g. physical wheel on the device).
    // Update AppState and UI to match the device-reported strength.
    if (deviceStrA !== AppState.strengthA || deviceStrB !== AppState.strengthB) {
      log(`Ger\u00e4t-Strength extern ge\u00e4ndert: A=${deviceStrA} B=${deviceStrB}`, "info");
      AppState.strengthA = deviceStrA;
      AppState.strengthB = deviceStrB;
      if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = deviceStrA;
      if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = deviceStrA;
      if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = deviceStrA;
      if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = deviceStrB;
      if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = deviceStrB;
      if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = deviceStrB;
      updateAIDashboard();
      updateOutputStatus();
    }
  }
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
  if (/User cancelled|NotFoundError|canceled/i.test(msg)) {
    return "Verbindung abgebrochen – kein Gerät ausgewählt.";
  }
  if (/NetworkError|GATT Server is disconnected/i.test(msg)) {
    return "Bluetooth-Verbindung unterbrochen (GATT). Bitte erneut verbinden.";
  }
  if (/SecurityError|NotAllowedError/i.test(msg)) {
    return "Bluetooth-Zugriff verweigert. Berechtigung prüfen und erneut versuchen.";
  }
  if (/Unsupported|NotSupportedError/i.test(msg)) {
    return "Web Bluetooth wird hier nicht unterstützt.";
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
  AppState.isConnected = false;
  AppState.writeChar = null;
  AppState.notifyChar = null;
  AppState.batteryChar = null;
  AppState.btSeq = 0;
  AppState.btAwaitingAck = false;
  AppState.btPendingMode = 0;
  AppState.lastB1Time = 0;
  AppState.lastGattActivity = 0;
  AppState._lastSentStrA = undefined;
  AppState._lastSentStrB = undefined;
  AppState._lastSentFreqA = undefined;
  AppState._lastSentFreqB = undefined;
  AppState._lastSentAmpA = undefined;
  AppState._lastSentAmpB = undefined;
  clearBatteryPolling();
  stopWaveLoop();
  disarmSignalLossWatcher();

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

document.addEventListener("DOMContentLoaded", () => {
  DOM["check-swap-channels"]?.addEventListener("change", (e) => {
    AppState.swapChannels = e.target.checked;
    log(`Kan\u00e4le tauschen: ${AppState.swapChannels ? "Aktiv" : "Inaktiv"}`, "info");
  });

  // Fix 8: Debug mode toggle
  DOM["check-debug-mode"]?.addEventListener("change", (e) => {
    AppState.debugMode = e.target.checked;
    log(`Debug-Mode (BLE Hex-Dump): ${AppState.debugMode ? "Aktiv" : "Inaktiv"}`, "info");
  });

  DOM["btn-connect"]?.addEventListener("click", async () => {
    if (!navigator.bluetooth) {
      log("Web Bluetooth wird von diesem System/Browser nicht unterst\u00fctzt.", "error");
      return;
    }

    clearReconnect();

    log("Suche nach DG-LAB Coyote 3.0...", "info");
    if (DOM["connection-text"]) DOM["connection-text"].textContent = "Suche...";
    if (DOM["connection-indicator"])
      DOM["connection-indicator"].className = "status-indicator connecting";
    setReconnectStatus("Bluetooth-Suche läuft…");
    setDeviceListHint([`Filter: Prefix ${CONSTANTS.COYOTE_NAME_PREFIX} / „coyote“`]);

    try {
      AppState.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: CONSTANTS.COYOTE_NAME_PREFIX }],
        optionalServices: [
          CONSTANTS.SERVICE_UUID,
          CONSTANTS.DEVICE_INFO_SERVICE,
          CONSTANTS.BATTERY_SERVICE,
          CONSTANTS.CUSTOM_BATTERY_SERVICE,
        ],
      });

      log(`Ger\u00e4t gefunden: ${AppState.device.name}. Verbinde...`, "info");
      setDeviceListHint([AppState.device.name || "Coyote"]);
      setReconnectStatus("GATT-Verbindung wird aufgebaut…");

      AppState.device.addEventListener("gattserverdisconnected", onDisconnected);

      AppState.server = await AppState.device.gatt.connect();
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
      armSignalLossWatcher();
      trackStat("connection");
      log("Erfolgreich mit Coyote 3.0 verbunden!", "success");
      unlockAchievement("first_connect");
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
      resetUIOnDisconnect();
    }
  });

  DOM["btn-disconnect"]?.addEventListener("click", () => {
    if (AppState.device && AppState.device.gatt && AppState.device.gatt.connected) {
      log("Trenne Verbindung manuell...", "info");
      clearReconnect();
      AppState.device.gatt.disconnect();
    }
  });
});
