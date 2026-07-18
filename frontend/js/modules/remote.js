// remote.js - WebSocket remote command handler
// Receives commands from the backend WebSocket server and executes them.

const REMOTE_COMMANDS = {
  set_intensity: (msg) => {
    const ch = String(msg.channel || "").toUpperCase();
    const val = Math.min(200, Math.max(0, parseInt(msg.value, 10) || 0));
    if (ch === "A") updateSlidersA(val);
    else if (ch === "B") updateSlidersB(val);
    else {
      updateSlidersA(val);
      updateSlidersB(val);
    }
    return { ok: true };
  },

  set_pattern: (msg) => {
    const name = String(msg.name || "");
    const card = document.querySelector(`.pattern-card[data-pattern="${name}"]`);
    if (card) {
      card.click();
      return { ok: true };
    }
    return { ok: false, error: `pattern not found: ${name}` };
  },

  stop_pattern: () => {
    document.getElementById("btn-stop-pattern")?.click();
    return { ok: true };
  },

  stop_all: () => {
    killAllOutput();
    return { ok: true };
  },

  get_state: () => {
    return {
      ok: true,
      state: {
        connected: AppState.isConnected,
        strengthA: AppState.strengthA,
        strengthB: AppState.strengthB,
        frequencyA: AppState.frequencyA,
        frequencyB: AppState.frequencyB,
        activePattern: AppState.activePattern,
        masterScale: AppState.masterScale,
        softLimitA: AppState.softLimitA,
        softLimitB: AppState.softLimitB,
        batteryLevel: AppState.batteryLevel,
        swapChannels: AppState.swapChannels,
      },
    };
  },

  get_patterns: () => {
    const cards = document.querySelectorAll(".pattern-card[data-pattern]");
    return {
      ok: true,
      patterns: Array.from(cards).map((c) => c.getAttribute("data-pattern")),
    };
  },
};

function handleRemoteCommand(msg) {
  const type = String(msg.type || "");
  const handler = REMOTE_COMMANDS[type];
  if (!handler) {
    log(`Remote: unbekannter Befehl "${type}"`, "warning");
    return;
  }
  try {
    const result = handler(msg);
    if (typeof trackStat === "function") trackStat("remote_command");
    if (result && result.ok !== false) {
      log(`Remote: ${type} ausgeführt`, "info");
    } else if (result && result.error) {
      log(`Remote: ${type} fehlgeschlagen — ${result.error}`, "error");
    }
  } catch (err) {
    log(`Remote: ${type} Fehler — ${err.message}`, "error");
  }
}

async function updateRemoteUI() {
  if (!window.electronAPI || typeof window.electronAPI.getRemoteStatus !== "function") return;
  try {
    const status = await window.electronAPI.getRemoteStatus();
    const el = document.getElementById("remote-status");
    const toggle = document.getElementById("btn-toggle-remote");
    const tokenEl = document.getElementById("remote-token");
    if (el) {
      el.textContent = status.running
        ? `läuft auf ws://127.0.0.1:${status.port} (${status.clients} Client${status.clients !== 1 ? "s" : ""})`
        : "gestoppt";
      el.className = status.running ? "remote-status running" : "remote-status";
    }
    if (toggle) {
      toggle.textContent = status.running ? "Server stoppen" : "Server starten";
    }
    if (tokenEl) {
      if (status.running && status.token) {
        tokenEl.textContent = status.token;
        document.getElementById("remote-token-wrap").style.display = "block";
      } else {
        document.getElementById("remote-token-wrap").style.display = "none";
      }
    }
  } catch (err) {
    console.warn("Failed to get remote status:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Register remote command listener
  if (window.electronAPI && typeof window.electronAPI.onRemoteCommand === "function") {
    window.electronAPI.onRemoteCommand(handleRemoteCommand);
  }

  // Toggle button
  document.getElementById("btn-toggle-remote")?.addEventListener("click", async () => {
    if (!window.electronAPI) return;
    try {
      const status = await window.electronAPI.getRemoteStatus();
      if (status.running) {
        await window.electronAPI.stopRemote();
        log("Remote-Server gestoppt.", "info");
      } else {
        const result = await window.electronAPI.startRemote();
        if (result.ok) {
          log(`Remote-Server gestartet auf ws://127.0.0.1:${result.port}`, "success");
        } else {
          log(`Remote-Server Fehler: ${result.error}`, "error");
        }
      }
      updateRemoteUI();
    } catch (err) {
      log(`Remote-Server Fehler: ${err.message}`, "error");
    }
  });

  // Refresh status periodically
  setInterval(updateRemoteUI, 3000);
  updateRemoteUI();
});

window.handleRemoteCommand = handleRemoteCommand;
window.updateRemoteUI = updateRemoteUI;
