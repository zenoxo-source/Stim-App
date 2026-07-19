// dice.js - Periodic random-strength "dice" mode.
//
// Every N ms, picks a random strength in [min, max] for the chosen channel(s)
// and sends via sendStrengthCommand. Respects panic cooldown + ceiling.
// Cancellable.
//
// UI: toggle + interval/min/max/channel selectors in Control Deck.

import { AppState, log } from "../state.js";
import { sendStrengthCommand } from "./bluetooth.js";
import { blockDuringPanicCooldown } from "./safety-extras.js";

const DICE_KEY = "stim_app_dice_config_v1";

const DEFAULTS = {
  enabled: false,
  intervalMs: 5000,
  min: 10,
  max: 70,
  channel: "both", // "A" | "B" | "both"
  spikeMs: 800, // how long the dice value stays before relaxing
  relaxTo: 0, // strength to return to after spike
};

let intervalHandle = null;
let spikeTimeoutHandle = null;

/**
 * Load persisted config (merged with defaults).
 * @returns {typeof DEFAULTS}
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(DICE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist config.
 * @param {Partial<typeof DEFAULTS>} patch
 */
export function saveConfig(patch) {
  const merged = { ...loadConfig(), ...patch };
  try {
    localStorage.setItem(DICE_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/**
 * Random integer in [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInRange(min, max) {
  const lo = Math.max(0, Math.min(200, parseInt(min, 10)));
  const hi = Math.max(lo, Math.min(200, parseInt(max, 10)));
  if (hi === lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Roll a single dice spike: snapshot current strength, send the spike, then
 * schedule relaxation back to `relaxTo` after `spikeMs`.
 */
function rollSpike() {
  if (blockDuringPanicCooldown("Dice-Tick")) return;

  const cfg = loadConfig();
  const val = randomInRange(cfg.min, cfg.max);
  // Snapshot pre-spike state (used in relax step below)
  const preSpike = { a: AppState.strengthA, b: AppState.strengthB };

  let setA = AppState.strengthA;
  let setB = AppState.strengthB;
  if (cfg.channel === "A" || cfg.channel === "both") setA = val;
  if (cfg.channel === "B" || cfg.channel === "both") setB = val;
  sendStrengthCommand(setA, setB);
  void preSpike; // reserved for future "relax to pre-spike" option

  if (spikeTimeoutHandle) clearTimeout(spikeTimeoutHandle);
  spikeTimeoutHandle = setTimeout(
    () => {
      if (blockDuringPanicCooldown("Dice-Relax")) return;
      let rA = AppState.strengthA;
      let rB = AppState.strengthB;
      if (cfg.channel === "A" || cfg.channel === "both") rA = cfg.relaxTo;
      if (cfg.channel === "B" || cfg.channel === "both") rB = cfg.relaxTo;
      sendStrengthCommand(rA, rB);
      spikeTimeoutHandle = null;
    },
    Math.max(50, cfg.spikeMs)
  );
}

/**
 * Start the periodic dice. Idempotent.
 * @param {Partial<typeof DEFAULTS>} [patch] optional config updates applied first
 * @returns {{ ok: boolean, error?: string }}
 */
export function startDice(patch) {
  if (intervalHandle) {
    return { ok: false, error: "Dice läuft bereits." };
  }
  if (patch) saveConfig(patch);
  const cfg = loadConfig();
  if (cfg.intervalMs < 500) {
    return { ok: false, error: "Interval muss ≥ 500 ms sein." };
  }
  if (cfg.min > cfg.max) {
    return { ok: false, error: "min darf nicht größer als max sein." };
  }
  intervalHandle = setInterval(rollSpike, cfg.intervalMs);
  log(
    `Dice-Modus gestartet (Interval ${cfg.intervalMs}ms, ${cfg.min}-${cfg.max}, Kanal ${cfg.channel}).`,
    "success"
  );
  // Initial roll
  setTimeout(rollSpike, 100);
  return { ok: true };
}

/**
 * Stop the dice. Cancels pending spike relaxation too.
 */
export function stopDice(reason = "manuell") {
  if (!intervalHandle && !spikeTimeoutHandle) return;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (spikeTimeoutHandle) {
    clearTimeout(spikeTimeoutHandle);
    spikeTimeoutHandle = null;
  }
  log(`Dice-Modus gestoppt (${reason}).`, "info");
}

/** @returns {boolean} */
export function isDiceActive() {
  return intervalHandle !== null;
}
