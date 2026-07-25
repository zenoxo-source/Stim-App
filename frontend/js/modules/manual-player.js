// manual-player.js — XToys-inspired Manual / Coyote controller helpers
// Link channels, frequency-follows-intensity, pattern catalog copy.

import { AppState, DOM, log } from "../state.js";
import { clampWireFreq } from "../lib/protocol-utils.js";

const CFG_KEY = "stim_app_manual_player_v1";

/** @typedef {"fixed"|"with_intensity"|"inverse_intensity"} ManualFreqMode */

export const MANUAL_DEFAULTS = Object.freeze({
  /** When true, changing A strength mirrors to B (and vice versa if bothLink). */
  linkStrength: false,
  linkFreq: false,
  /** XToys "update frequency when intensity changes" */
  freqMode: /** @type {ManualFreqMode} */ ("fixed"),
  freqMin: 30,
  freqMax: 100,
  /** Show strength as % of soft-limit on circles */
  showPercent: true,
});

/**
 * XToys-style pattern catalog: short sensation-oriented descriptions.
 * Keys match data-pattern attributes / CONSTANTS.PATTERNS values.
 */
export const MANUAL_PATTERN_INFO = Object.freeze({
  gentle: {
    name: "Gentle Breeze",
    desc: "Weiche, langsame Wellen — Einstieg & Warm-up (XToys: soft pattern)",
  },
  rhythm: {
    name: "Rhythm Beats",
    desc: "Abwechselnde Pulse A/B — Rhythmus wie Pattern-Beat",
  },
  tease: {
    name: "Tease & Release",
    desc: "Aufbau und kurzer Drop — Edge-Training",
  },
  climax: {
    name: "Climax Sweep",
    desc: "Steigende Intensität der Wave-Amp — Push-Phase",
  },
  strobe: {
    name: "Strobe",
    desc: "Harte On/Off-Impulse — scharf, kurz",
  },
  random: {
    name: "Random",
    desc: "Zufällige Amp-Sprünge — Überraschungseffekt",
  },
  wave: {
    name: "Wave Sweep",
    desc: "Sinus über Amp + leichte Freq-Wanderung",
  },
  heartbeat: {
    name: "Heartbeat",
    desc: "Doppel-Schlag-Muster — organisch",
  },
  alternate: {
    name: "Alternate",
    desc: "Strikt A dann B — Kanal-Wechsel",
  },
  escalate: {
    name: "Escalate",
    desc: "Stufenweise lauter — Trainings-Rampe in der Wave",
  },
  flutter: {
    name: "Flutter",
    desc: "Schnelle Mikro-Pulse — kitzelig",
  },
  drift: {
    name: "Drift",
    desc: "Langsame Drift von Amp/Freq — meditativ",
  },
  sawtooth: {
    name: "Sawtooth",
    desc: "Sägezahn-Anstieg, harter Reset",
  },
  duet: {
    name: "Duet",
    desc: "A und B phasenversetzt — Stereo-Spiel",
  },
});

/**
 * @returns {typeof MANUAL_DEFAULTS}
 */
export function loadManualConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { ...MANUAL_DEFAULTS };
    const p = JSON.parse(raw);
    return sanitiseManualConfig({ ...MANUAL_DEFAULTS, ...p });
  } catch {
    return { ...MANUAL_DEFAULTS };
  }
}

/**
 * @param {Partial<typeof MANUAL_DEFAULTS>} patch
 */
export function saveManualConfig(patch = {}) {
  const merged = sanitiseManualConfig({ ...loadManualConfig(), ...patch });
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/**
 * @param {object} input
 */
export function sanitiseManualConfig(input) {
  const d = { ...MANUAL_DEFAULTS };
  if (!input || typeof input !== "object") return d;
  if (typeof input.linkStrength === "boolean") d.linkStrength = input.linkStrength;
  if (typeof input.linkFreq === "boolean") d.linkFreq = input.linkFreq;
  if (typeof input.showPercent === "boolean") d.showPercent = input.showPercent;
  const mode = String(input.freqMode || "");
  if (mode === "fixed" || mode === "with_intensity" || mode === "inverse_intensity") {
    d.freqMode = mode;
  }
  const n = (v, lo, hi, fb) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fb;
  };
  d.freqMin = n(input.freqMin, 10, 240, d.freqMin);
  d.freqMax = n(input.freqMax, 10, 240, d.freqMax);
  if (d.freqMin > d.freqMax) {
    const t = d.freqMin;
    d.freqMin = d.freqMax;
    d.freqMax = t;
  }
  return d;
}

/**
 * Map strength 0..softLimit → frequency range (XToys intensity→frequency).
 * @param {number} strength
 * @param {number} softLimit
 * @param {ReturnType<typeof loadManualConfig>} cfg
 * @returns {number}
 */
export function mapStrengthToFreq(strength, softLimit, cfg) {
  const soft = Math.max(1, softLimit || 200);
  const s = Math.max(0, Math.min(soft, Number(strength) || 0));
  const rel = s / soft;
  const lo = cfg.freqMin;
  const hi = cfg.freqMax;
  let t = rel;
  if (cfg.freqMode === "inverse_intensity") t = 1 - rel;
  if (cfg.freqMode === "fixed") return clampWireFreq(AppState.frequencyA || 45);
  return clampWireFreq(lo + t * (hi - lo));
}

/**
 * @param {number} strA
 * @param {number} strB
 * @param {ReturnType<typeof loadManualConfig>} [cfg]
 * @returns {{ fA: number, fB: number }}
 */
export function mapFreqFromStrengths(strA, strB, cfg = loadManualConfig()) {
  if (cfg.freqMode === "fixed") {
    return {
      fA: clampWireFreq(AppState.frequencyA || 45),
      fB: clampWireFreq(AppState.frequencyB || 45),
    };
  }
  return {
    fA: mapStrengthToFreq(strA, AppState.softLimitA, cfg),
    fB: mapStrengthToFreq(strB, AppState.softLimitB, cfg),
  };
}

export function isManualFreqFollowOn(cfg = loadManualConfig()) {
  return cfg.freqMode === "with_intensity" || cfg.freqMode === "inverse_intensity";
}

/**
 * Format strength for UI circle (absolute or % of soft-limit like XToys 0–100%).
 * @param {number} strength
 * @param {number} softLimit
 * @param {boolean} asPercent
 */
export function formatStrengthDisplay(strength, softLimit, asPercent) {
  const s = Math.round(Number(strength) || 0);
  if (!asPercent) return String(s);
  const soft = Math.max(1, softLimit || 200);
  const pct = Math.round((s / soft) * 100);
  return `${pct}%`;
}

/** Apply pattern descriptions into the Manual pattern grid. */
export function enrichPatternCards() {
  document.querySelectorAll(".pattern-card[data-pattern]").forEach((card) => {
    const id = card.getAttribute("data-pattern");
    const info = MANUAL_PATTERN_INFO[id];
    if (!info) return;
    const name = card.querySelector(".pattern-name");
    if (name) name.textContent = info.name;
    let desc = card.querySelector(".pattern-desc");
    if (!desc) {
      desc = document.createElement("span");
      desc.className = "pattern-desc";
      card.appendChild(desc);
    }
    desc.textContent = info.desc;
  });
}

function paintManualSoftLimits() {
  const a = document.getElementById("manual-soft-a");
  const b = document.getElementById("manual-soft-b");
  if (a) a.textContent = String(AppState.softLimitA ?? "—");
  if (b) b.textContent = String(AppState.softLimitB ?? "—");
}

function paintStrengthDisplays() {
  const cfg = loadManualConfig();
  const circA = DOM["intensity-circle-a"];
  const circB = DOM["intensity-circle-b"];
  const labA = DOM["label-intensity-a"];
  const labB = DOM["label-intensity-b"];
  if (circA) {
    circA.textContent = formatStrengthDisplay(
      AppState.strengthA,
      AppState.softLimitA,
      cfg.showPercent
    );
  }
  if (circB) {
    circB.textContent = formatStrengthDisplay(
      AppState.strengthB,
      AppState.softLimitB,
      cfg.showPercent
    );
  }
  if (labA) labA.textContent = `${AppState.strengthA} / ${AppState.softLimitA}`;
  if (labB) labB.textContent = `${AppState.strengthB} / ${AppState.softLimitB}`;
  paintManualSoftLimits();
}

/** Called after strength changes from control-deck. */
export function onManualStrengthChanged(channel) {
  const cfg = loadManualConfig();
  if (cfg.linkStrength) {
    if (channel === "A") {
      AppState.strengthB = AppState.strengthA;
      if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = AppState.strengthB;
    } else if (channel === "B") {
      AppState.strengthA = AppState.strengthB;
      if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = AppState.strengthA;
    }
  }
  paintStrengthDisplays();
  if (isManualFreqFollowOn(cfg)) {
    applyManualFreqFollow(cfg);
  }
}

/** Called after freq changes. */
export function onManualFreqChanged(channel) {
  const cfg = loadManualConfig();
  if (cfg.linkFreq) {
    if (channel === "A") {
      AppState.frequencyB = AppState.frequencyA;
    } else if (channel === "B") {
      AppState.frequencyA = AppState.frequencyB;
    }
  }
}

/**
 * Write mapped freqs into AppState + UI (when follow modes active).
 * @param {ReturnType<typeof loadManualConfig>} [cfg]
 */
export function applyManualFreqFollow(cfg = loadManualConfig()) {
  if (!isManualFreqFollowOn(cfg)) return null;
  const mapped = mapFreqFromStrengths(AppState.strengthA, AppState.strengthB, cfg);
  AppState.frequencyA = mapped.fA;
  AppState.frequencyB = mapped.fB;
  // UI sync without log spam
  const sa = DOM["slider-freq-a"];
  const sb = DOM["slider-freq-b"];
  const la = DOM["label-freq-a"];
  const lb = DOM["label-freq-b"];
  const ca = document.getElementById("freq-circle-a");
  const cb = document.getElementById("freq-circle-b");
  if (sa) sa.value = mapped.fA;
  if (sb) sb.value = mapped.fB;
  if (la) la.textContent = String(mapped.fA);
  if (lb) lb.textContent = String(mapped.fB);
  if (ca) ca.textContent = String(mapped.fA);
  if (cb) cb.textContent = String(mapped.fB);
  return mapped;
}

/**
 * Overlay pattern freqs when follow-intensity is on (XToys pattern→freq scripts).
 * @param {number} fA
 * @param {number} fB
 * @returns {{ fA: number, fB: number }}
 */
export function maybeOverridePatternFreq(fA, fB) {
  const cfg = loadManualConfig();
  if (!isManualFreqFollowOn(cfg)) return { fA, fB };
  return mapFreqFromStrengths(AppState.strengthA, AppState.strengthB, cfg);
}

export function initManualPlayerUi() {
  enrichPatternCards();
  paintStrengthDisplays();

  const cfg = loadManualConfig();
  const linkS = document.getElementById("manual-link-strength");
  const linkF = document.getElementById("manual-link-freq");
  const freqMode = document.getElementById("manual-freq-mode");
  const freqMin = document.getElementById("manual-freq-min");
  const freqMax = document.getElementById("manual-freq-max");
  const showPct = document.getElementById("manual-show-percent");

  if (linkS) linkS.checked = cfg.linkStrength;
  if (linkF) linkF.checked = cfg.linkFreq;
  if (freqMode) freqMode.value = cfg.freqMode;
  if (freqMin) freqMin.value = String(cfg.freqMin);
  if (freqMax) freqMax.value = String(cfg.freqMax);
  if (showPct) showPct.checked = cfg.showPercent;

  const persist = () => {
    saveManualConfig({
      linkStrength: !!linkS?.checked,
      linkFreq: !!linkF?.checked,
      freqMode: freqMode?.value || "fixed",
      freqMin: Number(freqMin?.value) || 30,
      freqMax: Number(freqMax?.value) || 100,
      showPercent: !!showPct?.checked,
    });
    paintStrengthDisplays();
    if (isManualFreqFollowOn()) applyManualFreqFollow();
    log("Manual-Player Einstellungen gespeichert", "info");
  };

  linkS?.addEventListener("change", persist);
  linkF?.addEventListener("change", persist);
  freqMode?.addEventListener("change", persist);
  freqMin?.addEventListener("change", persist);
  freqMax?.addEventListener("change", persist);
  showPct?.addEventListener("change", persist);

  document.getElementById("manual-zero")?.addEventListener("click", () => {
    DOM["slider-intensity-a"]?.dispatchEvent(new Event("input", { bubbles: true }));
    // use direct imports via custom event to avoid circular deps
    document.dispatchEvent(new CustomEvent("manual:zero-strength"));
  });

  document.getElementById("manual-soft-stop")?.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("manual:soft-stop"));
  });

  // Keep soft-limit labels fresh
  setInterval(paintManualSoftLimits, 1000);
  setInterval(paintStrengthDisplays, 800);
}

document.addEventListener("DOMContentLoaded", () => {
  initManualPlayerUi();
});
