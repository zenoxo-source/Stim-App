// safety.js - Global safety layer: panic handler, close handler, kill switch
import { AppState, DOM, CONSTANTS, log } from "../state.js";
import { AIChatState } from "./ai-state.js";
import { updateSlidersA, updateSlidersB, updateAIDashboard } from "../control-deck.js";
import { updateOutputStatus } from "./status-ui.js";
import { sendV3EmergencyStop } from "./bluetooth.js";
import { stopAllMiniGames } from "./games-extra.js";
import { stopSafetyTimer } from "./presets.js";

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

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    // ESC long-press detection is separate at bottom

    // Number keys 1-7 for tabs
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !isTyping(e.target)) {
      const gameBlocksKeys =
        AppState.edgeState === "RUNNING" ||
        AppState.potatoState === "LIVE" ||
        AppState.potatoState === "BOOM" ||
        AppState.survivalState === "RUNNING" ||
        AppState.rhythmState === "PLAYING" ||
        AppState.reflexState === "WAITING" ||
        AppState.reflexState === "TRIGGERED";

      const tabMap = {
        1: "deck",
        2: "stim",
        3: "games",
        4: "editor",
        5: "remote",
        6: "ai",
        7: "settings",
      };
      if (tabMap[e.key] && !gameBlocksKeys) {
        e.preventDefault();
        document.querySelector(`.nav-item[data-tab="${tabMap[e.key]}"]`)?.click();
      }

      // P: toggle audio play/pause when on stim tab
      if (
        e.key.toLowerCase() === "p" &&
        document.getElementById("view-stim")?.classList.contains("active") &&
        !gameBlocksKeys
      ) {
        e.preventDefault();
        DOM["btn-play-audio"]?.click();
      }

      // Arrow keys for intensity (disabled during mini-games that use keys)
      if (!gameBlocksKeys) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          updateSlidersA(Math.min(AppState.softLimitA, AppState.strengthA + 5));
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          updateSlidersA(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthA - 5));
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          updateSlidersB(Math.min(AppState.softLimitB, AppState.strengthB + 5));
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          updateSlidersB(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthB - 5));
        }
      }
    }

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

  // ESC long-press Panic
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

export function killAllOutput() {
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
    // Do not call setConnected(false): panic stops output but keeps BLE link.
  } catch (err) {
    console.error("killAllOutput error:", err);
  }
}
