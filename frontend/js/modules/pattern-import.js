// pattern-import.js - Validate + preview + merge imported pattern JSON.
//
// Format (matches PATTERN_EDITOR2.exportJSON):
//   {
//     "Pattern Name A": { steps: 16, channelA: [...], channelB: [...] },
//     "Pattern Name B": { ... }
//   }
//
// Pure functions for testing. UI glue lives in ui-bindings-pr3.js.

/**
 * Validate an imported pattern object (single entry).
 * @param {any} entry
 * @returns {{ ok: boolean, error?: string, sanitized?: {steps: number, channelA: number[], channelB: number[]} }}
 */
export function validatePatternEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: "Eintrag muss ein Objekt sein" };
  }
  const steps = Number(entry.steps);
  if (!Number.isInteger(steps) || steps < 1 || steps > 256) {
    return { ok: false, error: "steps muss Ganzzahl in 1–256 sein" };
  }
  if (!Array.isArray(entry.channelA) || !Array.isArray(entry.channelB)) {
    return { ok: false, error: "channelA und channelB müssen Arrays sein" };
  }
  if (entry.channelA.length !== steps || entry.channelB.length !== steps) {
    return { ok: false, error: `channelA/B müssen je ${steps} Werte haben` };
  }
  const sanitize = (arr) =>
    arr.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    });
  return {
    ok: true,
    sanitized: { steps, channelA: sanitize(entry.channelA), channelB: sanitize(entry.channelB) },
  };
}

/**
 * Validate a full import payload (map of name → entry).
 * Returns list of valid + list of errors.
 * @param {string} rawJson
 * @returns {{ valid: Array<{name: string, pattern: object}>, errors: Array<{name: string, error: string}>, fatalError?: string }}
 */
export function parseImportPayload(rawJson) {
  let data;
  try {
    data = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
  } catch (err) {
    return { valid: [], errors: [], fatalError: `JSON-Parsing fehlgeschlagen: ${err.message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: [], errors: [], fatalError: "Payload muss ein Objekt sein" };
  }
  const valid = [];
  const errors = [];
  for (const [name, entry] of Object.entries(data)) {
    if (typeof name !== "string" || !name.trim()) {
      errors.push({ name: String(name), error: "Name fehlt" });
      continue;
    }
    const result = validatePatternEntry(entry);
    if (result.ok) {
      valid.push({ name: name.trim(), pattern: result.sanitized });
    } else {
      errors.push({ name, error: result.error });
    }
  }
  return { valid, errors };
}

/**
 * Compute a quick stats summary of a pattern (for UI preview).
 * @param {{steps: number, channelA: number[], channelB: number[]}} pattern
 * @returns {{avgA: number, avgB: number, maxA: number, maxB: number, peakStepA: number, peakStepB: number}}
 */
export function summarizePattern(pattern) {
  if (!pattern || !Array.isArray(pattern.channelA) || !Array.isArray(pattern.channelB)) {
    return { avgA: 0, avgB: 0, maxA: 0, maxB: 0, peakStepA: 0, peakStepB: 0 };
  }
  const stats = (arr) => {
    if (arr.length === 0) return { avg: 0, max: 0, peak: 0 };
    let sum = 0;
    let max = -Infinity;
    let peak = 0;
    arr.forEach((v, i) => {
      sum += v;
      if (v > max) {
        max = v;
        peak = i;
      }
    });
    return { avg: sum / arr.length, max, peak };
  };
  const a = stats(pattern.channelA);
  const b = stats(pattern.channelB);
  return {
    avgA: Math.round(a.avg * 10) / 10,
    avgB: Math.round(b.avg * 10) / 10,
    maxA: a.max,
    maxB: b.max,
    peakStepA: a.peak,
    peakStepB: b.peak,
  };
}

/**
 * Merge validated patterns into an existing customPatterns map. Existing names
 * get a "_imported_N" suffix to avoid silent overwrites.
 * @param {Record<string, object>} target
 * @param {Array<{name: string, pattern: object}>} additions
 * @returns {Array<{original: string, storedAs: string}>} rename log
 */
export function mergePatterns(target, additions) {
  const renames = [];
  for (const { name, pattern } of additions) {
    let finalName = name;
    let n = 1;
    while (target[finalName]) {
      finalName = `${name}_imported_${n}`;
      n++;
    }
    target[finalName] = { ...pattern };
    renames.push({ original: name, storedAs: finalName });
  }
  return renames;
}
