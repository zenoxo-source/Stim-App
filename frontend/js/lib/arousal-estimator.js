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
 * @returns {{ arousal: number, confidence: number, components: object }}
 */
export function fuseArousal(sig = {}) {
  const w = AROUSAL_WEIGHTS;
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

  // Weighted average over PROVIDED signals only.
  let weightSum = 0;
  let sum = 0;
  if (components.hr != null) {
    sum += components.hr * w.hr;
    weightSum += w.hr;
  }
  if (components.motion != null) {
    sum += components.motion * w.motion;
    weightSum += w.motion;
  }
  if (components.breathHeld != null) {
    sum += components.breathHeld * w.breathHeld;
    weightSum += w.breathHeld;
  }
  if (components.breathRate != null) {
    sum += components.breathRate * w.breathRate;
    weightSum += w.breathRate;
  }
  if (components.edgeScore != null) {
    sum += components.edgeScore * w.edgeScore;
    weightSum += w.edgeScore;
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

  // Confidence: fraction of weighted signal mass actually present.
  const totalW = w.hr + w.motion + w.breathHeld + w.breathRate + w.edgeScore;
  const confidence = totalW > 0 ? clamp01(weightSum / totalW) : 0;

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
 * @param {number} [opts.kp] proportional gain (~0.35)
 * @returns {{ relStrength: number, mode: "track"|"fallback" }}
 */
export function arousalControllerStep({ arousal, setpoint, prevRel, confidence = 1, kp = 0.35 }) {
  const a = clamp01(Number(arousal) || 0);
  const sp = clamp01(Number(setpoint) || 0.8);
  const cur = clamp01(Number(prevRel) || 0);
  // If we don't trust the estimate, don't steer aggressively — climb gently.
  if (confidence < 0.34) {
    return { relStrength: clamp01(cur + 0.002), mode: "fallback" };
  }
  const err = sp - a; // positive = under-aroused → increase intensity
  // Asymmetric: back off faster than climb (avoid overshoot / "too strong").
  const gain = err >= 0 ? kp : kp * 1.6;
  const step = gain * err;
  return { relStrength: clamp01(cur + step), mode: "track" };
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
