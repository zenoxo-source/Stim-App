// pattern-import.js - Validate + preview + merge imported pattern JSON.
//
// Format (matches PATTERN_EDITOR2.exportJSON):
//   {
//     "Pattern Name A": { steps: 16, channelA: [...], channelB: [...] },
//     "Pattern Name B": { ... }
//   }
//
// Pure functions for testing. UI glue lives in ui-library-tools.js.

import { log } from "../state.js";

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

// ---------------------------------------------------------------------------
// F6: XToys-style pattern import (tolerant multi-format).
// Accepts:
//   A: { version, patterns: [ {name, steps?, A: [], B: []} ] }   (XToys export)
//   B: { patterns: [ {name, patternA: [], patternB: [], steps?} ] }
//   C: { channels: [ {points: [{at, level}]}, ... ] }             (points-based)
//   D: plain map name → {steps, channelA, channelB}               (app format)
// ---------------------------------------------------------------------------

const XTOYS_MAX_BYTES = 1024 * 1024;
const XTOYS_STEPS = 32;

function clampStep(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function pointsToSteps(points, steps) {
  const out = new Array(steps).fill(0);
  if (!Array.isArray(points) || points.length === 0) return out;
  let maxAt = 0;
  for (const p of points) {
    if (p && Number.isFinite(p.at)) maxAt = Math.max(maxAt, Number(p.at));
  }
  if (maxAt <= 0) return out;
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * maxAt;
    // Linear interpolation between surrounding points.
    let prev = points[0];
    let next = points[points.length - 1];
    for (const p of points) {
      if (Number(p.at) <= t) prev = p;
      else {
        next = p;
        break;
      }
    }
    const span = Math.max(0.001, Number(next.at) - Number(prev.at));
    const frac = Math.max(0, Math.min(1, (t - Number(prev.at)) / span));
    const lvl = Number(prev.level) + (Number(next.level) - Number(prev.level)) * frac;
    out[i] = clampStep(lvl);
  }
  return out;
}

/**
 * Convert a parsed XToys/app pattern blob into app-format entries.
 * @param {any} data
 * @returns {{ok: boolean, error?: string, entries: Array<{name: string, pattern: {steps: number, channelA: number[], channelB: number[]}}>}}
 */
export function parseXToysImport(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Keine gültige JSON-Struktur." };
  }

  const out = [];
  const patterns = Array.isArray(data.patterns) ? data.patterns : [data];

  for (let idx = 0; idx < patterns.length && out.length < 50; idx++) {
    const p = patterns[idx];
    if (!p || typeof p !== "object") continue;

    // Points-based channels (XToys-style): channels: [{points: [...]}, {points: [...]}]
    if (
      Array.isArray(p.channels) &&
      p.channels.length >= 1 &&
      Array.isArray(p.channels[0].points)
    ) {
      const chA = pointsToSteps(p.channels[0].points, XTOYS_STEPS);
      const chB =
        p.channels[1] && Array.isArray(p.channels[1].points)
          ? pointsToSteps(p.channels[1].points, XTOYS_STEPS)
          : [...chA];
      out.push({
        name: String(p.name || p.title || `xtoys_${idx + 1}`)
          .trim()
          .slice(0, 60),
        pattern: { steps: XTOYS_STEPS, channelA: chA, channelB: chB },
      });
      continue;
    }

    // Array channels (A/B or patternA/patternB).
    const aArr = Array.isArray(p.A) ? p.A : Array.isArray(p.patternA) ? p.patternA : null;
    const bArr = Array.isArray(p.B) ? p.B : Array.isArray(p.patternB) ? p.patternB : null;
    if (aArr) {
      const steps = Math.min(XTOYS_STEPS, Math.max(4, Math.round(Number(p.steps) || XTOYS_STEPS)));
      const sample = (arr, n) => {
        const outA = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          const srcIdx = Math.min(arr.length - 1, Math.round((i / (n - 1)) * (arr.length - 1)));
          outA[i] = clampStep(arr[srcIdx]);
        }
        return outA;
      };
      const chA = sample(aArr, steps);
      const chB = bArr ? sample(bArr, steps) : [...chA];
      out.push({
        name: String(p.name || p.title || `xtoys_${idx + 1}`)
          .trim()
          .slice(0, 60),
        pattern: { steps, channelA: chA, channelB: chB },
      });
      continue;
    }

    // App format entry: {steps, channelA, channelB} or map-of-entries.
    if (Array.isArray(p.channelA) && Array.isArray(p.channelB)) {
      const v = validatePatternEntry(p);
      if (v.ok) {
        out.push({
          name: String(p.name || `pattern_${idx + 1}`)
            .trim()
            .slice(0, 60),
          pattern: v.sanitized,
        });
      }
      continue;
    }
    // Map format: name → {steps, channelA, channelB}
    const mapEntries = Object.entries(p).filter(
      ([, e]) =>
        e && typeof e === "object" && Array.isArray(e.channelA) && Array.isArray(e.channelB)
    );
    for (const [name, e] of mapEntries.slice(0, 50 - out.length)) {
      const v = validatePatternEntry(e);
      if (v.ok) {
        out.push({ name: String(name).trim().slice(0, 60), pattern: v.sanitized });
      }
    }
  }

  if (out.length === 0) {
    return { ok: false, error: "Keine Pattern-Strukturen erkannt." };
  }
  return { ok: true, entries: out };
}

/** Import a file (XToys or app format) into the editor's custom patterns. */
export function importXToysPatternFile(file) {
  return new Promise((resolve) => {
    if (file && file.size > XTOYS_MAX_BYTES) {
      resolve({ ok: false, error: "Datei zu groß (max 1 MB)." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const parsed = parseXToysImport(data);
        if (!parsed.ok) {
          resolve(parsed);
          return;
        }
        let custom = {};
        try {
          custom = JSON.parse(localStorage.getItem("stim_custom_patterns") || "{}");
        } catch {
          custom = {};
        }
        const renames = mergePatterns(custom, parsed.entries);
        try {
          localStorage.setItem("stim_custom_patterns", JSON.stringify(custom));
        } catch {
          /* quota */
        }
        resolve({ ok: true, count: parsed.entries.length, renames });
      } catch (err) {
        resolve({ ok: false, error: `JSON-Parsing fehlgeschlagen: ${err.message}` });
      }
    };
    reader.onerror = () => resolve({ ok: false, error: "Datei konnte nicht gelesen werden." });
    reader.readAsText(file);
  });
}

if (typeof document !== "undefined") {
  const wireXtoysUi = () => {
    document.getElementById("btn-editor-import-xtoys")?.addEventListener("click", () => {
      document.getElementById("input-editor-import-xtoys")?.click();
    });
    document.getElementById("input-editor-import-xtoys")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const r = await importXToysPatternFile(file);
        if (r.ok) {
          log(
            `${r.count} Pattern(s) importiert${r.renames && r.renames.length ? " (Umbenannt: " + r.renames.length + ")" : ""}.`,
            "success"
          );
        } else {
          log(`XToys-Import fehlgeschlagen: ${r.error}`, "error");
        }
        try {
          const { PATTERN_EDITOR2 } = await import("./pattern-editor-v2.js");
          PATTERN_EDITOR2.loadCustomPatterns();
          PATTERN_EDITOR2.renderSavedList();
        } catch {
          /* editor optional */
        }
      }
      e.target.value = "";
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireXtoysUi, { once: true });
  } else {
    wireXtoysUi();
  }
}
