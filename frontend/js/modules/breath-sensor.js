// breath-sensor.js — microphone-based breathing detection.
//
// Used as a fallback for heart-rate biofeedback: an RMS envelope of the mic
// input detects slow inhale/exhale cycles so the coach can speak "Ein"/"Aus"
// in sync with the user's actual breathing instead of a fixed timer.
// The mic only runs while the sensor is explicitly started (coach cadence).

let stream = null;
let audioCtx = null;
let analyser = null;
let rafId = null;
let env = 0;
let phase = "out";
let lastRms = 0;
let onInhale = null;
let onExhale = null;

export function isBreathSensorActive() {
  return stream !== null;
}

async function tick() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length);
  // Slow envelope (≈1.2 s window via per-frame smoothing).
  env = env * 0.92 + rms * 0.08;
  if (phase === "out" && env > 0.045 && env > lastRms) {
    phase = "in";
    try {
      onInhale && onInhale();
    } catch {
      /* ignore */
    }
  } else if (phase === "in" && env < 0.025) {
    phase = "out";
    try {
      onExhale && onExhale();
    } catch {
      /* ignore */
    }
  }
  lastRms = env;
  rafId = requestAnimationFrame(tick);
}

/**
 * Start breathing detection. Resolves true on success (mic granted).
 * @param {() => void} cbInhale
 * @param {() => void} cbExhale
 * @returns {Promise<boolean>}
 */
export async function startBreathSensor(cbInhale, cbExhale) {
  try {
    if (stream) return true;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.9;
    src.connect(analyser);
    onInhale = cbInhale;
    onExhale = cbExhale;
    env = 0;
    phase = "out";
    lastRms = 0;
    rafId = requestAnimationFrame(tick);
    return true;
  } catch {
    return false;
  }
}

/** Stop the mic + sensor. */
export function stopBreathSensor() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch {
      /* ignore */
    }
    audioCtx = null;
  }
  analyser = null;
  onInhale = null;
  onExhale = null;
}
