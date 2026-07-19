// keyboard-bindings.js - Register the app's default hotkey actions.
//
// Wires existing global shortcuts (tabs 1-7, audio P, intensity arrows,
// roulette, etc.) through the hotkeys.js customization system. Panic
// shortcuts (Ctrl+Space, ESC long-press) stay in safety.js — they are
// life-critical and not user-rebindable.

import { AppState, DOM, CONSTANTS } from "../state.js";
import { registerHotkey } from "./hotkeys.js";
import { updateSlidersA, updateSlidersB } from "../control-deck.js";

const TAB_MAP = {
  1: "deck",
  2: "stim",
  3: "games",
  4: "editor",
  5: "remote",
  6: "ai",
  7: "settings",
};

/**
 * Decide whether any mini-game currently owns the keyboard (so global hotkeys
 * should be suppressed). Mirrors the logic that used to live inline in
 * safety.js.
 */
function gameBlocksKeys() {
  return (
    AppState.edgeState === "RUNNING" ||
    AppState.potatoState === "LIVE" ||
    AppState.potatoState === "BOOM" ||
    AppState.survivalState === "RUNNING" ||
    AppState.rhythmState === "PLAYING" ||
    AppState.reflexState === "WAITING" ||
    AppState.reflexState === "TRIGGERED"
  );
}

/** Click the nav-item for the given tab name. */
function clickTab(tabName) {
  if (gameBlocksKeys()) return;
  document.querySelector(`.nav-item[data-tab="${tabName}"]`)?.click();
}

/**
 * Register all default hotkey actions. Idempotent (subsequent calls re-register
 * with same handler refs; no duplicates because `registerHotkey` overwrites by
 * id).
 */
export function registerDefaultHotkeys() {
  // Tabs 1-7
  Object.entries(TAB_MAP).forEach(([digit, tabName]) => {
    registerHotkey({
      id: `tab-${tabName}`,
      label: `Tab: ${tabName[0].toUpperCase() + tabName.slice(1)}`,
      defaultCombo: digit,
      handler: () => clickTab(tabName),
    });
  });

  // Audio play/pause (only on stim tab)
  registerHotkey({
    id: "audio-play-pause",
    label: "Audio Play/Pause (nur STIM-Tab)",
    defaultCombo: "P",
    handler: () => {
      if (gameBlocksKeys()) return;
      const stimView = document.getElementById("view-stim");
      if (!stimView?.classList.contains("active")) return;
      DOM["btn-play-audio"]?.click();
    },
  });

  // Intensity arrows
  registerHotkey({
    id: "intensity-a-up",
    label: "Kanal A +5",
    defaultCombo: "ArrowUp",
    handler: () => {
      if (gameBlocksKeys()) return;
      updateSlidersA(Math.min(AppState.softLimitA, AppState.strengthA + 5));
    },
  });
  registerHotkey({
    id: "intensity-a-down",
    label: "Kanal A −5",
    defaultCombo: "ArrowDown",
    handler: () => {
      if (gameBlocksKeys()) return;
      updateSlidersA(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthA - 5));
    },
  });
  registerHotkey({
    id: "intensity-b-up",
    label: "Kanal B +5",
    defaultCombo: "ArrowRight",
    handler: () => {
      if (gameBlocksKeys()) return;
      updateSlidersB(Math.min(AppState.softLimitB, AppState.strengthB + 5));
    },
  });
  registerHotkey({
    id: "intensity-b-down",
    label: "Kanal B −5",
    defaultCombo: "ArrowLeft",
    handler: () => {
      if (gameBlocksKeys()) return;
      updateSlidersB(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthB - 5));
    },
  });

  // Stop pattern
  registerHotkey({
    id: "stop-pattern",
    label: "Pattern stoppen",
    defaultCombo: "Mod+Shift+S",
    handler: () => DOM["btn-stop-pattern"]?.click(),
  });

  // Ramp cancel (life-safe; allow binding)
  registerHotkey({
    id: "ramp-cancel",
    label: "Ramp abbrechen",
    defaultCombo: "Mod+R",
    handler: () => document.getElementById("btn-ramp-cancel")?.click(),
  });
}

document.addEventListener("DOMContentLoaded", registerDefaultHotkeys);
