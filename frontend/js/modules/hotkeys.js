// hotkeys.js - Customizable global hotkeys.
//
// Supports rebinding via UI. Format: "Mod+Shift+P" where:
//   Mod   = Ctrl on Win/Linux, Meta (Cmd) on macOS — written as literal "Mod"
//   Ctrl, Shift, Alt, Meta = literal modifier names
//   final key = e.g. "P", "1", "ArrowUp", "Escape", "Space", "F1"
//
// Cross-platform: Mod resolves to e.ctrlKey on win/linux, e.metaKey on mac.
//
// Default bindings match the old hardcoded keyboard shortcuts (safety.js
// had them inline). The old handlers are progressively replaced by this module
// but safety.js's panic handlers stay untouched (life-critical, no rebinding).

import { log } from "../state.js";

const HOTKEYS_KEY = "stim_app_hotkeys_v1";

/**
 * @typedef {Object} HotkeyAction
 * @property {string} id Stable identifier (used in storage + UI)
 * @property {string} label Human-readable (German)
 * @property {string} defaultCombo Default binding, e.g. "Mod+1"
 * @property {boolean} [allowRebind=true] Set false for protected actions
 * @property {function(): void} handler Invoked when combo fires
 */

/** @type {Record<string, HotkeyAction>} */
const registry = {};

/** @type {Record<string, string>} Combo → action id (rebuilt on changes). */
let bindingMap = {};

// ---------------------------------------------------------------------------
// Combo parsing / matching
// ---------------------------------------------------------------------------

/**
 * Normalize a combo string into a canonical form.
 * - Sorts modifiers alphabetically.
 * - Uppercases single-letter keys but preserves named keys (ArrowUp, F1).
 * @param {string} combo
 * @returns {string}
 */
export function normalizeCombo(combo) {
  if (typeof combo !== "string" || !combo.trim()) return "";
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  const modSet = new Set(mods);
  // Collapse Ctrl/Meta into Mod when both present (treat as one)
  const sortedMods = [...modSet].sort();
  const keyPart = /^[a-z0-9]$/i.test(key) ? key.toUpperCase() : key;
  return [...sortedMods, keyPart].join("+");
}

/**
 * Determine whether a KeyboardEvent matches a combo.
 * @param {KeyboardEvent} e
 * @param {string} combo normalized combo
 * @returns {boolean}
 */
export function eventMatchesCombo(e, combo) {
  if (!combo) return false;
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  const isMac =
    typeof navigator !== "undefined" &&
    typeof navigator.platform === "string" &&
    /mac/i.test(navigator.platform);

  // Match key
  const eventKey = /^[a-z0-9]$/i.test(e.key) ? e.key.toUpperCase() : e.key;
  if (eventKey !== key && e.code !== key) return false;

  // Match modifiers
  const wantMod = mods.has("mod");
  const wantCtrl = mods.has("ctrl");
  const wantShift = mods.has("shift");
  const wantAlt = mods.has("alt");
  const wantMeta = mods.has("meta");

  if (wantMod) {
    if (isMac ? !e.metaKey : !e.ctrlKey) return false;
  } else {
    if (wantCtrl !== e.ctrlKey) return false;
    if (wantMeta !== e.metaKey) return false;
  }
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  return true;
}

/**
 * Detect a combo from a KeyboardEvent (used by the rebind UI).
 * Returns canonical combo string or "" if event is purely a modifier press.
 * @param {KeyboardEvent} e
 * @returns {string}
 */
export function comboFromEvent(e) {
  // Ignore pure modifier presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  const mods = [];
  const isMac =
    typeof navigator !== "undefined" &&
    typeof navigator.platform === "string" &&
    /mac/i.test(navigator.platform);
  // Use Mod abstraction: on mac use Meta, elsewhere Ctrl. We don't try to
  // disambiguate Ctrl vs Meta in the UI; user just presses their platform's
  // "primary" modifier.
  if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) mods.push("Mod");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  // Non-modifier key
  const keyPart = /^[a-z0-9]$/i.test(e.key) ? e.key.toUpperCase() : e.key;
  return normalizeCombo(mods.concat(keyPart).join("+"));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Register a hotkey action. Other modules call this once at load time.
 * @param {HotkeyAction} action
 */
export function registerHotkey(action) {
  if (!action || !action.id || typeof action.handler !== "function") return;
  registry[action.id] = action;
  rebuildBindings();
}

/**
 * Get the active binding (combo string) for an action id. Falls back to the
 * default if no user override is stored.
 * @param {string} id
 * @returns {string}
 */
export function getBinding(id) {
  const action = registry[id];
  if (!action) return "";
  const stored = loadBindings();
  return stored[id] ?? action.defaultCombo;
}

/**
 * Set a new binding for an action id. Persists to localStorage.
 * Validates: action exists, combo parses, no collision with other actions
 * (unless `force` is true).
 * @param {string} id
 * @param {string} combo
 * @param {boolean} [force=false]
 * @returns {{ ok: boolean, error?: string }}
 */
export function setBinding(id, combo, force = false) {
  const action = registry[id];
  if (!action) return { ok: false, error: "Unbekannte Aktion" };
  if (action.allowRebind === false) return { ok: false, error: "Aktion ist geschützt" };
  const normalized = normalizeCombo(combo);
  if (!normalized) return { ok: false, error: "Ungültige Kombination" };

  // Collision check
  const stored = loadBindings();
  for (const otherId of Object.keys(registry)) {
    if (otherId === id) continue;
    const otherCombo = stored[otherId] ?? registry[otherId].defaultCombo;
    if (otherCombo === normalized) {
      if (!force) {
        return {
          ok: false,
          error: `Kollision mit „${registry[otherId].label}"`,
        };
      }
    }
  }
  stored[id] = normalized;
  saveBindings(stored);
  rebuildBindings();
  return { ok: true };
}

/**
 * Reset a binding to its default.
 * @param {string} id
 */
export function resetBinding(id) {
  const stored = loadBindings();
  if (id in stored) {
    delete stored[id];
    saveBindings(stored);
    rebuildBindings();
  }
}

/**
 * Reset all bindings to defaults.
 */
export function resetAllBindings() {
  saveBindings({});
  rebuildBindings();
}

/** Get all registered actions (for UI rendering). */
export function listActions() {
  return Object.values(registry).map((a) => ({
    id: a.id,
    label: a.label,
    defaultCombo: a.defaultCombo,
    currentCombo: getBinding(a.id),
    allowRebind: a.allowRebind !== false,
  }));
}

// ---------------------------------------------------------------------------
// Global listener
// ---------------------------------------------------------------------------

function onKeyDown(e) {
  // Typing into input/textarea/contenteditable — skip unless the action
  // explicitly opts out of typing-block. We only protect global shortcuts
  // here; the typing-target check matches the old safety.js convention.
  const target = e.target;
  const isTyping =
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.contentEditable === "true");
  if (isTyping) return;

  for (const [combo, actionId] of Object.entries(bindingMap)) {
    if (eventMatchesCombo(e, combo)) {
      const action = registry[actionId];
      if (action) {
        e.preventDefault();
        try {
          action.handler();
        } catch (err) {
          console.warn(`Hotkey action ${actionId} failed:`, err);
        }
        return;
      }
    }
  }
}

function rebuildBindings() {
  bindingMap = {};
  for (const id of Object.keys(registry)) {
    const combo = getBinding(id);
    if (combo) bindingMap[combo] = id;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadBindings() {
  try {
    const raw = localStorage.getItem(HOTKEYS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveBindings(map) {
  try {
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

document.addEventListener("DOMContentLoaded", () => {
  rebuildBindings();
  window.addEventListener("keydown", onKeyDown);
  log(`Hotkey-System initialisiert (${Object.keys(registry).length} Aktionen).`, "info");
});
