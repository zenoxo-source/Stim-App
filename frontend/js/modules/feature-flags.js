// feature-flags.js — Progressive feature flags (stim_app_flags_v1).
// Defaults keep legacy UX until explicitly enabled (or product 4.0 defaults).

const FLAGS_KEY = "stim_app_flags_v1";

/** @type {Readonly<Record<string, boolean>>} */
export const FLAG_DEFAULTS = Object.freeze({
  autodrive: true,
  newNav: true,
  homeDefault: true,
  outputOwnerStrict: false,
  hideLegacyPatternEditor: true,
});

/**
 * @returns {Record<string, boolean>}
 */
export function loadFlags() {
  try {
    const raw = localStorage.getItem(FLAGS_KEY);
    if (!raw) return { ...FLAG_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...FLAG_DEFAULTS };
    const out = { ...FLAG_DEFAULTS };
    for (const k of Object.keys(FLAG_DEFAULTS)) {
      if (typeof parsed[k] === "boolean") out[k] = parsed[k];
    }
    return out;
  } catch {
    return { ...FLAG_DEFAULTS };
  }
}

/**
 * @param {Partial<Record<string, boolean>>} patch
 * @returns {Record<string, boolean>}
 */
export function saveFlags(patch = {}) {
  const merged = { ...loadFlags() };
  for (const [k, v] of Object.entries(patch)) {
    if (k in FLAG_DEFAULTS && typeof v === "boolean") merged[k] = v;
  }
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore quota */
  }
  return merged;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isFlagEnabled(name) {
  const flags = loadFlags();
  if (Object.prototype.hasOwnProperty.call(flags, name)) return !!flags[name];
  return false;
}
