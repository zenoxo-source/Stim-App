// music-sync.js - BPM detection via microphone + beat-synced stim pulses.
//
// Uses Web Audio API (AnalyserNode) + simple energy-based beat detection.
// Algorithm: track short-term RMS; if current RMS exceeds running average by
// a configurable threshold, mark a beat. Estimate BPM from inter-beat intervals.
//
// On each detected beat, fire a configurable strength pulse via
// sendStrengthCommand. Respects panic cooldown + ceiling.
//
// Permission: requires `navigator.mediaDevices.getUserMedia({audio: true})`.
// On macOS / Windows the user gets the standard mic-permission prompt.
// On Linux the user is asked by the desktop environment (PipeWire/PulseAudio).

import { AppState, DOM, log } from "../state.js";
import { sendStrengthCommand } from "./bluetooth.js";
import { blockDuringPanicCooldown } from "./safety-extras.js";

const SYNC_KEY = "stim_app_music_sync_v1";

const DEFAULTS = {
  enabled: false,
  sensitivity: 1.4, // RMS threshold multiplier above running average
  minBpm: 40,
  maxBpm: 240,
  pulseStrengthA: 30,
  pulseStrengthB: 30,
  pulseDecayMs: 150, // how fast the pulse fades back
  historyLen: 43, // ~1 second of history at 25Hz polling
};

let stream = null;
let audioCtx = null;
let analyser = null;
let dataBuf = null;
let pollHandle = null;
let beatTimestamps = [];
let rmsHistory = [];
let lastBeatTime = 0;
let lastPulseTime = 0;
let currentBpm = 0;

/**
 * @returns {typeof DEFAULTS}
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist config.
 * @param {Partial<typeof DEFAULTS>} patch
 */
export function saveConfig(patch) {
  const merged = { ...loadConfig(), ...patch };
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/** @returns {number} last detected BPM (0 if not running / unknown). */
export function getCurrentBpm() {
  return currentBpm;
}

/**
 * Compute RMS (root-mean-square) amplitude from a byte time-domain sample.
 * Pure function for testability.
 * @param {Uint8Array|number[]} samples 0–255 range, center=128
 * @returns {number}
 */
export function computeRms(samples) {
  if (!samples || samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Estimate BPM from a list of beat timestamps.
 * Pure function — takes ms timestamps, returns BPM (0 if too few beats).
 * @param {number[]} timestampsMs
 * @returns {number}
 */
export function estimateBpm(timestampsMs) {
  if (!Array.isArray(timestampsMs) || timestampsMs.length < 2) return 0;
  // Use the most recent up to 8 intervals
  const intervals = [];
  for (let i = Math.max(1, timestampsMs.length - 8); i < timestampsMs.length; i++) {
    intervals.push(timestampsMs[i] - timestampsMs[i - 1]);
  }
  if (intervals.length === 0) return 0;
  // Filter outliers (>2× median)
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const filtered = intervals.filter((iv) => iv > median * 0.5 && iv < median * 2);
  if (filtered.length === 0) return 0;
  const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  if (avg <= 0) return 0;
  let bpm = Math.round(60_000 / avg);
  // Fold into typical range (some beats are half-time / double-time)
  while (bpm > 240) bpm = Math.round(bpm / 2);
  while (bpm < 40) bpm = bpm * 2;
  return bpm;
}

/**
 * Decide whether a beat should fire given the current RMS and history.
 * Pure helper for testing.
 * @param {number} rms
 * @param {number[]} history
 * @param {number} sensitivity
 * @returns {boolean}
 */
export function detectBeat(rms, history, sensitivity) {
  if (history.length === 0) return false;
  const avg = history.reduce((a, b) => a + b, 0) / history.length;
  if (avg <= 0) return false;
  return rms > avg * sensitivity;
}

/**
 * Start music-sync. Requests mic permission + arms polling.
 * @param {Partial<typeof DEFAULTS>} [patch]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function startMusicSync(patch) {
  if (pollHandle) return { ok: false, error: "Music-Sync läuft bereits." };
  if (patch) saveConfig(patch);
  const cfg = loadConfig();

  if (!navigator?.mediaDevices?.getUserMedia) {
    return { ok: false, error: "Mikrofon-API in diesem Browser nicht verfügbar." };
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    return { ok: false, error: `Mikrofon-Zugriff verweigert: ${err.message}` };
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  dataBuf = new Uint8Array(analyser.fftSize);

  beatTimestamps = [];
  rmsHistory = [];
  lastBeatTime = 0;
  lastPulseTime = 0;
  currentBpm = 0;

  pollHandle = setInterval(() => pollBeat(cfg), 40); // ~25 Hz
  log("Music-Sync aktiv — lausche auf Beats.", "success");
  return { ok: true };
}

/**
 * Stop music-sync. Releases mic + AudioContext.
 */
export function stopMusicSync(reason = "manuell") {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  if (analyser) {
    try {
      analyser.disconnect();
    } catch {
      /* ignore */
    }
    analyser = null;
  }
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch {
      /* ignore */
    }
    audioCtx = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  currentBpm = 0;
  log(`Music-Sync gestoppt (${reason}).`, "info");
}

/** @returns {boolean} */
export function isMusicSyncActive() {
  return pollHandle !== null;
}

/**
 * Read analyser, detect beat, fire pulse + update BPM.
 */
function pollBeat(cfg) {
  if (!analyser || !dataBuf) return;
  analyser.getByteTimeDomainData(dataBuf);
  const rms = computeRms(dataBuf);

  // Update history
  rmsHistory.push(rms);
  if (rmsHistory.length > cfg.historyLen) rmsHistory.shift();

  if (detectBeat(rms, rmsHistory, cfg.sensitivity)) {
    const now = Date.now();
    // Refractory period: don't fire more than every 250ms
    if (now - lastBeatTime < 250) return;
    lastBeatTime = now;
    beatTimestamps.push(now);
    if (beatTimestamps.length > 16) beatTimestamps.shift();
    const bpm = estimateBpm(beatTimestamps);
    if (bpm >= cfg.minBpm && bpm <= cfg.maxBpm) {
      currentBpm = bpm;
      updateBpmDisplay(bpm);
    }
    firePulse(cfg, now);
  }
}

function firePulse(cfg, now) {
  if (blockDuringPanicCooldown("Music-Sync-Pulse")) return;
  if (now - lastPulseTime < 200) return;
  lastPulseTime = now;
  // Brief spike, then fade. Use a short timeout to relax.
  const peakA = Math.min(AppState.softLimitA, cfg.pulseStrengthA);
  const peakB = Math.min(AppState.softLimitB, cfg.pulseStrengthB);
  sendStrengthCommand(peakA, peakB);
  setTimeout(
    () => {
      if (blockDuringPanicCooldown("Music-Sync-Relax")) return;
      sendStrengthCommand(0, 0);
    },
    Math.max(50, cfg.pulseDecayMs)
  );
}

function updateBpmDisplay(bpm) {
  const el = DOM && DOM["music-bpm"];
  if (el) el.textContent = `${bpm} BPM`;
}
