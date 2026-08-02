// heart-rate.js — BLE heart-rate biofeedback (Polar H10 & compatible).
//
// Connects a standard BLE Heart Rate device (service 0x180D / char 0x2A37),
// streams HR values, computes a per-session baseline and — when Autodrive
// runs with hrAdaptive enabled — feeds the engine with "almost"/"good"
// feedback derived from real arousal (rate-limited, safe).

import { log } from "../state.js";
import { isAutodriveActive, getAutodriveState, injectFeedback } from "./autodrive.js";

const HEART_RATE_SERVICE = "heart_rate"; // 0x180D
const HEART_RATE_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";

let device = null;
let hrCharacteristic = null;
let connected = false;
let currentHr = 0;
const samples = [];
let baseline = 0;
let baselineReady = false;
let lastAutoInjectAt = 0;
let lastHrAt = 0;
const listeners = new Set();

function notifyListeners() {
  const payload = { hr: currentHr, connected, baseline, baselineReady };
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

/** @param {(p: {hr: number, connected: boolean, baseline: number, baselineReady: boolean}) => void} fn */
export function onHeartRateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isHeartRateConnected() {
  return connected;
}

export function getHeartRate() {
  return currentHr;
}

export function getHrBaseline() {
  return baselineReady ? baseline : 0;
}

function parseHeartRate(value) {
  const data = new Uint8Array(value.buffer || value);
  if (data.length < 2) return 0;
  const flags = data[0];
  const is16 = flags & 0x01;
  return is16 ? data[1] | (data[2] << 8) : data[1];
}

function recordSample(hr) {
  currentHr = hr;
  lastHrAt = Date.now();
  samples.push(hr);
  if (samples.length > 60) samples.shift();
  // Baseline = median of the first 30 samples (~30–60 s).
  if (!baselineReady && samples.length >= 30) {
    const sorted = [...samples].sort((a, b) => a - b);
    baseline = sorted[Math.floor(sorted.length / 2)];
    baselineReady = true;
    log(`HR-Baseline: ${baseline} bpm.`, "info");
  }
  notifyListeners();
}

/** Connect to a BLE heart-rate monitor. */
export async function connectHeartRate() {
  if (connected) return { ok: true, hr: currentHr };
  if (typeof navigator === "undefined" || !navigator.bluetooth?.requestDevice) {
    return { ok: false, error: "Web Bluetooth nicht verfügbar." };
  }
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE] }],
      optionalServices: [HEART_RATE_SERVICE],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    hrCharacteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    await hrCharacteristic.startNotifications();
    hrCharacteristic.addEventListener("characteristicvaluechanged", (e) => {
      recordSample(parseHeartRate(e.target.value));
    });
    connected = true;
    device.addEventListener("gattserverdisconnected", () => {
      connected = false;
      device = null;
      hrCharacteristic = null;
      currentHr = 0;
      notifyListeners();
      log("HR-Sensor getrennt.", "warning");
    });
    log("Herzfrequenz-Sensor verbunden.", "success");
    notifyListeners();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function disconnectHeartRate() {
  try {
    device?.gatt?.disconnect();
  } catch {
    /* ignore */
  }
  connected = false;
  device = null;
  hrCharacteristic = null;
  currentHr = 0;
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Autodrive adaptation: HR rise → "almost" (edge boost), HR drop → "good".
// ---------------------------------------------------------------------------

const AUTO_INJECT_MIN_GAP_MS = 20000;
const AUTO_PHASES = new Set(["TEASE", "EDGE_HOLD", "SURGE", "BUILD"]);

function hrMonitorTick() {
  if (!connected || !baselineReady) return;
  if (!isAutodriveActive()) return;
  const cfg = getAutodriveState()?.config;
  if (!cfg || cfg.hrAdaptive !== true) return;
  const phase = getAutodriveState()?.phase;
  if (!AUTO_PHASES.has(phase)) return;

  const now = Date.now();
  if (now - lastAutoInjectAt < AUTO_INJECT_MIN_GAP_MS) return;
  if (now - lastHrAt > 15000) return; // stale signal — don't act

  const delta = currentHr - baseline;
  if (delta >= 14) {
    // Strong arousal → confirm the edge is close.
    lastAutoInjectAt = now;
    injectFeedback("almost");
    log(`HR-Biofeedback: ${currentHr} bpm (+${delta}) → „fast"`, "info");
  } else if (delta <= -8 && phase === "BUILD") {
    // Relaxed → gentle nudge up.
    lastAutoInjectAt = now;
    injectFeedback("good");
    log(`HR-Biofeedback: ${currentHr} bpm (${delta}) → „gut"`, "info");
  }
}

// 2 s monitor loop.
setInterval(hrMonitorTick, 2000);

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function updateHrUi() {
  const status = document.getElementById("hr-status");
  const chip = document.getElementById("ad-fs-hr");
  if (status) {
    status.textContent = connected
      ? `Verbunden · ${currentHr} bpm${baselineReady ? ` (Baseline ${baseline})` : " (Baseline wird ermittelt…)"}`
      : "Getrennt";
    const btn = document.getElementById("btn-hr-connect");
    if (btn) btn.textContent = connected ? "Trennen" : "📡 HR-Gurt verbinden";
  }
  if (chip) {
    chip.style.display = connected ? "inline" : "none";
    chip.textContent = connected ? `❤ ${currentHr} bpm` : "";
  }
}

if (typeof document !== "undefined") {
  const wire = () => {
    document.getElementById("btn-hr-connect")?.addEventListener("click", async () => {
      if (isHeartRateConnected()) {
        disconnectHeartRate();
        updateHrUi();
        return;
      }
      const r = await connectHeartRate();
      if (!r.ok) log(`HR-Sensor: ${r.error}`, "error");
      updateHrUi();
    });
    onHeartRateChange(updateHrUi);
    updateHrUi();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
}
