// climax-protocol.js — Multi-wave climax protocol + push-retry budget.
//
// Pure ESM (browser + Node tests). Extracted from autodrive-engine.js so the
// finish-path heuristics ("Abspritzgarantie") are testable in isolation:
// - CLIMAX_WAVES / CLIMAX_WAVES_FINISH: crest/drop wave tables
// - climaxWaveTable(config): pick the finish table when climaxPriority is on
// - PUSH_RETRY / pushRetryBudget / pushBoostForRetry: bounded push retry loop
//   that re-arms the session after an unmarked push instead of ending it.
// - pushFloorRel: minimum relative strength during a finish push, so a
//   "too strong" drop cannot kill an orgasm that is already building.

/**
 * Multi-wave climax protocol segments (ms relative to phase start).
 * Each: { crestMs, dropMs, peakBoost }
 */
export const CLIMAX_WAVES = Object.freeze([
  { crestMs: 4000, dropMs: 1500, peakBoost: 0.0 },
  { crestMs: 5000, dropMs: 1000, peakBoost: 0.04 },
  { crestMs: 6000, dropMs: 800, peakBoost: 0.08 },
  { crestMs: 12000, dropMs: 0, peakBoost: 0.12 }, // final hold
]);

/** Finish-path: shorter drops, longer final crest (less chance to lose orgasm). */
export const CLIMAX_WAVES_FINISH = Object.freeze([
  { crestMs: 3500, dropMs: 900, peakBoost: 0.02 },
  { crestMs: 5000, dropMs: 600, peakBoost: 0.06 },
  { crestMs: 7000, dropMs: 400, peakBoost: 0.1 },
  { crestMs: 20000, dropMs: 0, peakBoost: 0.14 }, // long final hold
]);

/**
 * Commit-path: a single long crest with NO drops. Used by the "silent commit"
 * heuristic — when the user has signalled "almost" repeatedly without a
 * "too strong" response, the engine switches to a sustained peak hold (duty
 * ~1.0, sharp freq) to help push them over the edge instead of dipping.
 * Many users never press "Fertig ✓" in time; this does not mark a climax, it
 * only keeps the drive committed for the final stretch.
 */
export const CLIMAX_WAVES_COMMIT = Object.freeze([
  { crestMs: 28000, dropMs: 0, peakBoost: 0.16 }, // single long committed hold
]);

/**
 * Push-retry budget for finish templates ("Abspritzgarantie").
 * After a CLIMAX_PUSH timeout without a marked climax the session re-arms a
 * short TEASE slice and pushes again with more boost instead of ending.
 * Bounded — safety (Panic/Stop/Soft-Limits) is untouched.
 */
export const PUSH_RETRY = Object.freeze({
  /** Max extra push attempts after an unmarked push timeout. */
  maxRetries: 2,
  /** Re-arm TEASE slice before the next push attempt (ms). */
  reArmMs: 40000,
  /** Extra pushBoostRemaining per retry (each retry adds one boost wave). */
  boostPerRetry: 1,
  /** Minimum relative strength in a finish push (too_strong floor). */
  floorRel: 0.62,
});

/**
 * @param {object} [config]
 * @returns {typeof CLIMAX_WAVES_FINISH | typeof CLIMAX_WAVES | typeof CLIMAX_WAVES_COMMIT}
 */
export function climaxWaveTable(config) {
  if (config?.commitMode) return CLIMAX_WAVES_COMMIT;
  return config?.climaxPriority ? CLIMAX_WAVES_FINISH : CLIMAX_WAVES;
}

/**
 * @param {object} [config]
 * @returns {{ enabled: boolean, maxRetries: number }}
 */
export function pushRetryBudget(config) {
  if (!config?.pushRetry) return { enabled: false, maxRetries: 0 };
  return { enabled: true, maxRetries: PUSH_RETRY.maxRetries };
}

/**
 * Extra push boosts granted on the n-th retry (1-based retry count).
 * @param {number} retryN
 * @returns {number}
 */
export function pushBoostForRetry(retryN) {
  return Math.max(0, (Number(retryN) || 0) * PUSH_RETRY.boostPerRetry);
}

/**
 * Finish-push floor: relStrength never drops below this in CLIMAX_PUSH when
 * climaxPriority is on. Each retry raises the floor slightly (the user is
 * "warm" already), capped so it never pins strength at 1.
 * @param {object} [config]
 * @param {number} [retryN]
 * @returns {number}
 */
export function pushFloorRel(config, retryN = 0) {
  const n = Math.max(0, Number(retryN) || 0);
  return Math.min(0.72, PUSH_RETRY.floorRel + n * 0.04);
}

// ---------------------------------------------------------------------------
// v6.2 "Smarter Abspritzgarantie" — silent-commit heuristic + biofeedback.
// Pure predicates so the engine stays a thin reducer; every branch below is
// covered by unit tests.
// ---------------------------------------------------------------------------

/** Min. number of "almost" signals without a climax before commit kicks in. */
export const COMMIT_ALMOST_THRESHOLD = 2;
/** Below this edge-score the user is not considered on the edge yet. */
export const COMMIT_EDGE_SCORE_MIN = 65;
/** How long a sustained HR spike must last before it can trigger commit (ms). */
export const COMMIT_HR_SUSTAINED_MS = 8000;
/** HR delta (bpm over baseline) that counts as a strong arousal spike. */
export const COMMIT_HR_SPIKE_DELTA = 14;

// v6.3 closed-loop thresholds (arousal estimator 0..1).
/** Arousal level that counts as "on the edge". */
export const COMMIT_AROUSAL_THRESHOLD = 0.82;
/** Estimator confidence floor for arousal-based decisions (cold-start safety). */
export const COMMIT_AROUSAL_CONFIDENCE = 0.4;
/** How long high arousal must be sustained before it triggers commit (ms). */
export const COMMIT_AROUSAL_SUSTAINED_MS = 6000;
/** Arousal + confidence + sustained high → opt-in auto climax. */
export const AUTO_CLIMAX_AROUSAL_THRESHOLD = 0.94;

/**
 * Silent-commit decision: should the engine switch the multi-wave push to a
 * single sustained peak hold (no drops)?
 *
 * Rationale (see docs/DESIGN-abspritzgarantie.md §2.5): a user who repeatedly
 * reports "almost" during a finish push without ever reporting "too strong" is
 * very likely on the edge but not pressing "Fertig ✓". Dipping the strength
 * in that window can lose the orgasm. Commit mode removes the dips for the
 * final stretch — it does NOT mark a climax.
 *
 * @param {object} ctx
 * @param {number} ctx.almostWithoutClimax Consecutive "almost" count since last climax.
 * @param {boolean} ctx.tooStrongRecent A "too strong" landed in the last ~12 s.
 * @param {number} [ctx.edgeScore] Current edge score (0–100).
 * @param {boolean} [ctx.climaxPriority] Only commit on finish paths.
 * @returns {boolean}
 */
export function commitThreshold({
  almostWithoutClimax,
  tooStrongRecent,
  edgeScore,
  climaxPriority,
}) {
  if (!climaxPriority) return false;
  if (tooStrongRecent) return false; // never override an explicit "too strong"
  const a = Number(almostWithoutClimax) || 0;
  if (a < COMMIT_ALMOST_THRESHOLD) return false;
  const score = Number(edgeScore) || 0;
  return score >= COMMIT_EDGE_SCORE_MIN;
}

/**
 * Biofeedback-driven commit trigger: a sustained HR spike (arousal) can flip
 * on commit mode even without manual "almost" presses. Requires the session
 * to be on a finish path (climaxPriority).
 *
 * @param {object} ctx
 * @param {number} [ctx.hrDelta] bpm over baseline (positive = arousal).
 * @param {number} [ctx.sustainedMs] How long the spike has been held.
 * @param {boolean} [ctx.climaxPriority]
 * @param {boolean} [ctx.tooStrongRecent]
 * @returns {boolean}
 */
export function commitFromBiofeedback({ hrDelta, sustainedMs, climaxPriority, tooStrongRecent }) {
  if (!climaxPriority) return false;
  if (tooStrongRecent) return false;
  const d = Number(hrDelta) || 0;
  const ms = Number(sustainedMs) || 0;
  return d >= COMMIT_HR_SPIKE_DELTA && ms >= COMMIT_HR_SUSTAINED_MS;
}

/**
 * Opt-in auto-climax signal. Only fires when the user has explicitly enabled
 * `autoClimax` (default off — consent). Requires commit mode to already be
 * active AND a sustained maximum edge score AND a strong HR spike. This is the
 * only path that marks a climax without the user pressing the button.
 *
 * @param {object} ctx
 * @param {boolean} ctx.autoClimaxEnabled Explicit opt-in.
 * @param {boolean} [ctx.commitActive]
 * @param {number} [ctx.edgeScore]
 * @param {number} [ctx.hrDelta]
 * @param {number} [ctx.sustainedPeakMs]
 * @returns {boolean}
 */
export function autoClimaxSignal({
  autoClimaxEnabled,
  commitActive,
  edgeScore,
  hrDelta,
  sustainedPeakMs,
}) {
  if (!autoClimaxEnabled) return false;
  if (!commitActive) return false;
  const score = Number(edgeScore) || 0;
  if (score < 90) return false;
  const d = Number(hrDelta) || 0;
  const ms = Number(sustainedPeakMs) || 0;
  return d >= COMMIT_HR_SPIKE_DELTA && ms >= COMMIT_HR_SUSTAINED_MS;
}

/**
 * Adaptive push extension: each "almost" during a push and each retry lengthens
 * the deadline so the drive does not time out while arousal is still climbing.
 * Bounded so a stuck session still ends.
 * @param {object} ctx
 * @param {number} [ctx.almostWithoutClimax]
 * @param {number} [ctx.retries]
 * @returns {number} ms to add to the push deadline
 */
export function adaptivePushExtensionMs({ almostWithoutClimax, retries } = {}) {
  const a = Math.max(0, Number(almostWithoutClimax) || 0);
  const r = Math.max(0, Number(retries) || 0);
  // 18 s per consecutive almost (capped at 5), +12 s per retry spent.
  const perAlmost = Math.min(a, 5) * 18000;
  const perRetry = Math.min(r, PUSH_RETRY.maxRetries) * 12000;
  return perAlmost + perRetry;
}

// ---------------------------------------------------------------------------
// v6.3 closed-loop arousal predicates. Complement the manual/biofeedback
// paths with a continuous-arousal decision (see lib/arousal-estimator.js).
// ---------------------------------------------------------------------------

/**
 * Silent-commit from continuous arousal: if the fused arousal estimate has
 * been high and trustworthy for a while on a finish path, switch to the
 * sustained peak hold — independent of manual "almost" presses.
 *
 * @param {object} ctx
 * @param {number} [ctx.arousal] 0..1 fused arousal
 * @param {number} [ctx.confidence] 0..1 estimator confidence
 * @param {number} [ctx.sustainedMs] how long arousal stayed high
 * @param {boolean} [ctx.climaxPriority]
 * @param {boolean} [ctx.tooStrongRecent]
 * @returns {boolean}
 */
export function commitFromArousal({
  arousal,
  confidence,
  sustainedMs,
  climaxPriority,
  tooStrongRecent,
}) {
  if (!climaxPriority) return false;
  if (tooStrongRecent) return false;
  const a = Number(arousal) || 0;
  const c = Number(confidence) || 0;
  const ms = Number(sustainedMs) || 0;
  if (a < COMMIT_AROUSAL_THRESHOLD) return false;
  if (c < COMMIT_AROUSAL_CONFIDENCE) return false;
  return ms >= COMMIT_AROUSAL_SUSTAINED_MS;
}

/**
 * Opt-in auto-climax from sustained peak arousal. Requires explicit consent
 * (autoClimaxEnabled), active commit, and a long, confident high-arousal
 * plateau. This is the path that finally marks the climax without the user
 * pressing the button — the silent majority's friend.
 *
 * @param {object} ctx
 * @param {boolean} ctx.autoClimaxEnabled
 * @param {boolean} [ctx.commitActive]
 * @param {number} [ctx.arousal]
 * @param {number} [ctx.confidence]
 * @param {number} [ctx.sustainedMs]
 * @returns {boolean}
 */
export function autoClimaxFromArousal({
  autoClimaxEnabled,
  commitActive,
  arousal,
  confidence,
  sustainedMs,
}) {
  if (!autoClimaxEnabled) return false;
  if (!commitActive) return false;
  const a = Number(arousal) || 0;
  const c = Number(confidence) || 0;
  const ms = Number(sustainedMs) || 0;
  if (a < AUTO_CLIMAX_AROUSAL_THRESHOLD) return false;
  if (c < COMMIT_AROUSAL_CONFIDENCE) return false;
  // Auto-climax needs a slightly longer plateau than commit to avoid false
  // positives — orgasm is the point of no return.
  return ms >= COMMIT_AROUSAL_SUSTAINED_MS + 2000;
}
