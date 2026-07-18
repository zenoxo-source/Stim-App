// safety.js - Global safety layer: panic handler, close handler, kill switch

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
        AppState.rhythmState !== "IDLE"
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

    // Number keys 1-5 for tabs
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !isTyping(e.target)) {
      const tabMap = {
        1: "deck",
        2: "stim",
        3: "games",
        4: "ai",
        5: "settings",
      };
      if (tabMap[e.key]) {
        e.preventDefault();
        document.querySelector(`.nav-item[data-tab="${tabMap[e.key]}"]`)?.click();
      }

      // P: toggle audio play/pause when on stim tab
      if (
        e.key.toLowerCase() === "p" &&
        document.getElementById("view-stim")?.classList.contains("active")
      ) {
        e.preventDefault();
        DOM["btn-play-audio"]?.click();
      }

      // Arrow keys for intensity
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

    // Ctrl+Space = global Panic Stop
    if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
      e.preventDefault();
      killAllOutput();
      log("PANIC STOP aktiviert (Strg+Leertaste).", "error");
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
          log("PANIC STOP aktiviert (ESC lang gedr\u00fcckt).", "error");
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

function killAllOutput() {
  try {
    // Abort any in-flight AI chat request
    if (typeof currentLLMController !== "undefined" && currentLLMController !== null) {
      currentLLMController.abort();
      currentLLMController = null;
      if (typeof isProcessing !== "undefined") isProcessing = false;
      const statusText = document.getElementById("ai-status-text");
      const btnSend = document.getElementById("btn-ai-send");
      if (statusText) statusText.textContent = "Bereit.";
      if (btnSend) btnSend.disabled = false;
      if (typeof streamingBubbleEl !== "undefined" && streamingBubbleEl) {
        streamingBubbleEl.remove();
        streamingBubbleEl = null;
      }
    }

    AppState.activePattern = null;

    // Stop audio
    AppState.audioElement?.pause();
    AppState.isAudioPlaying = false;
    if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "\u25b6\ufe0f Play";
    if (AppState.audioTimer) clearInterval(AppState.audioTimer);

    // Stop games
    clearTimeout(AppState.reflexTimeoutId);
    AppState.reflexState = "IDLE";
    if (AppState.rhythmIntervalId) clearInterval(AppState.rhythmIntervalId);
    AppState.rhythmState = "IDLE";

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
    // Do not call setConnected(false): panic stops output but keeps BLE link.
  } catch (err) {
    console.error("killAllOutput error:", err);
  }
}

window.killAllOutput = killAllOutput;
