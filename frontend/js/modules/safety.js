// safety.js - Global safety layer: panic handler, close handler, kill switch
import { AppState, DOM, log } from "../state.js";
import { AIChatState } from "./ai-state.js";
import { updateAIDashboard } from "../control-deck.js";
import { updateOutputStatus } from "./status-ui.js";
import { sendV3EmergencyStop } from "./bluetooth.js";
import { stopAllMiniGames } from "./games-extra.js";
import { stopSafetyTimer } from "./presets.js";
import { armPanicCooldown } from "./safety-extras.js";
import { stopRamp } from "./ramp.js";

document.addEventListener("DOMContentLoaded", () => {
  // Register beforeunload to stop all output on accidental close
  window.addEventListener("beforeunload", () => {
    killAllOutput();
  });

  // Electron close confirmation
  if (window.electronAPI && typeof window.electronAPI.onBeforeClose === "function") {
    window.electronAPI.onBeforeClose(() => {
      const connected = AppState.isConnected;
      if (
        connected &&
        (AppState.strengthA > 0 || AppState.strengthB > 0 || AppState.activePattern)
      ) {
        // Force stop device output first
        killAllOutput();
        setTimeout(() => window.electronAPI.confirmClose(), 300);
      } else if (
        AppState.isAudioPlaying ||
        AppState.reflexState !== "IDLE" ||
        AppState.rhythmState !== "IDLE" ||
        AppState.edgeState === "RUNNING" ||
        AppState.potatoState === "LIVE" ||
        AppState.potatoState === "BOOM" ||
        AppState.survivalState === "RUNNING"
      ) {
        killAllOutput();
        setTimeout(() => window.electronAPI.confirmClose(), 200);
      } else {
        window.electronAPI.confirmClose();
      }
    });
  }

  // Keyboard shortcuts — only life-critical panic handlers live here now.
  // Tab navigation, audio play/pause, intensity arrows are registered via
  // hotkeys.js (see modules/keyboard-bindings.js) and are user-customizable.
  window.addEventListener("keydown", (e) => {
    // Ctrl+Space = global Panic Stop
    if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
      e.preventDefault();
      killAllOutput();
      updateOutputStatus({ panic: true });
      log("PANIC STOP aktiviert (Strg+Leertaste).", "error");
      setTimeout(() => {
        updateOutputStatus();
      }, 2500);
    }
  });

  // ESC long-press Panic (separate listener — long-press logic needs both
  // keydown and keyup).
  let escTimer = null;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && !isTyping(e.target)) {
      if (!escTimer) {
        escTimer = setTimeout(() => {
          escTimer = null;
          killAllOutput();
          updateOutputStatus({ panic: true });
          log("PANIC STOP aktiviert (ESC lang gedrückt).", "error");
          setTimeout(() => {
            updateOutputStatus();
          }, 2500);
        }, 500);
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Escape" && escTimer) {
      clearTimeout(escTimer);
      escTimer = null;
    }
  });
});

function isTyping(element) {
  return (
    element &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.contentEditable === "true")
  );
}

export function killAllOutput(opts = {}) {
  try {
    // Abort any in-flight AI chat request
    if (AIChatState.currentController !== null) {
      AIChatState.currentController.abort();
      AIChatState.currentController = null;
      AIChatState.isProcessing = false;
      const statusText = document.getElementById("ai-status-text");
      const btnSend = document.getElementById("btn-ai-send");
      if (statusText) statusText.textContent = "Bereit.";
      if (btnSend) btnSend.disabled = false;
      if (AIChatState.streamingBubbleEl) {
        AIChatState.streamingBubbleEl.remove();
        AIChatState.streamingBubbleEl = null;
      }
    }

    // Cancel any active strength ramp
    try {
      stopRamp("panic");
    } catch {
      /* ramp module optional at load time */
    }

    AppState.activePattern = null;

    // Stop audio
    AppState.audioElement?.pause();
    AppState.isAudioPlaying = false;
    if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "▶️ Play";
    if (AppState.audioTimer) clearInterval(AppState.audioTimer);

    // Stop games
    stopAllMiniGames();
    stopSafetyTimer(false);

    // Zero sliders
    AppState.strengthA = 0;
    AppState.strengthB = 0;
    if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = 0;
    if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = 0;
    if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = 0;
    if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = 0;
    if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = 0;
    if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = 0;

    // Update pattern UI
    document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));

    updateAIDashboard();
    sendV3EmergencyStop();
    updateOutputStatus({ panic: true });

    // Arm the cooldown so the user can't immediately restart output. Skipped
    // when explicitly requested (e.g. clean shutdown via beforeunload).
    if (!opts || opts.skipCooldown !== true) {
      try {
        armPanicCooldown();
      } catch {
        /* safety-extras optional at load time */
      }
    }
    // Do not call setConnected(false): panic stops output but keeps BLE link.
  } catch (err) {
    console.error("killAllOutput error:", err);
  }
}
