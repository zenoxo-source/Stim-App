// triggers.js - Event-driven rule system.
//
// A trigger is: { id, enabled, condition: {...}, action: {...}, lastFired }
//
// Condition types:
//   { type: "strength-above", channel: "A"|"B", value: number }
//   { type: "strength-below", channel: "A"|"B", value: number }
//   { type: "time-elapsed", seconds: number }    (since arm)
//   { type: "pattern-active", name: string }
//   { type: "audio-playing" }
//
// Action types:
//   { type: "set-strength", channel: "A"|"B"|"both", value: number }
//   { type: "soft-stop" }
//   { type: "log", message: string }
//   { type: "start-pattern", name: string }
//   { type: "toast", message: string }
//
// Watchdog: 500ms interval. Each trigger fires at most once per "arm"
// (re-arm via button or by re-enabling). Avoids loops.

import { AppState, log } from "../state.js";
import { sendStrengthCommand } from "./bluetooth.js";
import { sendSoftStop } from "./bluetooth.js";
import { killAllOutput } from "./safety.js";

const TRIGGERS_KEY = "stim_app_triggers_v1";
const TICK_MS = 500;

let intervalHandle = null;
let armTime = 0;

function makeId() {
  return "trg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Validate a single trigger object.
 * @param {any} t
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateTrigger(t) {
  if (!t || typeof t !== "object") return { ok: false, error: "Trigger fehlt" };
  if (!t.condition || !t.action) return { ok: false, error: "condition + action benötigt" };
  const validCond = [
    "strength-above",
    "strength-below",
    "time-elapsed",
    "pattern-active",
    "audio-playing",
  ];
  if (!validCond.includes(t.condition.type)) {
    return { ok: false, error: `Unbekannter condition.type: ${t.condition.type}` };
  }
  const validAction = ["set-strength", "soft-stop", "log", "start-pattern", "toast"];
  if (!validAction.includes(t.action.type)) {
    return { ok: false, error: `Unbekannter action.type: ${t.action.type}` };
  }
  // Type-specific validation
  if (
    (t.condition.type === "strength-above" || t.condition.type === "strength-below") &&
    typeof t.condition.value !== "number"
  ) {
    return { ok: false, error: "condition.value muss Zahl sein" };
  }
  if (t.condition.type === "time-elapsed" && typeof t.condition.seconds !== "number") {
    return { ok: false, error: "condition.seconds muss Zahl sein" };
  }
  if (t.action.type === "set-strength" && typeof t.action.value !== "number") {
    return { ok: false, error: "action.value muss Zahl sein" };
  }
  return { ok: true };
}

/**
 * Load triggers.
 * @returns {Array}
 */
export function loadTriggers() {
  try {
    const raw = localStorage.getItem(TRIGGERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist triggers.
 * @param {Array} list
 */
export function saveTriggers(list) {
  try {
    localStorage.setItem(TRIGGERS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/**
 * Add a trigger. Auto-generates id if missing.
 * @param {object} t
 * @returns {{ ok: boolean, error?: string, trigger?: object }}
 */
export function addTrigger(t) {
  const v = validateTrigger(t);
  if (!v.ok) return v;
  const list = loadTriggers();
  const trigger = {
    id: t.id || makeId(),
    enabled: t.enabled !== false,
    lastFired: null,
    condition: t.condition,
    action: t.action,
  };
  list.push(trigger);
  saveTriggers(list);
  return { ok: true, trigger };
}

/**
 * Update a trigger by id.
 * @param {string} id
 * @param {Partial<object>} patch
 * @returns {boolean}
 */
export function updateTrigger(id, patch) {
  const list = loadTriggers();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...patch };
  saveTriggers(list);
  return true;
}

/**
 * Remove a trigger by id.
 * @param {string} id
 */
export function removeTrigger(id) {
  const list = loadTriggers().filter((t) => t.id !== id);
  saveTriggers(list);
}

/**
 * Evaluate a single trigger's condition against the current state.
 * Pure helper for testing.
 * @param {object} trigger
 * @param {object} ctx AppState-like snapshot { strengthA, strengthB, activePattern, isAudioPlaying, armTime, now }
 * @returns {boolean}
 */
export function evaluateCondition(trigger, ctx) {
  const c = trigger.condition;
  switch (c.type) {
    case "strength-above": {
      const v = c.channel === "B" ? ctx.strengthB : ctx.strengthA;
      return v > c.value;
    }
    case "strength-below": {
      const v = c.channel === "B" ? ctx.strengthB : ctx.strengthA;
      return v < c.value;
    }
    case "time-elapsed":
      return ctx.now - ctx.armTime >= c.seconds * 1000;
    case "pattern-active":
      return ctx.activePattern === c.name;
    case "audio-playing":
      return !!ctx.isAudioPlaying;
    default:
      return false;
  }
}

/**
 * Fire an action. Returns true if action succeeded.
 * @param {object} action
 * @returns {boolean}
 */
export function fireAction(action) {
  switch (action.type) {
    case "set-strength": {
      const v = action.value;
      const a = action.channel === "B" ? AppState.strengthA : v;
      const b = action.channel === "A" ? AppState.strengthB : v;
      sendStrengthCommand(a, b);
      return true;
    }
    case "soft-stop":
      try {
        killAllOutput({ skipCooldown: true });
      } catch {
        try {
          sendSoftStop({ keepStrength: false });
        } catch {
          /* ignore */
        }
      }
      return true;
    case "log":
      log(`[Trigger] ${action.message || "(keine Nachricht)"}`, "warning");
      return true;
    case "start-pattern":
      try {
        const card = document.querySelector(`.pattern-card[data-pattern="${action.name}"]`);
        card?.click();
        return true;
      } catch {
        return false;
      }
    case "toast":
      try {
        // Use existing showFunToast if available, else alert-less DOM toast
        const t = document.createElement("div");
        t.textContent = action.message || "";
        t.style.cssText =
          "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent-primary);color:white;padding:8px 16px;border-radius:4px;z-index:10002;";
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Arm the watchdog. Idempotent. Resets armTime + clears lastFired so each arm
 * cycle allows each trigger to fire once.
 */
export function armTriggers() {
  if (intervalHandle) {
    // Already armed — reset
    armTime = Date.now();
    const list = loadTriggers().map((t) => ({ ...t, lastFired: null }));
    saveTriggers(list);
    return;
  }
  armTime = Date.now();
  intervalHandle = setInterval(tick, TICK_MS);
}

/**
 * Disarm.
 */
export function disarmTriggers() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Tick — check all enabled triggers, fire matching ones (once each per arm).
 */
function tick() {
  const now = Date.now();
  const list = loadTriggers();
  let mutated = false;
  const ctx = {
    strengthA: AppState.strengthA,
    strengthB: AppState.strengthB,
    activePattern: AppState.activePattern,
    isAudioPlaying: AppState.isAudioPlaying,
    armTime,
    now,
  };
  for (const t of list) {
    if (!t.enabled) continue;
    if (t.lastFired) continue; // already fired in this arm cycle
    if (evaluateCondition(t, ctx)) {
      try {
        fireAction(t.action);
      } catch (err) {
        console.warn("Trigger action failed:", err);
      }
      t.lastFired = now;
      mutated = true;
    }
  }
  if (mutated) saveTriggers(list);
}

document.addEventListener("DOMContentLoaded", () => {
  // Don't auto-arm; user opts in via UI.
});
