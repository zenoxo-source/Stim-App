// breath-sensor.js — microphone-based breathing detection.
//
// Used as a fallback for heart-rate biofeedback: an RMS envelope of the mic
// input detects slow inhale/exhale cycles so the coach can speak "Ein"/"Aus"
// in sync with the user's actual breathing instead of a fixed timer.
//
// v6.3: also exposes a held-breath detector + breath rate, fed into the
// Autodrive arousal estimator (held breath is a strong pre-orgasm marker and
// every user has a mic). The mic only runs while the sensor is explicitly
// started (coach cadence or Autodrive breath integration).

let stream = null;
let audioCtx = null;
let analyser = null;
let rafId = null;
let env = 0;
let phase = "out";
let lastRms = 0;
let onInhale = null;
let onExhale = null;
// v6.3: breath-rate + held-breath tracking.
let lastInhaleAt = 0;
const inhaleIntervals = []; // rolling window of ms between inhales
let breathHeldSince = 0; // 0 = breathing normally; set when envelope goes quiet

export function isBreathSensorActive() {
  return stream !== null;
}

/**
 * v6.3 snapshot of the derived breath signals for the arousal estimator.
 * @returns {{ breathHeldMs: number, breathRate: number }}
 *   breathHeldMs: ms the breath has been held (0 if breathing)
 *   breathRate: breaths/min (0 if unknown)
 */
export function getBreathState() {
  const now = Date.now();
  let held = 0;
  if (breathHeldSince) held = now - breathHeldSince;
  let rate = 0;
  if (inhaleIntervals.length >= 2) {
    const avgMs = inhaleIntervals.reduce((a, b) => a + b, 0) / inhaleIntervals.length;
    if (avgMs > 0) rate = Math.round(60000 / avgMs);
  }
  return { breathHeldMs: held, breathRate: rate };
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
  const now = Date.now();

  // v6.3 held-breath: if the envelope stays very quiet, the user is holding.
  // A normal breath cycle keeps the envelope fluctuating; a flat-low envelope
  // for >1.2 s is treated as "held" (pre-orgasm / high-arousal marker).
  if (env < 0.018) {
    if (!breathHeldSince) breathHeldSince = now;
  } else {
    breathHeldSince = 0;
  }

  if (phase === "out" && env > 0.045 && env > lastRms) {
    phase = "in";
    if (lastInhaleAt) {
      const interval = now - lastInhaleAt;
      if (interval > 1500 && interval < 16000) {
        inhaleIntervals.push(interval);
        if (inhaleIntervals.length > 6) inhaleIntervals.shift();
      }
    }
    lastInhaleAt = now;
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
    lastInhaleAt = 0;
    breathHeldSince = 0;
    inhaleIntervals.length = 0;
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
  breathHeldSince = 0;
  lastInhaleAt = 0;
  inhaleIntervals.length = 0;
}
