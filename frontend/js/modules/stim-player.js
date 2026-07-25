// stim-player.js — Advanced audio→stim engine (XToys-inspired mapping).
// Pure-ish helpers + config; used by audio.js + control-deck wave loop.

import { AppState } from "../state.js";
import * as ProtocolUtils from "../lib/protocol-utils.js";

const STIM_CFG_KEY = "stim_app_stim_player_v1";

/** @typedef {"spectrum"|"fixed"|"with_intensity"|"inverse_intensity"} StimFreqMode */
/** @typedef {"stereo"|"mono_l"|"mono_r"|"mono_sum"} StimChannelMode */

export const STIM_DEFAULTS = Object.freeze({
  sensitivityA: 1.2,
  sensitivityB: 1.2,
  /** Map audio level 0..1 → strength within soft limits */
  strengthDrive: true,
  strengthMin: 15,
  strengthMax: 80,
  /** Wave amplitude range 0..100 */
  waveAmpMin: 15,
  waveAmpMax: 100,
  freqMode: /** @type {StimFreqMode} */ ("spectrum"),
  freqFixed: 45,
  freqMin: 25,
  freqMax: 110,
  channelMode: /** @type {StimChannelMode} */ ("stereo"),
  /** EMA smoothing 0..0.95 (higher = smoother, more lag) */
  smoothing: 0.4,
  loop: false,
  shuffle: false,
  baseStrength: 40,
  gateThreshold: 0.04,
});

/**
 * @returns {typeof STIM_DEFAULTS}
 */
export function loadStimConfig() {
  try {
    const raw = localStorage.getItem(STIM_CFG_KEY);
    if (!raw) return { ...STIM_DEFAULTS };
    const p = JSON.parse(raw);
    return sanitiseStimConfig({ ...STIM_DEFAULTS, ...p });
  } catch {
    return { ...STIM_DEFAULTS };
  }
}

/**
 * @param {Partial<typeof STIM_DEFAULTS>} patch
 */
export function saveStimConfig(patch = {}) {
  const merged = sanitiseStimConfig({ ...loadStimConfig(), ...patch });
  try {
    localStorage.setItem(STIM_CFG_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/**
 * @param {object} input
 */
export function sanitiseStimConfig(input) {
  const d = { ...STIM_DEFAULTS };
  if (!input || typeof input !== "object") return d;
  const n = (v, lo, hi, fb) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fb;
  };
  d.sensitivityA = n(input.sensitivityA, 0.3, 4, d.sensitivityA);
  d.sensitivityB = n(input.sensitivityB, 0.3, 4, d.sensitivityB);
  d.strengthMin = n(input.strengthMin, 0, 200, d.strengthMin);
  d.strengthMax = n(input.strengthMax, 1, 200, d.strengthMax);
  if (d.strengthMin > d.strengthMax) {
    const t = d.strengthMin;
    d.strengthMin = d.strengthMax;
    d.strengthMax = t;
  }
  d.waveAmpMin = n(input.waveAmpMin, 0, 100, d.waveAmpMin);
  d.waveAmpMax = n(input.waveAmpMax, 0, 100, d.waveAmpMax);
  if (d.waveAmpMin > d.waveAmpMax) {
    const t = d.waveAmpMin;
    d.waveAmpMin = d.waveAmpMax;
    d.waveAmpMax = t;
  }
  d.freqFixed = n(input.freqFixed, 10, 240, d.freqFixed);
  d.freqMin = n(input.freqMin, 10, 240, d.freqMin);
  d.freqMax = n(input.freqMax, 10, 240, d.freqMax);
  if (d.freqMin > d.freqMax) {
    const t = d.freqMin;
    d.freqMin = d.freqMax;
    d.freqMax = t;
  }
  d.smoothing = n(input.smoothing, 0, 0.95, d.smoothing);
  d.baseStrength = n(input.baseStrength, 0, 200, d.baseStrength);
  d.gateThreshold = n(input.gateThreshold, 0, 0.3, d.gateThreshold);
  if (typeof input.strengthDrive === "boolean") d.strengthDrive = input.strengthDrive;
  if (typeof input.loop === "boolean") d.loop = input.loop;
  if (typeof input.shuffle === "boolean") d.shuffle = input.shuffle;
  const fm = String(input.freqMode || "");
  if (["spectrum", "fixed", "with_intensity", "inverse_intensity"].includes(fm)) {
    d.freqMode = /** @type {StimFreqMode} */ (fm);
  }
  const cm = String(input.channelMode || "");
  if (["stereo", "mono_l", "mono_r", "mono_sum"].includes(cm)) {
    d.channelMode = /** @type {StimChannelMode} */ (cm);
  }
  return d;
}

// Smoothed state (module-level for continuity)
let smoothAmpA = 0;
let smoothAmpB = 0;
let smoothStrA = 0;
let smoothStrB = 0;
let smoothFreqA = 45;
let smoothFreqB = 45;

/** @type {{ t: number, aA: number, aB: number, fA: number, fB: number, sA: number, sB: number }[]} */
const history = [];
const HISTORY_MAX = 120;

export function resetStimSmoothing() {
  smoothAmpA = 0;
  smoothAmpB = 0;
  smoothStrA = 0;
  smoothStrB = 0;
  smoothFreqA = 45;
  smoothFreqB = 45;
  history.length = 0;
}

export function getStimHistory() {
  return history.slice();
}

function peakFromTimeDomain(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) {
    const val = Math.abs(arr[i] - 128) / 128;
    if (val > max) max = val;
  }
  return max;
}

function spectralPeak(analyser) {
  const freqArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqArray);
  let maxBin = 0;
  let maxVal = 0;
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < freqArray.length; i++) {
    const v = freqArray[i];
    sum += v;
    wsum += v * i;
    if (v > maxVal) {
      maxVal = v;
      maxBin = i;
    }
  }
  const centroid = sum > 0 ? wsum / sum : 0;
  return { maxBin, maxVal, centroid };
}

function mapWireFreqFromSpectrum(maxBin, maxVal, cfg) {
  if (maxVal < 15) return cfg.freqFixed;
  const logical = 10 + maxBin * 8;
  const wire = ProtocolUtils.encodeWaveFreqLogical
    ? ProtocolUtils.encodeWaveFreqLogical(logical)
    : Math.max(10, Math.min(240, Math.round(logical)));
  return Math.max(cfg.freqMin, Math.min(cfg.freqMax, wire));
}

function mapFreqFromIntensity(level01, cfg, inverse) {
  const t = inverse ? 1 - level01 : level01;
  return Math.round(cfg.freqMin + (cfg.freqMax - cfg.freqMin) * clamp01(t));
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function ema(prev, next, smooth) {
  if (smooth <= 0) return next;
  return prev + (next - prev) * (1 - smooth);
}

/**
 * Core audio→stim frame. Call from wave loop while isAudioPlaying.
 * @param {AnalyserNode} analyserA
 * @param {AnalyserNode} analyserB
 * @param {object} [cfg]
 * @returns {{ fA: number, aA: number, fB: number, aB: number, strengthA: number, strengthB: number, levelA: number, levelB: number }}
 */
export function processAudioToStim(analyserA, analyserB, cfg) {
  const c = cfg || loadStimConfig();
  const bufA = new Uint8Array(analyserA.fftSize);
  const bufB = new Uint8Array(analyserB.fftSize);
  analyserA.getByteTimeDomainData(bufA);
  analyserB.getByteTimeDomainData(bufB);

  let peakA = peakFromTimeDomain(bufA) * c.sensitivityA;
  let peakB = peakFromTimeDomain(bufB) * c.sensitivityB;

  // Channel modes
  if (c.channelMode === "mono_l") peakB = peakA;
  else if (c.channelMode === "mono_r") peakA = peakB;
  else if (c.channelMode === "mono_sum") {
    const m = (peakA + peakB) / 2;
    peakA = m;
    peakB = m;
  } else {
    // stereo: if B silent, mirror A
    if (peakB < 0.001) peakB = peakA;
  }

  peakA = clamp01(peakA);
  peakB = clamp01(peakB);

  // Gate low noise
  if (peakA < c.gateThreshold) peakA = 0;
  if (peakB < c.gateThreshold) peakB = 0;

  // Wave amps
  const aA = c.waveAmpMin + (c.waveAmpMax - c.waveAmpMin) * peakA;
  const aB = c.waveAmpMin + (c.waveAmpMax - c.waveAmpMin) * peakB;

  // Frequencies
  const specA = spectralPeak(analyserA);
  const specB = spectralPeak(analyserB);
  let fA = c.freqFixed;
  let fB = c.freqFixed;
  if (c.freqMode === "spectrum") {
    fA = mapWireFreqFromSpectrum(specA.maxBin, specA.maxVal, c);
    fB = mapWireFreqFromSpectrum(specB.maxBin, specB.maxVal, c);
  } else if (c.freqMode === "with_intensity") {
    fA = mapFreqFromIntensity(peakA, c, false);
    fB = mapFreqFromIntensity(peakB, c, false);
  } else if (c.freqMode === "inverse_intensity") {
    fA = mapFreqFromIntensity(peakA, c, true);
    fB = mapFreqFromIntensity(peakB, c, true);
  }

  // Strength mapping (relative to soft limits as hard ceiling)
  const softA = AppState.softLimitA || 150;
  const softB = AppState.softLimitB || 150;
  const sMinA = Math.min(c.strengthMin, softA);
  const sMaxA = Math.min(c.strengthMax, softA);
  const sMinB = Math.min(c.strengthMin, softB);
  const sMaxB = Math.min(c.strengthMax, softB);
  let strA = sMinA + (sMaxA - sMinA) * peakA;
  let strB = sMinB + (sMaxB - sMinB) * peakB;
  if (peakA === 0) strA = Math.min(strA, c.baseStrength * 0.3);
  if (peakB === 0) strB = Math.min(strB, c.baseStrength * 0.3);

  // Smooth
  const sm = c.smoothing;
  smoothAmpA = ema(smoothAmpA, aA, sm);
  smoothAmpB = ema(smoothAmpB, aB, sm);
  smoothStrA = ema(smoothStrA, strA, sm);
  smoothStrB = ema(smoothStrB, strB, sm);
  smoothFreqA = ema(smoothFreqA, fA, sm * 0.7);
  smoothFreqB = ema(smoothFreqB, fB, sm * 0.7);

  const out = {
    fA: Math.round(Math.max(10, Math.min(240, smoothFreqA))),
    fB: Math.round(Math.max(10, Math.min(240, smoothFreqB))),
    aA: Math.round(Math.max(0, Math.min(100, smoothAmpA))),
    aB: Math.round(Math.max(0, Math.min(100, smoothAmpB))),
    strengthA: Math.round(Math.max(0, Math.min(softA, smoothStrA))),
    strengthB: Math.round(Math.max(0, Math.min(softB, smoothStrB))),
    levelA: peakA,
    levelB: peakB,
  };

  history.push({
    t: Date.now(),
    aA: out.aA,
    aB: out.aB,
    fA: out.fA,
    fB: out.fB,
    sA: out.strengthA,
    sB: out.strengthB,
  });
  while (history.length > HISTORY_MAX) history.shift();

  return out;
}
