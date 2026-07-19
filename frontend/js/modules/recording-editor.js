// recording-editor.js - Trim / loop / splice operations on RECORDER frames.
//
// All functions are pure (take a frames array, return a new array). UI glue
// in ui-bindings-pr3.js.
//
// Frame format (matches RECORDER.captureTick):
//   { t: number, fA: number, aA: number, fB: number, aB: number, strA: number, strB: number }
//
// All operations are non-destructive — they return NEW arrays. The caller is
// responsible for committing back to RECORDER.frames.

/**
 * Sort frames by their `t` field (defensive — usually already sorted).
 * @param {Array} frames
 * @returns {Array} new sorted array
 */
export function sortByTime(frames) {
  if (!Array.isArray(frames)) return [];
  return [...frames].sort((a, b) => a.t - b.t);
}

/**
 * Trim to a time window. Inclusive of startTimeMs, exclusive of endTimeMs.
 * @param {Array} frames
 * @param {number} startTimeMs
 * @param {number} endTimeMs
 * @returns {Array}
 */
export function trimByTime(frames, startTimeMs, endTimeMs) {
  if (!Array.isArray(frames)) return [];
  const start = Math.max(0, Number(startTimeMs) || 0);
  let end = Number(endTimeMs);
  if (!Number.isFinite(end)) end = Infinity;
  end = Math.max(start, end);
  return frames.filter((f) => f.t >= start && f.t < end);
}

/**
 * Trim by frame index range. Inclusive of startIdx, exclusive of endIdx.
 * @param {Array} frames
 * @param {number} startIdx
 * @param {number} endIdx
 * @returns {Array}
 */
export function trimByIndex(frames, startIdx, endIdx) {
  if (!Array.isArray(frames)) return [];
  return frames.slice(Math.max(0, startIdx), Math.max(0, endIdx));
}

/**
 * Loop a section N times. Each loop iteration shifts timestamps so playback
 * remains monotonic.
 * @param {Array} frames
 * @param {number} startTimeMs
 * @param {number} endTimeMs
 * @param {number} iterations Total iterations (1 = original section once).
 * @returns {Array}
 */
export function loopSection(frames, startTimeMs, endTimeMs, iterations) {
  if (!Array.isArray(frames)) return [];
  const iter = Math.max(1, Math.min(50, parseInt(iterations, 10) || 1));
  const section = trimByTime(frames, startTimeMs, endTimeMs);
  if (section.length === 0) return [];
  const sectionDuration = section[section.length - 1].t - section[0].t;
  const result = [];
  for (let i = 0; i < iter; i++) {
    const offset = i * sectionDuration;
    for (const frame of section) {
      result.push({ ...frame, t: frame.t + offset });
    }
  }
  // Re-zero so playback starts at 0
  const baseT = result[0].t;
  if (baseT !== 0) {
    for (const f of result) f.t -= baseT;
  }
  return result;
}

/**
 * Fade in: scale amplitudes linearly from 0 → original over the first N ms.
 * @param {Array} frames
 * @param {number} durationMs
 * @returns {Array}
 */
export function fadeIn(frames, durationMs) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const dur = Math.max(0, Number(durationMs) || 0);
  if (dur === 0) return [...frames];
  const startT = frames[0].t;
  return frames.map((f) => {
    const progress = Math.min(1, Math.max(0, (f.t - startT) / dur));
    return {
      ...f,
      aA: Math.round(f.aA * progress),
      aB: Math.round(f.aB * progress),
    };
  });
}

/**
 * Fade out: scale amplitudes linearly from original → 0 over the last N ms.
 * @param {Array} frames
 * @param {number} durationMs
 * @returns {Array}
 */
export function fadeOut(frames, durationMs) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const dur = Math.max(0, Number(durationMs) || 0);
  if (dur === 0) return [...frames];
  const endT = frames[frames.length - 1].t;
  return frames.map((f) => {
    const progress = Math.min(1, Math.max(0, (endT - f.t) / dur));
    return {
      ...f,
      aA: Math.round(f.aA * progress),
      aB: Math.round(f.aB * progress),
    };
  });
}

/**
 * Normalize: scale all amplitudes so the max value becomes `targetMax` (0–100).
 * @param {Array} frames
 * @param {number} targetMax
 * @returns {Array}
 */
export function normalize(frames, targetMax = 100) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const target = Math.max(0, Math.min(100, Number(targetMax) || 0));
  let peak = 0;
  for (const f of frames) {
    if (f.aA > peak) peak = f.aA;
    if (f.aB > peak) peak = f.aB;
  }
  if (peak === 0) return [...frames];
  const scale = target / peak;
  return frames.map((f) => ({
    ...f,
    aA: Math.min(100, Math.round(f.aA * scale)),
    aB: Math.min(100, Math.round(f.aB * scale)),
  }));
}

/**
 * Get total duration (ms) of a frames array.
 * @param {Array} frames
 * @returns {number}
 */
export function getDuration(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return 0;
  const last = frames[frames.length - 1];
  return last && typeof last.t === "number" ? last.t : 0;
}

/**
 * Format a millisecond duration as M:SS.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const sec = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
