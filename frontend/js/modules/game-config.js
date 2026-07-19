// game-config.js - Centralized game configuration for hardware tuning
// All hardcoded game values are replaced with configurable options.
// Persisted in localStorage so users can tune to their hardware/pain tolerance.
import { AppState, log } from "../state.js";

const GAME_CONFIG_KEY = "stim_game_config_v1";

const GAME_CONFIG_DEFAULTS = {
  // Global hardware settings
  baseStrength: 40, // Minimum strength games enforce (0-200)
  shockMultiplier: 1.0, // Multiplier for punishment intensity (0.1-3.0)
  rewardMultiplier: 1.0, // Multiplier for reward feedback (0.1-3.0)
  shockFreq: 60, // Frequency for punishment shocks (10-240)
  rewardFreq: 150, // Frequency for reward/hit feedback (10-240)
  tickleFreq: 120, // Frequency for gentle feedback (10-240)
  maxShockAmp: 70, // Maximum amplitude for any punishment (0-100)
  useSoftLimits: true, // Cap amplitudes to respect soft limits

  // Per-game settings
  reflex: {
    startTargetMs: 450,
    minTargetMs: 180,
    stepMs: 25,
    shockStart: 30,
    shockStep: 5,
    shockMax: 150,
    falseStartAmp: 50,
    tooSlowAmp: 50,
  },
  rhythm: {
    tempo: 95,
    hitWindowMs: 150,
    shockStart: 30,
    beatAmp: 15,
    hitAmp: 15,
    missAmp: 30,
    maxMultiplier: 4,
  },
  edge: {
    zoneBase: 55,
    zoneJitter: 15,
    zoneWidth: 12,
    zoneWidthJitter: 8,
    riseSpeed: 0.035,
    fallSpeed: 0.05,
    ampScale: 55,
    failShockBase: 25,
    failShockPerScore: 1,
    failShockMax: 70,
    overEdgeMargin: 8,
    freqA: 50,
    freqB: 50,
  },
  potato: {
    baseTimerMs: 2800,
    minTimerMs: 900,
    timerDecPerRound: 120,
    jitterMs: 800,
    pulseBaseAmp: 10,
    pulseUrgencyAmp: 25,
    tickleAmp: 18,
    explodeBase: 30,
    explodePerRound: 3,
    explodeMax: 80,
    wrongChannelAmp: 35,
    pulseFreq: 70,
  },
  survival: {
    startLevel: 8,
    maxLevel: 70,
    rampSpeed: 1.35,
    wobbleAmp: 4,
    freqBaseA: 40,
    freqBaseB: 55,
    freqRampA: 1.0,
    freqRampB: 0.8,
  },
};

export const GAME_CONFIG = {
  data: JSON.parse(JSON.stringify(GAME_CONFIG_DEFAULTS)),

  load() {
    try {
      const raw = localStorage.getItem(GAME_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = this.mergeDeep(JSON.parse(JSON.stringify(GAME_CONFIG_DEFAULTS)), parsed);
      }
    } catch {
      // ignore corrupt config
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(GAME_CONFIG_KEY, JSON.stringify(this.data));
    } catch {
      // ignore
    }
  },

  reset() {
    this.data = JSON.parse(JSON.stringify(GAME_CONFIG_DEFAULTS));
    this.save();
  },

  mergeDeep(target, source) {
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key]) &&
        target[key]
      ) {
        this.mergeDeep(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  },

  get(path) {
    const parts = path.split(".");
    let val = this.data;
    for (const p of parts) {
      val = val?.[p];
    }
    return val;
  },

  set(path, value) {
    const parts = path.split(".");
    let obj = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    this.save();
  },

  // Clamp helper for amplitudes (respects soft limits if enabled)
  clampAmp(amp) {
    const cfg = this.data;
    let v = Math.round(amp * cfg.shockMultiplier);
    v = Math.min(cfg.maxShockAmp, Math.max(0, v));
    return v;
  },

  // Clamp reward amplitude (uses rewardMultiplier, not shockMultiplier)
  clampRewardAmp(amp) {
    const cfg = this.data;
    const v = Math.round(amp * cfg.rewardMultiplier);
    return Math.min(100, Math.max(0, v));
  },

  // Get effective base strength, respecting soft limits
  effectiveBaseStrength() {
    const cfg = this.data;
    const minSoftLimit = Math.min(AppState.softLimitA, AppState.softLimitB);
    if (cfg.useSoftLimits) {
      return Math.min(cfg.baseStrength, minSoftLimit);
    }
    return cfg.baseStrength;
  },
};

GAME_CONFIG.load();

document.addEventListener("DOMContentLoaded", () => {
  // Toggle config panel visibility
  document.getElementById("btn-toggle-game-config")?.addEventListener("click", () => {
    const panel = document.getElementById("game-config-panel");
    if (!panel) return;
    const isOpen = panel.style.display === "block";
    panel.style.display = isOpen ? "none" : "block";
    if (!isOpen) renderGameConfig();
  });

  document.getElementById("btn-reset-game-config")?.addEventListener("click", () => {
    if (confirm("Spiel-Konfiguration auf Standard zurücksetzen?")) {
      GAME_CONFIG.reset();
      renderGameConfig();
      log("Spiel-Konfiguration zurückgesetzt.", "info");
    }
  });
});

export function renderGameConfig() {
  const panel = document.getElementById("game-config-panel");
  if (!panel) return;
  const c = GAME_CONFIG.data;

  panel.innerHTML = `
    <div class="game-config-section">
      <h4>Hardware</h4>
      ${slider("Basisstärke", "baseStrength", c.baseStrength, 0, 200, 1, "Mindest-Strength die Spiele setzen (0-200)")}
      ${slider("Schock-Multiplikator", "shockMultiplier", c.shockMultiplier, 0.1, 3.0, 0.1, "Skaliert alle Bestrafungen (0.1-3.0)")}
      ${slider("Belohnungs-Multiplikator", "rewardMultiplier", c.rewardMultiplier, 0.1, 3.0, 0.1, "Skaliert Treffer-/Erfolgs-Feedback (0.1-3.0)")}
      ${slider("Schock-Frequenz", "shockFreq", c.shockFreq, 10, 240, 1, "Frequenz für Bestrafungen (10-240)")}
      ${slider("Belohnungs-Frequenz", "rewardFreq", c.rewardFreq, 10, 240, 1, "Frequenz für Erfolgs-Feedback (10-240)")}
      ${slider("Kitzel-Frequenz", "tickleFreq", c.tickleFreq, 10, 240, 1, "Frequenz für sanftes Feedback (10-240)")}
      ${slider("Max. Schock-Amplitude", "maxShockAmp", c.maxShockAmp, 0, 100, 1, "Absolute Obergrenze für Bestrafungen (0-100)")}
      ${checkbox("Soft-Limits respektieren", "useSoftLimits", c.useSoftLimits, "Basisstärke auf Soft-Limit begrenzen")}
    </div>
    <div class="game-config-section">
      <h4>Reflex Trainer</h4>
      ${slider("Start-Zielzeit (ms)", "reflex.startTargetMs", c.reflex.startTargetMs, 200, 1000, 10)}
      ${slider("Min. Zielzeit (ms)", "reflex.minTargetMs", c.reflex.minTargetMs, 100, 500, 10)}
      ${slider("Schock-Stufe Start", "reflex.shockStart", c.reflex.shockStart, 0, 100, 1)}
      ${slider("Schock max", "reflex.shockMax", c.reflex.shockMax, 0, 200, 1)}
    </div>
    <div class="game-config-section">
      <h4>Rhythm</h4>
      ${slider("Tempo (BPM)", "rhythm.tempo", c.rhythm.tempo, 40, 200, 1)}
      ${slider("Treffer-Fenster (ms)", "rhythm.hitWindowMs", c.rhythm.hitWindowMs, 50, 400, 5)}
      ${slider("Schock bei Miss", "rhythm.missAmp", c.rhythm.missAmp, 0, 100, 1)}
    </div>
    <div class="game-config-section">
      <h4>Hold the Edge</h4>
      ${slider("Zonen-Basis (%)", "edge.zoneBase", c.edge.zoneBase, 20, 90, 1)}
      ${slider("Zonen-Breite (%)", "edge.zoneWidth", c.edge.zoneWidth, 5, 40, 1)}
      ${slider("Amplituden-Skalierung", "edge.ampScale", c.edge.ampScale, 10, 100, 1)}
      ${slider("Steigrate", "edge.riseSpeed", c.edge.riseSpeed, 0.01, 0.1, 0.005)}
    </div>
    <div class="game-config-section">
      <h4>Hot Potato</h4>
      ${slider("Basis-Timer (ms)", "potato.baseTimerMs", c.potato.baseTimerMs, 1000, 5000, 100)}
      ${slider("Min. Timer (ms)", "potato.minTimerMs", c.potato.minTimerMs, 500, 2000, 100)}
      ${slider("Explosion Basis", "potato.explodeBase", c.potato.explodeBase, 0, 100, 1)}
    </div>
    <div class="game-config-section">
      <h4>Survival</h4>
      ${slider("Start-Level", "survival.startLevel", c.survival.startLevel, 0, 50, 1)}
      ${slider("Max-Level", "survival.maxLevel", c.survival.maxLevel, 20, 100, 1)}
      ${slider("Steigungs-Geschwindigkeit", "survival.rampSpeed", c.survival.rampSpeed, 0.1, 5.0, 0.05)}
    </div>
  `;

  // Wire up sliders
  panel.querySelectorAll("input[type='range'][data-cfg]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const path = e.target.dataset.cfg;
      const val = parseFloat(e.target.value);
      GAME_CONFIG.set(path, val);
      const label = panel.querySelector(`[data-cfg-val="${path}"]`);
      if (label) label.textContent = val;
    });
  });

  panel.querySelectorAll("input[type='checkbox'][data-cfg]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const path = e.target.dataset.cfg;
      GAME_CONFIG.set(path, e.target.checked);
    });
  });
}

function slider(label, path, value, min, max, step, hint) {
  const decimals = step < 1 ? (step <= 0.01 ? 3 : step <= 0.05 ? 2 : 1) : 0;
  return `
    <div class="game-config-row">
      <label class="game-config-label">
        <span>${label}</span>
        <span class="game-config-val" data-cfg-val="${path}">${Number(value).toFixed(decimals)}</span>
      </label>
      <input type="range" data-cfg="${path}" min="${min}" max="${max}" step="${step}" value="${value}">
      ${hint ? `<p class="game-config-hint">${hint}</p>` : ""}
    </div>
  `;
}

function checkbox(label, path, value, hint) {
  return `
    <div class="game-config-row">
      <label class="game-config-check">
        <input type="checkbox" data-cfg="${path}" ${value ? "checked" : ""}>
        <span>${label}</span>
      </label>
      ${hint ? `<p class="game-config-hint">${hint}</p>` : ""}
    </div>
  `;
}
