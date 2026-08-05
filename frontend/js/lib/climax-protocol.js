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
 * @returns {typeof CLIMAX_WAVES_FINISH | typeof CLIMAX_WAVES}
 */
export function climaxWaveTable(config) {
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
