// pattern-engine.js — Named pattern waveform samples (shared with Autodrive).
// Pure computation: one tick of a named pattern → { fA, aA, fB, aB }.
// Split from control-deck.js so the wave-loop file stays focused on playback.
//
// v2 (v6.5): every pattern is a data-driven "pulse train" of envelope-shaped
// hits (attack → quadratic decay → min-level floor) instead of raw square-wave
// gates. This is what makes the Coyote patterns FEEL like pulses instead of
// choppy steps:
//   - multi-level accents (0 → 40 → 100 instead of 0 → 100)
//   - per-hit attack/decay envelopes
//   - frequency↔intensity coupling (louder hit → higher wire freq → "buzz
//     into sting" transitions)
//   - channel phase offset (A leads B → spatial sensation)
//   - per-pattern 4-slot micro-texture via computePatternSlots (exploits the
//     Coyote B0 frequency grid on the manual path, no fast-wire needed)
//
// The public API (computeNamedPatternWave) is unchanged so control-deck,
// Autodrive and the fast-wire path keep working.

import { AppState, CONSTANTS } from "../state.js";

// ---------------------------------------------------------------------------
// Envelope core
// ---------------------------------------------------------------------------

/**
 * A "hit" is one pulse in a pattern's cycle.
 * @typedef {object} Hit
 * @property {number} at tick within the cycle where the pulse starts
 * @property {number} level peak amplitude 0..100
 * @property {number} [attack] ticks to reach the peak (>=1)
 * @property {number} [decay] ticks to fall to the floor (>=1)
 * @property {number} [minMult] 0..1 floor as fraction of level
 * @property {boolean} [fromFloor] attack starts AT the floor instead of 0 —
 *   "breathing" swells (gentle/tease/breath) stay continuous, sharp strikes
 *   (rhythm/strobe/climax) stay crisp.
 * @property {number} [fDelta] wire-freq offset applied while THIS hit owns the
 *   envelope (v6.5 freq identity): bass hits go lower, sharp strikes higher.
 */

/**
 * Sample the envelope of a single hit at `phase` ticks after it started.
 * Linear attack (optionally from the floor), quadratic decay to
 * `level * minMult`.
 * @param {Hit} hit
 * @param {number} phase ticks since hit start (fractional allowed)
 * @returns {number} 0..100
 */
export function envelopeAmp(hit, phase) {
  if (phase < 0) return 0;
  const atk = Math.max(1, hit.attack ?? 1);
  const p = Number(phase) || 0;
  const floor = hit.level * (hit.minMult ?? 0);
  const start = hit.fromFloor ? floor : 0;
  if (p < atk) {
    const v = start + (hit.level - start) * (p / atk);
    return Math.max(0, Math.min(100, v));
  }
  const dec = Math.max(1, hit.decay ?? 4);
  const d = (p - atk) / dec;
  return Math.max(0, Math.min(100, floor + (hit.level - floor) * Math.pow(Math.max(0, 1 - d), 2)));
}

/**
 * Evaluate a pulse-train hit table at a (possibly fractional) tick. The most
 * recent hit (largest `at` <= phase) owns the envelope; its decay tail
 * carries the amplitude until the next hit starts.
 * @param {number} tick (fractional allowed)
 * @param {number} cycleTicks
 * @param {Hit[]} hits
 * @param {number} [channelOffset] extra ticks added to this channel
 * @returns {number} amplitude 0..100
 */
export function pulseTrainAmp(tick, cycleTicks, hits, channelOffset = 0) {
  const hit = pulseTrainHit(tick, cycleTicks, hits, channelOffset);
  if (!hit) return 0;
  const cyc = Math.max(1, cycleTicks || 1);
  const phase = ((((Number(tick) || 0) + channelOffset) % cyc) + cyc) % cyc;
  return envelopeAmp(hit, phase - hit.at);
}

/**
 * Like pulseTrainAmp, but also returns the active hit so the caller can read
 * its per-hit frequency offset (fDelta) for the freq identity.
 * @returns {{ amp: number, hit: Hit | null }}
 */
export function pulseTrainValue(tick, cycleTicks, hits, channelOffset = 0) {
  const hit = pulseTrainHit(tick, cycleTicks, hits, channelOffset);
  if (!hit) return { amp: 0, hit: null };
  const cyc = Math.max(1, cycleTicks || 1);
  const phase = ((((Number(tick) || 0) + channelOffset) % cyc) + cyc) % cyc;
  return { amp: envelopeAmp(hit, phase - hit.at), hit };
}

/** @returns {Hit|null} the active hit at this tick (null = silence). */
function pulseTrainHit(tick, cycleTicks, hits, channelOffset) {
  const cyc = Math.max(1, cycleTicks || 1);
  const phase = ((((Number(tick) || 0) + channelOffset) % cyc) + cyc) % cyc;
  let best = null;
  for (const h of hits) {
    if (h.at <= phase && (!best || h.at > best.at)) best = h;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pattern specs — the "new math". All amplitudes shaped, freqs coupled.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PatternSpec
 * @property {number} cycleTicks pattern cycle length in 100ms ticks
 * @property {Hit[]} hits pulse-train hit table
 * @property {number} [fBase] base wire freq for A (10..240)
 * @property {number} [fBaseB] base wire freq for B (spatial contrast)
 * @property {number} [fRange] slow freq wobble amplitude
 * @property {number} [fRate] freq wobble rate (rad/tick)
 * @property {number} [fCouple] freq rises with intensity (0..60)
 * @property {number} [channelOffset] ticks B lags A by
 * @property {"none"|"flutter"|"warble"|"detune"} [texture] 4-slot texture
 */

const PULSE = {
  sharp: { attack: 1, decay: 4, minMult: 0.08 },
  soft: { attack: 3, decay: 7, minMult: 0.25, fromFloor: true },
  throb: { attack: 6, decay: 12, minMult: 0.3, fromFloor: true },
};

export const PATTERN_SPECS = {
  // THROB band (10–40): deep, massaging. Slow overlapping swells.
  gentle: {
    cycleTicks: 40,
    hits: [
      { at: 0, level: 75, ...PULSE.soft },
      { at: 20, level: 60, ...PULSE.soft },
    ],
    fBase: 24,
    fRange: 8,
    fRate: 0.06,
    fCouple: 10,
    channelOffset: 20,
    texture: "none",
  },
  // BUZZ with bass thump: the loud hit drops into the throb band (fDelta −14).
  rhythm: {
    cycleTicks: 16,
    hits: [
      { at: 0, level: 100, ...PULSE.sharp, fDelta: -28 },
      { at: 6, level: 55, attack: 1, decay: 4, minMult: 0.12, fDelta: 4 },
      { at: 10, level: 25, attack: 1, decay: 3, minMult: 0.12, fDelta: 8 },
      { at: 13, level: 55, attack: 1, decay: 4, minMult: 0.12, fDelta: 4 },
    ],
    fBase: 52,
    fCouple: 18,
    channelOffset: 8,
    texture: "none",
  },
  // Oscillates THROB ↔ SHARP: slow deep swell, then sharp stinging trembles.
  tease: {
    cycleTicks: 60,
    hits: [
      { at: 0, level: 60, attack: 22, decay: 26, minMult: 0.3, fDelta: -6 },
      { at: 36, level: 72, ...PULSE.sharp, fDelta: 45 },
      { at: 40, level: 78, ...PULSE.sharp, fDelta: 55 },
      { at: 44, level: 70, ...PULSE.sharp, fDelta: 60 },
      { at: 48, level: 80, ...PULSE.sharp, fDelta: 70 },
    ],
    fBase: 34,
    fRange: 18,
    fRate: 0.05,
    fCouple: 14,
    channelOffset: 4,
    texture: "flutter",
  },
  // BUZZ → SHARP climb: each strike lands sharper than the last (fDelta rises).
  climax: {
    cycleTicks: 20,
    hits: [
      { at: 0, level: 100, ...PULSE.sharp, fDelta: 0 },
      { at: 7, level: 82, ...PULSE.sharp, fDelta: 35 },
      { at: 13, level: 92, ...PULSE.sharp, fDelta: 65 },
    ],
    fBase: 85,
    fRange: 16,
    fRate: 0.5,
    fCouple: 22,
    channelOffset: 10,
    texture: "warble",
  },
  // SHARP band: fast on/off flash high in the sting zone.
  strobe: {
    cycleTicks: 4,
    hits: [{ at: 0, level: 100, attack: 1, decay: 2, minMult: 0.05 }],
    fBase: 135,
    fCouple: 20,
    channelOffset: 0,
    texture: "flutter",
  },
  // Bass thump (lub) + softer dub — deep heartbeat.
  heartbeat: {
    cycleTicks: 14,
    hits: [
      { at: 0, level: 95, attack: 1, decay: 3, minMult: 0.1, fDelta: -4 },
      { at: 3, level: 60, attack: 1, decay: 4, minMult: 0.15, fDelta: 6 },
    ],
    fBase: 30,
    fCouple: 12,
    channelOffset: 0,
    texture: "none",
  },
  // Spatial contrast: A deep throb ↔ B sharp sting.
  alternate: {
    cycleTicks: 8,
    hits: [{ at: 0, level: 85, attack: 2, decay: 4, minMult: 0.1 }],
    fBase: 28,
    fBaseB: 138,
    channelOffset: 4,
    texture: "none",
  },
  // SHARP high band: real fast tremor (Flattern).
  flutter: {
    cycleTicks: 4,
    hits: [
      { at: 0, level: 82, attack: 1, decay: 2, minMult: 0.25, fDelta: 6 },
      { at: 2, level: 58, attack: 1, decay: 2, minMult: 0.25, fDelta: -4 },
    ],
    fBase: 148,
    fRange: 12,
    fRate: 0.8,
    fCouple: 10,
    channelOffset: 2,
    texture: "flutter",
  },
  // Call (deep) ↔ response (sharp) — spatial storytelling.
  duet: {
    cycleTicks: 16,
    hits: [
      { at: 0, level: 85, ...PULSE.sharp, fDelta: -6 },
      { at: 8, level: 75, ...PULSE.soft, fDelta: 40 },
    ],
    fBase: 48,
    fBaseB: 130,
    fCouple: 12,
    channelOffset: 8,
    texture: "none",
  },
  // Deep throb breathing — long inhale/hold/exhale.
  breath: {
    cycleTicks: 80,
    hits: [{ at: 0, level: 100, attack: 36, decay: 44, minMult: 0.12, fromFloor: true }],
    fBase: 20,
    fCouple: 6,
    channelOffset: 0,
    texture: "none",
  },
  // THROB ↔ BUZZ sweep with anti-phase strikes.
  triphase: {
    cycleTicks: 8,
    hits: [{ at: 0, level: 100, ...PULSE.sharp }],
    fBase: 38,
    fRange: 48,
    fRate: 0.05,
    fCouple: 10,
    channelOffset: 4,
    texture: "none",
  },
};

/** Random is deterministic per tick (LCG) so tests stay reproducible. */
export function randomLevelAt(tick) {
  const t = Math.max(0, Math.floor((Number(tick) || 0) / 2)); // hold 2 ticks
  let s = (t * 2654435761) >>> 0;
  s = (s * 1664525 + 1013904223) >>> 0;
  return 20 + (s % 81); // 20..100, never dead air
}

// ---------------------------------------------------------------------------
// Special branches — frequency-driven patterns with their own character.
// ---------------------------------------------------------------------------

function waveAt(tick) {
  const sweep = (Number(tick) || 0) % 80;
  const tt = sweep / 80;
  const span = CONSTANTS.MAX_FREQUENCY - CONSTANTS.MIN_FREQUENCY;
  const a = Math.sin(tt * Math.PI); // 0→1→0
  const fA = Math.round(CONSTANTS.MIN_FREQUENCY + span * a);
  const fB = Math.round(CONSTANTS.MIN_FREQUENCY + span * Math.sin(tt * Math.PI + Math.PI / 4));
  // Amplitude swells toward the peak of the sweep, gentle at the ends.
  const amp = Math.round(25 + 55 * a);
  return {
    fA: Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fA)),
    fB: Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fB)),
    aA: amp,
    aB: amp,
  };
}

function escalateAt(tick) {
  const cyc = 36;
  const phase = (Number(tick) || 0) % cyc;
  // Exponential ramp to a held plateau, then a quick drop to 0.
  let amp;
  if (phase < 26) {
    const p = phase / 26;
    amp = Math.round(100 * Math.pow(p, 1.7));
  } else if (phase < 30) {
    amp = 100;
  } else {
    amp = Math.round(100 * (1 - (phase - 30) / 6));
  }
  // Frequency rides the ramp from BUZZ into SHARP — rising pitch = build-up.
  const f = Math.round(50 + (amp / 100) * 85);
  return { fA: f, aA: amp, fB: f, aB: amp };
}

function driftAt(tick) {
  const dt = (Number(tick) || 0) * 0.02;
  const fA = Math.round(80 + 60 * Math.sin(dt * 0.7) * Math.cos(dt * 0.3));
  const fB = Math.round(80 + 60 * Math.cos(dt * 0.5) * Math.sin(dt * 0.4));
  const aA = Math.round(50 + 40 * Math.sin(dt * 0.6));
  const aB = Math.round(50 + 40 * Math.cos(dt * 0.6));
  return {
    fA: Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fA)),
    fB: Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fB)),
    aA: Math.max(0, Math.min(100, aA)),
    aB: Math.max(0, Math.min(100, aB)),
  };
}

/**
 * Sawtooth: the two channels run in OPPOSITION — A sweeps up while B sweeps
 * down, with eased ends so the swap never snaps. The spatial push-pull is the
 * character of this pattern.
 */
function sawtoothAt(tick) {
  const cyc = 20;
  const p = ((Number(tick) || 0) % cyc) / cyc;
  const ease = (x) => x * x * (3 - 2 * x); // smooth ends
  const aA = Math.round(100 * ease(1 - Math.abs(2 * p - 1))); // 0→100→0
  const aB = Math.round(100 * ease(Math.abs(2 * p - 1))); // 100→0→100 (opposed)
  const f = Math.round(46 + (aA / 100) * 14);
  return { fA: f, aA, fB: Math.min(240, f + 6), aB };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute one tick of a named pattern waveform.
 * @param {string} patternId
 * @param {number} loopCounter
 * @returns {{ fA: number, aA: number, fB: number, aB: number }}
 */
export function computeNamedPatternWave(patternId, loopCounter) {
  const t = Number(loopCounter) || 0;

  // Special frequency-driven branches.
  if (patternId === "wave" || patternId === CONSTANTS.PATTERNS.WAVE) return waveAt(t);
  if (patternId === "escalate" || patternId === CONSTANTS.PATTERNS.ESCALATE) return escalateAt(t);
  if (patternId === "drift" || patternId === CONSTANTS.PATTERNS.DRIFT) return driftAt(t);
  if (patternId === "sawtooth" || patternId === CONSTANTS.PATTERNS.SAWTOOTH) return sawtoothAt(t);
  if (patternId === "random" || patternId === CONSTANTS.PATTERNS.RANDOM) {
    const level = randomLevelAt(t);
    return {
      fA: AppState.frequencyA,
      fB: AppState.frequencyB,
      aA: level,
      aB: Math.max(0, Math.min(100, Math.round(level * 0.8))),
    };
  }

  const spec = PATTERN_SPECS[patternId];
  if (!spec) {
    // Unknown pattern → safe mid-level wave (never dead air, never full bore).
    return { fA: 45, aA: 60, fB: 45, aB: 60 };
  }

  const aA = Math.round(pulseTrainAmp(t, spec.cycleTicks, spec.hits, 0));
  const aB = Math.round(pulseTrainAmp(t, spec.cycleTicks, spec.hits, spec.channelOffset || 0));
  // v6.5 freq identity: the active hit carries its own frequency offset, so a
  // bass thump literally sits in the throb band while a sharp strike lands in
  // the sting zone — even within the same pattern.
  const hitA = pulseTrainValue(t, spec.cycleTicks, spec.hits, 0).hit;
  const hitB = pulseTrainValue(t, spec.cycleTicks, spec.hits, spec.channelOffset || 0).hit;
  const fA = patternFreq(spec, aA, hitA, t, 0);
  const fB = patternFreq(spec, aB, hitB, t, 1);
  return { fA, aA, fB, aB };
}

/**
 * v2: per-pattern 4-slot micro-texture for the Coyote B0 frequency grid.
 * Each slot is one 25ms sub-frame; sampling the pulse train at fractional
 * ticks gives a smooth intensity ramp inside the packet, and the texture
 * preset adds per-slot frequency variation (flutter/warble/detune) so even
 * the manual path gets "Flattern" without the fast-wire loop.
 *
 * @param {string} patternId
 * @param {number} tick
 * @param {number} fA current A freq (already resolved)
 * @param {number} fB current B freq
 * @returns {{A: {freq:number,intensity:number}[], B: {freq:number,intensity:number}[]} | null}
 */
export function computePatternSlots(patternId, tick, fA, fB) {
  const t = Number(tick) || 0;
  const spec = PATTERN_SPECS[patternId];
  if (!spec) return null; // wave/escalate/drift/random get flat slots from the caller

  const tex = spec.texture || "none";
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const st = t + i * 0.25;
    const iA = Math.round(pulseTrainAmp(st, spec.cycleTicks, spec.hits, 0));
    const iB = Math.round(pulseTrainAmp(st, spec.cycleTicks, spec.hits, spec.channelOffset || 0));
    A.push({ freq: slotFreq(tex, i, fA, 0), intensity: iA });
    B.push({ freq: slotFreq(tex, i, fB, 1), intensity: iB });
  }
  return { A, B };
}

/** Per-slot frequency micro-variation for the texture presets. */
function slotFreq(tex, slot, base, channel) {
  let d = 0;
  if (tex === "flutter") d = Math.round(2 * Math.sin(slot * 1.7));
  else if (tex === "warble") d = Math.round(4 * Math.sin(slot * 0.9));
  else if (tex === "detune") d = Math.round(3 * Math.sin(slot * 1.3) * (channel === 1 ? -1 : 1));
  const v = Number(base) || 0;
  if (v <= 0) return 0;
  return Math.max(10, Math.min(240, v + d));
}

/** Frequency resolution: base + wobble + intensity coupling + per-hit offset. */
function patternFreq(spec, level, hit, t, channel) {
  const base = channel === 1 && spec.fBaseB ? spec.fBaseB : spec.fBase;
  let f = base || 45;
  if (spec.fRange) f += spec.fRange * Math.sin(t * (spec.fRate || 0.05));
  if (spec.fCouple) f += (level / 100) * spec.fCouple;
  if (hit && hit.fDelta) f += hit.fDelta;
  return Math.max(10, Math.min(240, Math.round(f)));
}
