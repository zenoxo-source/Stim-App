// fast-wire.js — 25 ms micro wire path ("Wellenform-Shaping 2.0", v5.1).
//
// The wave loop keeps computing the base step at 100 ms; while the fast path
// is active, that base is only STORED and this module re-emits the signal at
// up to 40 Hz with shaping applied (pulse shapes, dithering, detune, beat
// sequences, crossfades). BLE writes are fire-and-forget with a single-slot
// queue; when a write is still in flight the frame is dropped (coalescing) —
// the effective rate adapts to the adapter automatically.

import { AppState, log } from "../state.js";
import { sendB0Now } from "./bluetooth.js";
import {
  sanitiseWireShaping,
  DEFAULT_WIRE_SHAPING,
  PULSE_SHAPES,
  pulseStep,
  applyDither,
  detuneFreqs,
  blendStep,
  beatStep,
  applyVibrato,
} from "../lib/wire-shaping.js";

const WIRE_CFG_KEY = "wireShapingCfg";
const FAST_MS = 25;

let cfg = { ...DEFAULT_WIRE_SHAPING };
let fastTimer = null;

// Metrics (updated once per second).
const metrics = { writes: 0, skips: 0, lastWrites: 0, lastSkips: 0, lastReset: 0 };

// Crossfade state.
let fade = { from: null, to: null, t0: 0, until: 0 };

export function loadWireShapingCfg() {
  try {
    const raw = localStorage.getItem(WIRE_CFG_KEY);
    cfg = sanitiseWireShaping(raw ? JSON.parse(raw) : {});
  } catch {
    cfg = sanitiseWireShaping({});
  }
  return cfg;
}

export function saveWireShapingCfg(patch = {}) {
  cfg = sanitiseWireShaping({ ...cfg, ...patch });
  try {
    localStorage.setItem(WIRE_CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
  return cfg;
}

export function getWireShapingCfg() {
  return cfg;
}

export function isFastWireActive() {
  return fastTimer !== null;
}

/** True when the fast path should take over the wire. */
export function fastWireShouldRun() {
  return cfg.fastEnabled || cfg.beatMode;
}

/**
 * Called by the wave loop instead of sending: hands the latest base step to
 * the fast path. stamp identifies the source (pattern/phase) for crossfades.
 * @param {{fA:number,aA:number,fB:number,aB:number}} step
 * @param {string} stamp
 */
export function setShapingBase(step, stamp) {
  if (!step) return;
  AppState._shapingBase = { ...step, stamp, t: Date.now() };
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function fastTick() {
  if (!AppState.isConnected || !AppState.writeChar) {
    stopFastWire();
    return;
  }
  if (AppState.isBluetoothWriting || AppState.pendingWaveformData) {
    metrics.skips += 1; // write still in flight → coalesce this frame
    return;
  }
  const base = AppState._shapingBase;
  if (!base) return;

  const now = Date.now();
  let step = { fA: base.fA, aA: base.aA, fB: base.fB, aB: base.aB };

  // Crossfade on source change (pattern/phase switch).
  if (cfg.crossfadeMs > 0) {
    if (fade.to && fade.to.stamp === base.stamp && now < fade.until) {
      const p = (now - fade.t0) / (fade.until - fade.t0);
      step = blendStep(fade.from, fade.to, p);
    } else if (!fade.to || fade.to.stamp !== base.stamp) {
      if (fade.to && fade.to.stamp !== base.stamp) {
        fade = { from: fade.to, to: base, t0: now, until: now + cfg.crossfadeMs };
      } else if (!fade.from) {
        fade = { from: base, to: base, t0: now, until: now + cfg.crossfadeMs };
      }
      if (fade.to && now < fade.until) {
        const p = (now - fade.t0) / (fade.until - fade.t0);
        step = blendStep(fade.from, fade.to, p);
      }
    } else {
      fade = { from: base, to: base, t0: now, until: now + cfg.crossfadeMs };
    }
  }

  // Beat mode overrides amplitudes with the rhythmic sequence — but only
  // while the base is live (never fire during silence/COOLDOWN).
  if (cfg.beatMode && (base.aA > 0 || base.aB > 0)) {
    const b = beatStep(cfg.beatPattern, cfg.beatBpm, now, cfg.beatBaseAmp);
    step.aA = b.aA;
    step.aB = b.aB;
  }

  // Pulse shapes (per channel).
  if (PULSE_SHAPES[cfg.shapeA] && cfg.shapeA !== "none") {
    step.aA = pulseStep(PULSE_SHAPES[cfg.shapeA], now, step.aA);
  }
  if (PULSE_SHAPES[cfg.shapeB] && cfg.shapeB !== "none") {
    step.aB = pulseStep(PULSE_SHAPES[cfg.shapeB], now, step.aB);
  }

  // Anti-habituation dithering.
  if (cfg.dither > 0) {
    step.aA = applyDither(step.aA, cfg.dither, now & 0xffff);
    step.aB = applyDither(step.aB, cfg.dither, (now & 0xffff) ^ 0x9e37);
  }

  // Detune beats (B runs at A+detune Hz).
  if (cfg.detuneHz > 0) {
    const d = detuneFreqs(step.fA, step.fB, cfg.detuneHz);
    step.fA = d.fA;
    step.fB = d.fB;
  }

  // F22: frequency vibrato (micro-freq texture on both channels).
  if (cfg.freqVibrato && cfg.freqVibrato !== "none") {
    const v = applyVibrato(step.fA, step.fB, cfg.freqVibrato, now);
    step.fA = v.fA;
    step.fB = v.fB;
  }

  sendB0Now(step.fA, step.aA, step.fB, step.aB, { force: true, writer: "fast-wire" });
  metrics.writes += 1;
}

export function startFastWire() {
  if (fastTimer) return;
  if (!AppState.isConnected) return;
  fade = { from: null, to: null, t0: 0, until: 0 };
  metrics.lastReset = Date.now();
  fastTimer = setInterval(fastTick, FAST_MS);
  log("Fast-Wire aktiv (25 ms) — Shaping/Beat übernimmt den Signalweg.", "info");
}

export function stopFastWire() {
  if (!fastTimer) return;
  clearInterval(fastTimer);
  fastTimer = null;
  AppState._shapingBase = null;
}

/** Sync start/stop with the current config + connection state. */
export function syncFastWire() {
  if (fastWireShouldRun() && AppState.isConnected) {
    startFastWire();
  } else {
    stopFastWire();
  }
}

// ---------------------------------------------------------------------------
// UI + metrics
// ---------------------------------------------------------------------------

function paintMetrics() {
  const el = document.getElementById("wire-metrics");
  if (!el) return;
  const now = Date.now();
  if (!metrics.lastReset) metrics.lastReset = now;
  const dt = (now - metrics.lastReset) / 1000;
  if (dt >= 1) {
    metrics.lastWrites = metrics.writes;
    metrics.lastSkips = metrics.skips;
    metrics.writes = 0;
    metrics.skips = 0;
    metrics.lastReset = now;
  }
  const total = metrics.lastWrites + metrics.lastSkips;
  const skipPct = total > 0 ? Math.round((metrics.lastSkips / total) * 100) : 0;
  el.textContent = isFastWireActive()
    ? `Fast-Wire: ${metrics.lastWrites} Writes/s (Ziel 40) · ${skipPct} % übersprungen · Beat ${cfg.beatMode ? `${cfg.beatBpm} BPM` : "aus"}`
    : "Fast-Wire: aus";
}

export function initFastWire() {
  loadWireShapingCfg();
  if (typeof document === "undefined") return;
  // Only run in the real app shell (dom-mock in tests has no settings card —
  // persistent intervals would keep the test process alive forever).
  if (!document.getElementById("wire-metrics")) return;

  const sync = () => syncFastWire();
  const readCfg = () => {
    const el = (id) => document.getElementById(id);
    saveWireShapingCfg({
      fastEnabled: el("ws-fast")?.checked,
      shapeA: el("ws-shape-a")?.value || "none",
      shapeB: el("ws-shape-b")?.value || "none",
      dither: parseFloat(el("ws-dither")?.value) || 0,
      detuneHz: parseFloat(el("ws-detune")?.value) || 0,
      crossfadeMs: parseInt(el("ws-crossfade")?.value, 10) || 0,
      beatMode: el("ws-beat")?.checked,
      beatBpm: parseInt(el("ws-beat-bpm")?.value, 10) || 120,
      beatPattern: el("ws-beat-pattern")?.value || "throb",
      beatBaseAmp: parseInt(el("ws-beat-baseamp")?.value, 10) || 70,
      freqVibrato: el("ws-freq-vibrato")?.value || "none",
    });
    sync();
  };

  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(v);
  };
  set("ws-fast", cfg.fastEnabled ? "on" : "off");
  set("ws-shape-a", cfg.shapeA);
  set("ws-shape-b", cfg.shapeB);
  set("ws-dither", cfg.dither);
  set("ws-detune", cfg.detuneHz);
  set("ws-crossfade", cfg.crossfadeMs);
  set("ws-freq-vibrato", cfg.freqVibrato);
  document.getElementById("ws-fast")?.addEventListener("change", readCfg);
  document.getElementById("ws-shape-a")?.addEventListener("change", readCfg);
  document.getElementById("ws-shape-b")?.addEventListener("change", readCfg);
  document.getElementById("ws-dither")?.addEventListener("change", readCfg);
  document.getElementById("ws-detune")?.addEventListener("change", readCfg);
  document.getElementById("ws-crossfade")?.addEventListener("change", readCfg);
  document.getElementById("ws-freq-vibrato")?.addEventListener("change", readCfg);

  // Beat section.
  const tapTimes = [];
  document.getElementById("btn-beat-tap")?.addEventListener("click", () => {
    tapTimes.push(Date.now());
    if (tapTimes.length > 6) tapTimes.shift();
    const bpm = bpmFromTapsLocal(tapTimes);
    if (bpm) {
      saveWireShapingCfg({ beatBpm: bpm });
      const bpmEl = document.getElementById("ws-beat-bpm");
      if (bpmEl) bpmEl.value = String(bpm);
      const lab = document.getElementById("beat-bpm-label");
      if (lab) lab.textContent = `${bpm} BPM`;
      sync();
    }
  });
  document.getElementById("ws-beat-bpm")?.addEventListener("change", readCfg);
  document.getElementById("ws-beat-pattern")?.addEventListener("change", readCfg);
  document.getElementById("ws-beat-baseamp")?.addEventListener("change", readCfg);
  document.getElementById("ws-beat")?.addEventListener("change", () => {
    const on = !!document.getElementById("ws-beat")?.checked;
    saveWireShapingCfg({ beatMode: on });
    if (on && !cfg.fastEnabled) {
      saveWireShapingCfg({ fastEnabled: true });
      const el = document.getElementById("ws-fast");
      if (el) el.checked = true;
    }
    sync();
  });

  setInterval(paintMetrics, 1000);
  setInterval(sync, 2000);
  sync();
}

function bpmFromTapsLocal(tapsMs) {
  const intervals = [];
  for (let i = 1; i < tapsMs.length; i++) {
    const d = tapsMs[i] - tapsMs[i - 1];
    if (d > 150 && d < 2500) intervals.push(d);
  }
  if (intervals.length === 0) return null;
  return Math.round(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length));
}

// On disconnect, stop the fast loop (bluetooth calls this via sync).
export { bpmFromTapsLocal };

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFastWire, { once: true });
  } else {
    initFastWire();
  }
}
