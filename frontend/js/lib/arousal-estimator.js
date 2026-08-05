// arousal-estimator.js — Continuous arousal estimate (0..1) fused from
// multiple biofeedback signals.
//
// Pure ESM (browser + Node tests). This is the foundation of the v6.3
// closed-loop Autodrive controller: instead of following a fixed intensity
// envelope, the engine can regulate relStrength to keep arousal near a
// setpoint (the "edge") — the single biggest lever for reliably reaching a
// climax.
//
// Design notes:
//   - Each raw signal is normalised to a 0..1 contribution.
//   - A weighted fusion produces `arousal` (0..1).
//   - `confidence` (0..1) reflects how many real signals were present, so the
//     controller knows whether to trust the estimate (cold-start safety).
//   - Held breath is a strong, specific pre-orgasm marker and gets its own
//     boost once sustained for a few seconds.
//   - All inputs optional; missing signals simply don't contribute.

/** Saturated mapping of HR-over-baseline (bpm) → 0..1. +25 bpm ≈ max. */
export function normaliseHrDelta(hrDelta) {
  const d = Number(hrDelta);
  if (!Number.isFinite(d)) return 0;
  return clamp01(d / 25);
}

/** Motion energy is already 0..1 (from webcam-vision). */
export function normaliseMotion(motion) {
  const m = Number(motion);
  if (!Number.isFinite(m)) return 0;
  // Mild gamma to emphasise the meaningful range (0.02..0.12 → noticeable).
  return clamp01(Math.pow(clamp01(m / 0.12), 0.7));
}

/** Breath rate (breaths/min): ~12 resting → ~0.3, ~24 highly aroused → 1. */
export function normaliseBreathRate(breathsPerMin) {
  const b = Number(breathsPerMin);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return clamp01((b - 10) / 16);
}

/**
 * Held-breath score. Breath holding (no mic envelope for a few seconds) is a
 * classic pre-orgasm / high-arousal marker. Saturates around 4 s.
 * @param {number} heldMs how long the breath has been held (0 if breathing)
 * @returns {number} 0..1
 */
export function heldBreathScore(heldMs) {
  const ms = Math.max(0, Number(heldMs) || 0);
  if (ms < 1200) return 0; // brief pauses are noise
  return clamp01((ms - 1200) / 2800);
}

/** Edge score (engine-internal 0..100) → 0..1. */
function normaliseEdgeScore(score) {
  return clamp01((Number(score) || 0) / 100);
}

export const AROUSAL_WEIGHTS = Object.freeze({
  hr: 0.26,
  motion: 0.16,
  breathHeld: 0.22,
  breathRate: 0.1,
  edgeScore: 0.26,
});

/**
 * v6.4 (#2): merge learned per-user weights with the defaults. Learned entries
 * override (validated to 0..1); the result is NOT re-normalised so a channel
 * the user climaxed with can genuinely dominate. All inputs clamped/sanitised.
 * @param {object} [learned] partial { hr, motion, breathHeld, breathRate, edgeScore }
 * @returns {object} a fresh weights object
 */
export function resolveWeights(learned) {
  const out = { ...AROUSAL_WEIGHTS };
  if (!learned || typeof learned !== "object") return out;
  for (const k of Object.keys(AROUSAL_WEIGHTS)) {
    const v = Number(learned[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 1) out[k] = v;
  }
  return out;
}

/**
 * v6.4 (#4): per-signal quality (0..1). Presence alone over-trusts a noisy or
 * stale sample; quality damps how much each present signal contributes to the
 * confidence and the weighted arousal.
 * @typedef {Object} ArousalOptions
 * @property {object} [weights] resolved weights (else AROUSAL_WEIGHTS)
 * @property {{hr?:number,motion?:number,breathHeld?:number,breathRate?:number,edgeScore?:number}} [quality] 0..1 per channel
 */

/**
 * Fuse all available signals into a continuous arousal estimate.
 *
 * @param {object} sig
 * @param {number} [sig.hrDelta] bpm over baseline
 * @param {number} [sig.motion] 0..1 webcam motion energy
 * @param {number} [sig.breathHeldMs] ms the breath has been held
 * @param {number} [sig.breathRate] breaths/min
 * @param {number} [sig.edgeScore] 0..100 engine edge score
 * @param {number} [sig.recentAlmost] consecutive manual "almost" (small nudge)
 * @param {number} [sig.prev] previous smoothed arousal (for continuity)
 * @param {ArousalOptions} [opts] v6.4: custom weights + per-signal quality
 * @returns {{ arousal: number, confidence: number, components: object }}
 */
export function fuseArousal(sig = {}, opts = {}) {
  const w = opts.weights || AROUSAL_WEIGHTS;
  const q = opts.quality || {};
  const qOf = (k) => {
    const v = Number(q[k]);
    return Number.isFinite(v) ? clamp01(v) : 1; // unknown quality = neutral
  };
  const provided = {
    hr: sig.hrDelta != null && Number.isFinite(Number(sig.hrDelta)),
    motion: sig.motion != null && Number.isFinite(Number(sig.motion)),
    breathHeld: sig.breathHeldMs != null && Number(sig.breathHeldMs) > 0,
    breathRate: sig.breathRate != null && Number(sig.breathRate) > 0,
    edgeScore: sig.edgeScore != null && Number.isFinite(Number(sig.edgeScore)),
  };

  const components = {
    hr: provided.hr ? normaliseHrDelta(sig.hrDelta) : null,
    motion: provided.motion ? normaliseMotion(sig.motion) : null,
    breathHeld: provided.breathHeld ? heldBreathScore(sig.breathHeldMs) : null,
    breathRate: provided.breathRate ? normaliseBreathRate(sig.breathRate) : null,
    edgeScore: provided.edgeScore ? normaliseEdgeScore(sig.edgeScore) : null,
  };

  // Weighted average over PROVIDED signals, damped by per-signal quality.
  let weightSum = 0;
  let sum = 0;
  if (components.hr != null) {
    const eff = w.hr * qOf("hr");
    sum += components.hr * eff;
    weightSum += eff;
  }
  if (components.motion != null) {
    const eff = w.motion * qOf("motion");
    sum += components.motion * eff;
    weightSum += eff;
  }
  if (components.breathHeld != null) {
    const eff = w.breathHeld * qOf("breathHeld");
    sum += components.breathHeld * eff;
    weightSum += eff;
  }
  if (components.breathRate != null) {
    const eff = w.breathRate * qOf("breathRate");
    sum += components.breathRate * eff;
    weightSum += eff;
  }
  if (components.edgeScore != null) {
    const eff = w.edgeScore * qOf("edgeScore");
    sum += components.edgeScore * eff;
    weightSum += eff;
  }

  // Manual "almost" is a small direct nudge on top (it's explicit signal).
  const almostNudge = clamp01((Number(sig.recentAlmost) || 0) * 0.05);

  let arousal = weightSum > 0 ? sum / weightSum : 0;
  arousal = clamp01(arousal + almostNudge);

  // Held-breath bonus: a sustained held breath pushes arousal up decisively
  // (it's a near-orgasm marker), even if other signals are mid-range.
  if (components.breathHeld != null && components.breathHeld > 0.6) {
    arousal = clamp01(Math.max(arousal, 0.7 + components.breathHeld * 0.25));
  }

  // Confidence: weighted fraction of signal mass present AND trustworthy.
  const effTotalW =
    w.hr * qOf("hr") +
    w.motion * qOf("motion") +
    w.breathHeld * qOf("breathHeld") +
    w.breathRate * qOf("breathRate") +
    w.edgeScore * qOf("edgeScore");
  const confidence = effTotalW > 0 ? clamp01(weightSum / effTotalW) : 0;

  return { arousal, confidence, components };
}

/**
 * Closed-loop controller step (PID-lite). Drives arousal toward a setpoint by
 * returning a relative-strength delta to apply this tick.
 *
 * @param {object} opts
 * @param {number} opts.arousal current fused arousal 0..1
 * @param {number} opts.setpoint target arousal (e.g. 0.8 hold, 0.92 push)
 * @param {number} opts.prevRel previous relStrength 0..1
 * @param {number} [opts.confidence] estimator confidence — below a floor the
 *   controller falls back to a gentle open-loop climb (cold-start safety).
 * @param {number} [opts.kp] proportional gain; v6.4: pass a phase-specific gain
 *   from phaseControllerGain() for tighter tracking in the push.
 * @param {number} [opts.recoveringUntil] timestamp until which the controller
 *   stays in a gentle fallback (post too_strong recovery, v6.4 #5).
 * @param {number} [opts.now] current time (ms) for the recovery check
 * @returns {{ relStrength: number, mode: "track"|"fallback" }}
 */
export function arousalControllerStep({
  arousal,
  setpoint,
  prevRel,
  confidence = 1,
  kp = 0.35,
  recoveringUntil = 0,
  now = 0,
}) {
  const a = clamp01(Number(arousal) || 0);
  const sp = clamp01(Number(setpoint) || 0.8);
  const cur = clamp01(Number(prevRel) || 0);
  // Recovery gate: right after a "too strong" the user needs space — don't
  // re-climb aggressively even if arousal looks low.
  const recovering = Number(recoveringUntil) > 0 && now < recoveringUntil;
  if (confidence < 0.34 || recovering) {
    return { relStrength: clamp01(cur + 0.002), mode: "fallback" };
  }
  const err = sp - a; // positive = under-aroused → increase intensity
  // Asymmetric: back off faster than climb (avoid overshoot / "too strong").
  const gain = err >= 0 ? kp : kp * 1.6;
  const step = gain * err;
  return { relStrength: clamp01(cur + step), mode: "track" };
}

/**
 * v6.4 (#1): resolve the closed-loop arousal setpoint for a phase, using the
 * user's learned personal edge / push levels when available. This is the
 * missing half of v6.3: the controller now holds YOU at YOUR edge instead of
 * a population average.
 *
 * @param {string} phase engine phase
 * @param {object} [learned] { edgeArousal, pushArousal } 0..1, 0 = unknown
 * @returns {number} target arousal 0..1
 */
export function closedLoopSetpoint(phase, learned = {}) {
  const edge = clamp01(Number(learned.edgeArousal) || PERSONAL_DEFAULTS.edgeArousal);
  const push = clamp01(Number(learned.pushArousal) || PERSONAL_DEFAULTS.pushArousal);
  switch (phase) {
    case "WARMUP":
      return 0.42;
    case "CALIBRATING":
      return 0.35;
    case "BUILD":
      return edge * 0.74;
    case "TEASE":
      return edge * 0.88;
    case "EDGE_HOLD":
      return edge;
    case "SURGE":
      return (edge + push) / 2;
    case "CLIMAX_PUSH":
      return push;
    default:
      return edge;
  }
}

/** Population-average fallbacks for the personal edge/push (until learned). */
export const PERSONAL_DEFAULTS = Object.freeze({
  edgeArousal: 0.82,
  pushArousal: 0.94,
});

/**
 * v6.4 (#5): phase-specific proportional gain. The push needs fast tracking;
 * BUILD/WARMUP want a slow, gentle approach.
 * @param {string} phase
 * @returns {number} kp
 */
export function phaseControllerGain(phase) {
  switch (phase) {
    case "WARMUP":
    case "BUILD":
      return 0.22;
    case "TEASE":
      return 0.3;
    case "EDGE_HOLD":
      return 0.4;
    case "SURGE":
      return 0.45;
    case "CLIMAX_PUSH":
      return 0.5; // aggressive tracking at the critical moment
    default:
      return 0.3;
  }
}

/**
 * v6.4 (#1): update a personal-edge EMA from one observed sample. Pure.
 * @param {number} prev previous EMA value (0 = uninitialised)
 * @param {number} sample observed arousal at an "almost"/climax event
 * @param {number} [alpha] learning rate (default 0.35)
 * @returns {number} new EMA, clamped 0.55..0.99
 */
export function updatePersonalArousal(prev, sample, alpha = 0.35) {
  const s = clamp01(Number(sample) || 0);
  if (s <= 0) return clamp01(Number(prev) || 0);
  const p = Number(prev);
  const next = p > 0 ? p * (1 - alpha) + s * alpha : s;
  return clamp01(Math.max(0.55, Math.min(0.99, next)));
}

/**
 * v6.4 (#2): nudge one signal weight toward the channels that were elevated
 * when the user climaxed (so the estimator trusts what predicts orgasm for
 * THEM). Pure, bounded.
 * @param {object} weights current resolved weights
 * @param {object} elevated { hr, motion, breathHeld, breathRate } 0..1 at climax
 * @param {number} [step] nudge magnitude (default 0.04)
 * @returns {object} new weights (clamped 0.05..0.6)
 */
export function nudgeWeights(weights, elevated, step = 0.04) {
  const base = weights || AROUSAL_WEIGHTS;
  const out = { ...base };
  const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  for (const k of ["hr", "motion", "breathHeld", "breathRate"]) {
    const e = clamp01(Number(elevated?.[k]) || 0);
    // Normalised weight vs normalised elevation: raise if under-weighted vs
    // how elevated the channel was at climax, lower otherwise.
    const wShare = out[k] / total;
    const dir = e > wShare ? 1 : -1;
    out[k] = Math.max(0.05, Math.min(0.6, out[k] + dir * step));
  }
  return out;
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
