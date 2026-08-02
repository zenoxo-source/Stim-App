// wire-shaping.js — pure helpers for the "Gefühl" engine (v5.1).
//
// All functions are side-effect free so they can be unit-tested in Node.
// They shape the wire signal (freq/amp per channel) before it hits the B0
// packet: pulse shapes (attack/decay), anti-habituation dithering, detune
// beats, crossfade blending, climax curves, beat sequences and pitch
// tracking.

// ---------------------------------------------------------------------------
// Pulse shapes — amplitude envelopes that give the stim a "texture".
// ---------------------------------------------------------------------------

export const PULSE_SHAPES = {
  none: { cycleMs: 0 },
  // short sharp attack, quick exponential decay → precise, stinging
  hard: { cycleMs: 240, attack: 0.12, plateau: 0.08, decay: 0.8, minMult: 0.1 },
  // slow rise, long plateau, gentle decay → deep, massaging
  soft: { cycleMs: 300, attack: 0.35, plateau: 0.35, decay: 0.3, minMult: 0.3 },
  // slow breathing swell
  throb: { cycleMs: 600, attack: 0.3, plateau: 0.2, decay: 0.5, minMult: 0.15 },
};

/**
 * Sample a pulse shape at time tMs.
 * @param {{cycleMs:number, attack?:number, plateau?:number, decay?:number, minMult?:number}} shape
 * @param {number} tMs
 * @param {number} baseAmp 0..100
 * @returns {number} shaped amplitude 0..100
 */
export function pulseStep(shape, tMs, baseAmp) {
  if (!shape || shape.cycleMs <= 0 || !Number.isFinite(baseAmp)) return baseAmp;
  const phase = (((tMs % shape.cycleMs) + shape.cycleMs) % shape.cycleMs) / shape.cycleMs;
  const attack = Math.max(0.01, shape.attack || 0.25);
  const plateau = shape.plateau || 0.1;
  const decay = shape.decay || 0.4;
  const minMult = shape.minMult ?? 0;
  let mult;
  if (phase < attack) {
    mult = phase / attack; // linear attack
  } else if (phase < attack + plateau) {
    mult = 1;
  } else {
    const p = (phase - attack - plateau) / decay;
    mult = Math.max(minMult, 1 - p * p); // quadratic decay
  }
  return Math.max(0, Math.min(100, baseAmp * mult));
}

// ---------------------------------------------------------------------------
// Dithering — sub-perceptual noise against habituation (adaptation).
// ---------------------------------------------------------------------------

/** Deterministic LCG so test runs are reproducible. */
export function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Add ±amount% (of full scale) of bounded noise around the amplitude.
 * @param {number} amp 0..100
 * @param {number} amount percent, e.g. 1
 * @param {number} seed
 * @returns {number}
 */
export function applyDither(amp, amount, seed) {
  const a = Number(amount) || 0;
  if (a <= 0) return amp;
  const rnd = lcg(seed)();
  const delta = (rnd - 0.5) * 2 * a;
  return Math.max(0, Math.min(100, amp + delta));
}

// ---------------------------------------------------------------------------
// Detune beats — two channels at slightly different frequencies interfere
// in the tissue and produce a slow beating pulse.
// ---------------------------------------------------------------------------

/**
 * @param {number} fA
 * @param {number} fB
 * @param {number} detuneHz e.g. 3 → the pair runs at base / base+3 Hz
 * @returns {{fA:number, fB:number}}
 */
export function detuneFreqs(fA, fB, detuneHz) {
  const d = Number(detuneHz) || 0;
  if (d <= 0) return { fA, fB };
  const base = fA > 0 ? fA : fB;
  if (base <= 0) return { fA, fB };
  const lo = clampW(base);
  const hi = clampW(base + d);
  return { fA: lo, fB: hi };
}

/** Beat-frequency LFO 0..1 for optional amplitude emphasis. */
export function beatLfo(tMs, beatHz) {
  const hz = Number(beatHz) || 0;
  if (hz <= 0) return 1;
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * hz * tMs) / 1000);
}

function clampW(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.max(10, Math.min(240, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Crossfade blending — smooth transitions instead of hard step changes.
// ---------------------------------------------------------------------------

export function easeInOut(p) {
  const t = Math.max(0, Math.min(1, p));
  return t * t * (3 - 2 * t);
}

/**
 * @param {{fA:number,aA:number,fB:number,aB:number}} from
 * @param {{fA:number,aA:number,fB:number,aB:number}} to
 * @param {number} p 0..1
 * @returns {{fA:number,aA:number,fB:number,aB:number}}
 */
export function blendStep(from, to, p) {
  const t = easeInOut(p);
  const lerp = (a, b) => a + (b - a) * t;
  return {
    fA: Math.round(lerp(from.fA, to.fA)),
    aA: Math.round(lerp(from.aA, to.aA)),
    fB: Math.round(lerp(from.fB, to.fB)),
    aB: Math.round(lerp(from.aB, to.aB)),
  };
}

// ---------------------------------------------------------------------------
// Climax curves — accelerating frequency ramp + amplitude staircase with
// micro-plateaus ("getriggerte" Höhepunkte).
// ---------------------------------------------------------------------------

export const CLIMAX_CURVES = {
  none: null,
  kurz: {
    durMs: 60000,
    fStart: 45,
    fEnd: 110,
    stepMs: 5000,
    stepAmp: 0.08,
    dipMs: 500,
    dipFrac: 0.7,
    baseAmp: 0.78,
  },
  standard: {
    durMs: 90000,
    fStart: 40,
    fEnd: 120,
    stepMs: 5000,
    stepAmp: 0.08,
    dipMs: 500,
    dipFrac: 0.7,
    baseAmp: 0.8,
  },
  verzoegert: {
    durMs: 150000,
    fStart: 35,
    fEnd: 130,
    stepMs: 6000,
    stepAmp: 0.06,
    dipMs: 600,
    dipFrac: 0.7,
    baseAmp: 0.78,
  },
};

/**
 * @param {{durMs:number,fStart:number,fEnd:number,stepMs:number,stepAmp:number,dipMs:number,dipFrac:number,baseAmp:number}} curve
 * @param {number} elapsedMs time since CLIMAX_PUSH started
 * @returns {{f:number, amp:number}}
 */
export function climaxCurveStep(curve, elapsedMs) {
  const t = Math.max(0, Number(elapsedMs) || 0);
  const p = Math.min(1, t / curve.durMs);
  const ease = p * p * (3 - 2 * p); // ease-in-out
  const f = curve.fStart + (curve.fEnd - curve.fStart) * ease;

  const stepIdx = Math.floor(t / curve.stepMs);
  const within = t % curve.stepMs;
  let amp = curve.baseAmp + stepIdx * curve.stepAmp;
  // Micro-plateau dip at each step start — except the very first step, which
  // begins at full strength.
  if (stepIdx >= 1 && within < curve.dipMs) {
    amp *= curve.dipFrac;
  }
  return { f: Math.round(f), amp: Math.min(1, amp) };
}

// ---------------------------------------------------------------------------
// Beat sequences — rhythmic step patterns synced to a BPM.
// ---------------------------------------------------------------------------

export const BEAT_PATTERNS = {
  throb: {
    steps: 4,
    seq: [
      [1, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  },
  double: {
    steps: 4,
    seq: [
      [1, 0],
      [0.7, 0],
      [0, 0],
      [0, 0],
    ],
  },
  gallop: {
    steps: 8,
    seq: [
      [1, 0],
      [0.6, 0],
      [0.4, 0],
      [0, 0],
      [1, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  },
  heartbeat: {
    steps: 8,
    seq: [
      [1, 0],
      [0, 0],
      [0.8, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  },
  strobe: {
    steps: 2,
    seq: [
      [1, 1],
      [0, 0],
    ],
  },
  staircase: {
    steps: 8,
    seq: [
      [0.3, 0.3],
      [0.5, 0.5],
      [0.7, 0.7],
      [1, 1],
      [0.8, 0.8],
      [0.6, 0.6],
      [0.4, 0.4],
      [0, 0],
    ],
  },
};

/**
 * @param {string} patternId
 * @param {number} bpm
 * @param {number} tMs
 * @param {number} baseAmp 0..100
 * @returns {{aA:number, aB:number}}
 */
export function beatStep(patternId, bpm, tMs, baseAmp) {
  const pat = BEAT_PATTERNS[patternId] || BEAT_PATTERNS.throb;
  const stepMs = 60000 / Math.max(20, Number(bpm) || 120) / pat.steps;
  const idx = Math.floor(tMs / stepMs) % pat.seq.length;
  const [sA, sB] = pat.seq[idx];
  return {
    aA: Math.round(Math.max(0, Math.min(100, baseAmp * sA))),
    aB: Math.round(Math.max(0, Math.min(100, baseAmp * sB))),
  };
}

/** @param {number[]} tapsMs */
export function bpmFromTaps(tapsMs) {
  if (!Array.isArray(tapsMs) || tapsMs.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < tapsMs.length; i++) {
    const d = tapsMs[i] - tapsMs[i - 1];
    if (d > 150 && d < 2500) intervals.push(d);
  }
  if (intervals.length === 0) return null;
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return Math.round(60000 / avg);
}

// ---------------------------------------------------------------------------
// Melody tracking — autocorrelation pitch estimation on a time-domain buffer.
// ---------------------------------------------------------------------------

/**
 * Estimate the dominant pitch of a Uint8Array time-domain capture (128 = zero).
 * @param {Uint8Array} buf
 * @param {number} sampleRate
 * @returns {number|null} pitch in Hz, or null when confidence is too low
 */
export function pitchFromBuffer(buf, sampleRate) {
  if (!buf || buf.length < 32 || !sampleRate) return null;
  const n = buf.length;
  const minLag = Math.max(4, Math.floor(sampleRate / 600));
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / 55));
  if (maxLag <= minLag) return null;

  // Normalize: center around zero and compute mean square for denominator.
  const x = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  for (let i = 0; i < n; i++) x[i] = buf[i] - mean;

  let bestLag = -1;
  let bestScore = 0;
  const scores = new Float32Array(maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n - lag; i++) {
      num += x[i] * x[i + lag];
      den += x[i] * x[i];
    }
    if (den <= 0) continue;
    const r = num / den;
    scores[lag - minLag] = r;
    if (r > bestScore) {
      bestScore = r;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore < 0.3) return null;

  // Octave correction: a periodic tone correlates equally well at integer
  // multiples of its period (subharmonics), and the correlation rises into
  // the true peak from below. The fundamental is the SMALLEST local maximum
  // of the correlation function that is still close to the global best.
  let lag = bestLag;
  const threshold = bestScore * 0.9;
  for (let l = minLag + 1; l < maxLag; l++) {
    const s = scores[l - minLag];
    if (s < threshold) continue;
    if (s >= scores[l - 1 - minLag] && s >= scores[l + 1 - minLag]) {
      lag = l;
      break;
    }
  }
  return Math.round(sampleRate / lag);
}

/**
 * Map a pitch to a wire frequency (log scale, musical range → stim range).
 * @param {number} pitchHz
 * @param {object} cfg
 * @returns {number} wire freq 10..240
 */
export function melodyToWireFreq(pitchHz, cfg) {
  const c = cfg || {};
  if (!Number.isFinite(pitchHz) || pitchHz < 40) return c.freqFixed || 45;
  const p = Math.min(600, pitchHz);
  const logLo = Math.log(40);
  const logHi = Math.log(600);
  const t = (Math.log(p) - logLo) / (logHi - logLo);
  const f = Math.round(25 + t * (225 - 25)); // 25..225 Hz wire
  return Math.max(10, Math.min(240, f));
}

// ---------------------------------------------------------------------------
// Fast-wire configuration
// ---------------------------------------------------------------------------

export const DEFAULT_WIRE_SHAPING = {
  fastEnabled: false, // 25 ms micro-loop
  shapeA: "none",
  shapeB: "none",
  dither: 0, // percent
  detuneHz: 0,
  crossfadeMs: 3000, // 0 = off
  beatMode: false,
  beatBpm: 120,
  beatPattern: "throb",
  beatBaseAmp: 70,
};

export function sanitiseWireShaping(raw) {
  const r = raw || {};
  return {
    fastEnabled: !!r.fastEnabled,
    shapeA: PULSE_SHAPES[r.shapeA] ? r.shapeA : "none",
    shapeB: PULSE_SHAPES[r.shapeB] ? r.shapeB : "none",
    dither: Math.max(0, Math.min(5, Number(r.dither) || 0)),
    detuneHz: Math.max(0, Math.min(12, Number(r.detuneHz) || 0)),
    crossfadeMs:
      r.crossfadeMs != null
        ? Math.max(0, Math.min(10000, Number(r.crossfadeMs) || 0))
        : DEFAULT_WIRE_SHAPING.crossfadeMs,
    beatMode: !!r.beatMode,
    beatBpm: Math.max(40, Math.min(240, Number(r.beatBpm) || 120)),
    beatPattern: BEAT_PATTERNS[r.beatPattern] ? r.beatPattern : "throb",
    beatBaseAmp: Math.max(20, Math.min(100, Number(r.beatBaseAmp) || 70)),
  };
}
