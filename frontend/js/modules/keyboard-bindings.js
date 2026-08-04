// keyboard-bindings.js - Register the app's default hotkey actions.
//
// Wires global shortcuts (tabs 1-5, audio P, intensity arrows, etc.)
// through the hotkeys.js customization system. Panic shortcuts
// (Ctrl+Space, ESC long-press) stay in safety.js — life-critical,
// not user-rebindable.

import { AppState, DOM, CONSTANTS } from "../state.js";
import { registerHotkey } from "./hotkeys.js";
import { updateSlidersA, updateSlidersB } from "../control-deck.js";
import { SESSION_STATE } from "./sessions.js";
import { fireShock } from "./shock.js";
import { stopAutodrive } from "./autodrive.js";
import { toggleStimPlayback } from "./audio.js";

const TAB_MAP = {
  1: "autodrive",
  2: "deck",
  3: "stim",
  4: "editor",
  5: "settings",
};

/** Click the nav-item for the given tab name. */
function clickTab(tabName) {
  document.querySelector(`.nav-item[data-tab="${tabName}"]`)?.click();
}

/**
 * Register all default hotkey actions. Idempotent (subsequent calls re-register
 * with same handler refs; no duplicates because `registerHotkey` overwrites by
 * id).
 */
export function registerDefaultHotkeys() {
  // Tabs 1-5 (v6.0: Autodrive…Einstellungen)
  const TAB_LABELS = {
    autodrive: "Autodrive",
    deck: "Manual",
    stim: "STIM",
    editor: "Library",
    settings: "Einstellungen",
  };
  Object.entries(TAB_MAP).forEach(([digit, tabName]) => {
    registerHotkey({
      id: `tab-${tabName}`,
      label: `Tab: ${TAB_LABELS[tabName] || tabName}`,
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
    handler: () => updateSlidersA(Math.min(AppState.softLimitA, AppState.strengthA + 5)),
  });
  registerHotkey({
    id: "intensity-a-down",
    label: "Kanal A −5",
    defaultCombo: "ArrowDown",
    handler: () => updateSlidersA(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthA - 5)),
  });
  registerHotkey({
    id: "intensity-b-up",
    label: "Kanal B +5",
    defaultCombo: "ArrowRight",
    handler: () => updateSlidersB(Math.min(AppState.softLimitB, AppState.strengthB + 5)),
  });
  registerHotkey({
    id: "intensity-b-down",
    label: "Kanal B −5",
    defaultCombo: "ArrowLeft",
    handler: () => updateSlidersB(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthB - 5)),
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

  // F2: session pause/resume (no conflict with the panic shortcut).
  registerHotkey({
    id: "session-pause",
    label: "Session Pause/Resume",
    defaultCombo: "Mod+Shift+P",
    handler: () => {
      if (SESSION_STATE.sessionPaused) SESSION_STATE.resume();
      else SESSION_STATE.pause();
    },
  });

  // Shock burst (respects cooldown/PIN inside fireShock).
  registerHotkey({
    id: "shock-burst",
    label: "Shock-Burst",
    defaultCombo: "Mod+Shift+X",
    handler: () => fireShock(),
  });

  // Autodrive stop (life-safe; also available while hidden via tray/hotkey).
  registerHotkey({
    id: "autodrive-stop",
    label: "Autodrive stoppen",
    defaultCombo: "Mod+Shift+A",
    handler: () => stopAutodrive("hotkey"),
  });

  // STIM play/pause from any tab.
  registerHotkey({
    id: "stim-toggle",
    label: "STIM Play/Pause (global)",
    defaultCombo: "Mod+Shift+M",
    handler: () => toggleStimPlayback(),
  });
}

document.addEventListener("DOMContentLoaded", registerDefaultHotkeys);
