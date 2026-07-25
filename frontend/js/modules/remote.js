// remote.js - WebSocket remote command handler
// Receives commands from the backend WebSocket server and executes them.
import { AppState, CONSTANTS, log } from "../state.js";
import {
  updateSlidersA,
  updateSlidersB,
  updateAIDashboard,
  setChannelFreq,
} from "../control-deck.js";
import { ensureGameStrength } from "./games-extra.js";
import { killAllOutput } from "./safety.js";
import { trackStat } from "./stats.js";
import { isPanicCooldownActive } from "./safety-extras.js";
import { isLocked as isPinLocked } from "./session-pin.js";
import {
  injectFeedback as adInjectFeedback,
  isAutodriveActive,
  startAutodrive,
  startQuickClassic,
  startLastSuccess,
  stopAutodrive,
  pauseAutodrive,
  resumeAutodrive,
  getAutodriveState,
} from "./autodrive.js";
import { runStory } from "./session-stories.js";
import { fireShock } from "./shock.js";

/** Commands allowed even during PIN lock / panic cooldown (safety + read-only). */
const REMOTE_ALWAYS_ALLOWED = new Set(["stop_all", "get_state", "get_patterns", "get_logs"]);

const REMOTE_COMMANDS = {
  set_intensity: (msg) => {
    // Soft-limits applied inside updateSlidersA/B via clampStrengthWithCeiling
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

  set_frequency: (msg) => {
    const ch = String(msg.channel || "").toUpperCase();
    const val = Math.min(240, Math.max(10, parseInt(msg.value, 10) || 45));
    if (ch === "A") setChannelFreq("A", val);
    else if (ch === "B") setChannelFreq("B", val);
    else {
      setChannelFreq("A", val);
      setChannelFreq("B", val);
    }
    return { ok: true };
  },

  set_master: (msg) => {
    // Panic-cooldown / PIN gating happens centrally in executeRemoteCommand.
    // `|| 100` would be wrong here: 0 is falsy, so asking for 0 % master —
    // the quietest setting — used to snap to full scale instead.
    const raw = parseInt(msg.value, 10);
    const val = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 100;
    AppState.masterScale = val / 100;
    const slider = document.getElementById("slider-master");
    const label = document.getElementById("master-val-text");
    if (slider) slider.value = val;
    if (label) label.textContent = val + "%";
    return { ok: true };
  },

  set_preset: (msg) => {
    const name = String(msg.name || "").toLowerCase();
    const btn = document.querySelector(`.preset-btn[data-preset="${name}"]`);
    if (btn) {
      btn.click();
      return { ok: true };
    }
    return { ok: false, error: `preset not found: ${name}` };
  },

  set_custom_pattern: (msg) => {
    if (!AppState.isConnected) {
      return { ok: false, error: "not connected" };
    }
    // Panic-cooldown / PIN gating happens centrally in executeRemoteCommand.
    const chA = Array.isArray(msg.channelA) ? msg.channelA.slice(0, 32) : [];
    const chB = Array.isArray(msg.channelB) ? msg.channelB.slice(0, 32) : [];
    const interval = Math.min(2000, Math.max(50, parseInt(msg.interval, 10) || 100));
    if (chA.length === 0 && chB.length === 0) {
      return { ok: false, error: "channelA or channelB required" };
    }
    AppState.aiCustomPatternA = chA.map(function (v) {
      return Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
    });
    AppState.aiCustomPatternB = chB.map(function (v) {
      return Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
    });
    AppState.aiCustomInterval = interval;
    AppState.activePattern = CONSTANTS.PATTERNS.AI_CUSTOM;
    document.querySelectorAll(".pattern-card").forEach(function (c) {
      c.classList.remove("active");
    });
    ensureGameStrength(40);
    updateAIDashboard();
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

  /** Partner feedback while Autodrive owns output */
  autodrive_feedback: (msg) => {
    const fb = String(msg.feedback || msg.value || "").toLowerCase();
    const allowed = new Set([
      "too_weak",
      "good",
      "too_strong",
      "almost",
      "now",
      "climaxed",
      "not_yet",
      "nudge_up",
      "nudge_down",
    ]);
    if (!allowed.has(fb)) {
      return { ok: false, error: `unknown feedback: ${fb}` };
    }
    if (!isAutodriveActive()) {
      return { ok: false, error: "autodrive not active" };
    }
    adInjectFeedback(fb);
    return { ok: true, feedback: fb };
  },

  autodrive_start: (msg) => {
    if (msg.quick) return startQuickClassic();
    if (msg.lastSuccess) return startLastSuccess();
    const patch = {};
    if (msg.templateId) patch.templateId = msg.templateId;
    if (msg.storyId) patch.storyId = msg.storyId;
    if (typeof msg.hybridAudio === "boolean") patch.hybridAudio = msg.hybridAudio;
    return startAutodrive(patch);
  },

  autodrive_stop: () => {
    stopAutodrive("remote");
    return { ok: true };
  },

  autodrive_pause: () => {
    pauseAutodrive();
    return { ok: true };
  },

  autodrive_resume: () => {
    resumeAutodrive();
    return { ok: true };
  },

  autodrive_state: () => {
    return { ok: true, autodrive: getAutodriveState() };
  },

  /** Story start by id (see session-stories) */
  story_start: (msg) => {
    const id = String(msg.storyId || msg.id || "");
    if (!id) return { ok: false, error: "storyId required" };
    return runStory(id);
  },

  /** Short burst within soft-limits (blocked during autodrive) */
  shock: (msg) => {
    return fireShock({
      intensity: msg.intensity,
      durationMs: msg.durationMs,
      freq: msg.freq,
      channel: msg.channel,
    });
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
        outputOwner: AppState.outputOwner || "none",
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

  get_logs: (msg) => {
    const count = Math.min(200, Math.max(1, parseInt(msg.count, 10) || 20));
    return {
      ok: true,
      logs: cmdLog.slice(-count),
    };
  },
};

var cmdLog = [];
var remoteStats = { totalCmds: 0, okCmds: 0, errCmds: 0, connCount: 0, lastConn: null };
/** Last status from the main process — the port here is authoritative. */
var lastRemoteStatus = { running: false, port: null, clients: 0, token: null };
/** Serialized snapshot of the last broadcast, to avoid pushing unchanged state. */
var lastBroadcastJson = "";

function addRemoteCmdLog(entry) {
  cmdLog.push(entry);
  if (cmdLog.length > 500) cmdLog.shift();
  renderRemoteCmdLog();
}

function renderRemoteCmdLog() {
  var el = document.getElementById("editor-cmd-log");
  if (!el) return;
  var filter = document.getElementById("remote-log-filter");
  var filterVal = filter ? filter.value : "all";
  var filtered = cmdLog;
  if (filterVal === "OK")
    filtered = cmdLog.filter(function (e) {
      return e.indexOf("] OK:") >= 0;
    });
  else if (filterVal === "ERR")
    filtered = cmdLog.filter(function (e) {
      return e.indexOf("] ERR:") >= 0;
    });
  else if (filterVal === "WARN")
    filtered = cmdLog.filter(function (e) {
      return e.indexOf("] WARN:") >= 0;
    });

  el.innerHTML =
    filtered.length === 0
      ? filterVal === "all"
        ? "[Remote] Warte auf Befehle..."
        : '[Remote] Keine Eintr\u00e4ge f\u00fcr Filter "' + filterVal + '".'
      : filtered.join("\n");

  var statsEl = document.getElementById("remote-conn-stats");
  if (statsEl) {
    statsEl.textContent =
      "Befehle: " +
      remoteStats.totalCmds +
      " | OK: " +
      remoteStats.okCmds +
      " | ERR: " +
      remoteStats.errCmds +
      (remoteStats.connCount > 0 ? " | Clients: " + remoteStats.connCount : "");
  }
}

function updateRemoteCodeSnippet() {
  var lang = document.getElementById("remote-code-lang");
  var pre = document.getElementById("remote-code-snippet");
  var token = document.getElementById("editor-remote-token");
  if (!pre || !token || !token.textContent) {
    if (pre) pre.textContent = "Server muss laufen, um Codebeispiele anzuzeigen.";
    return;
  }
  var t = token.textContent;
  // Use the port the server actually bound to, not the input field — they can
  // differ when the user edited the field after starting.
  var port = lastRemoteStatus.port || 8080;
  var langVal = lang ? lang.value : "python";

  var snippets = {
    python:
      "import json, asyncio, websockets\n\n" +
      'TOKEN = "' +
      t +
      '"\n' +
      'URL = "ws://127.0.0.1:' +
      port +
      '?token=" + TOKEN\n\n' +
      "async def main():\n" +
      "    async with websockets.connect(URL) as ws:\n" +
      "        # Intensität setzen (id korreliert Antwort ↔ Befehl)\n" +
      '        await ws.send(json.dumps({"id": 1, "type": "set_intensity",\n' +
      '                                  "channel": "A", "value": 80}))\n' +
      "        print(json.loads(await ws.recv()))\n\n" +
      "        # Status abfragen\n" +
      '        await ws.send(json.dumps({"id": 2, "type": "get_state"}))\n' +
      "        resp = json.loads(await ws.recv())\n" +
      '        print("Status:", resp["state"])\n\n' +
      "asyncio.run(main())",

    js:
      'const WebSocket = require("ws");\n\n' +
      'const TOKEN = "' +
      t +
      '";\n' +
      'const ws = new WebSocket("ws://127.0.0.1:' +
      port +
      '?token=" + TOKEN);\n\n' +
      'ws.on("open", () => {\n' +
      "  // id korreliert Antwort ↔ Befehl\n" +
      '  ws.send(JSON.stringify({ id: 1, type: "set_intensity", channel: "A", value: 80 }));\n' +
      '  ws.send(JSON.stringify({ id: 2, type: "get_state" }));\n' +
      "});\n\n" +
      'ws.on("message", (data) => {\n' +
      "  const msg = JSON.parse(data);\n" +
      '  if (msg.type === "response") console.log(`#${msg.id} ${msg.command}:`, msg);\n' +
      '  if (msg.type === "state") console.log("Push-Update:", msg.data);\n' +
      "});",

    curl:
      "# curl kann kein WebSocket direkt.\n" +
      "# Nutze websocat oder wscat zum Testen:\n\n" +
      "# Mit websocat (https://github.com/vi/websocat):\n" +
      'echo \'{"id":1,"type":"get_state"}\' | \\\n' +
      '  websocat "ws://127.0.0.1:' +
      port +
      "?token=" +
      t +
      '"\n\n' +
      "# Mit wscat (npm i -g wscat):\n" +
      'wscat -c "ws://127.0.0.1:' +
      port +
      "?token=" +
      t +
      '"',
  };

  pre.textContent = snippets[langVal] || snippets.python;
}

/**
 * Send a command result back to the requesting WebSocket client.
 * No-op for locally issued commands (test console — no __reqId present).
 */
function replyToRemote(msg, result) {
  var reqId = msg && msg.__reqId;
  if (!reqId) return;
  if (!window.electronAPI || typeof window.electronAPI.sendRemoteResponse !== "function") return;
  try {
    window.electronAPI.sendRemoteResponse(reqId, result);
  } catch (err) {
    console.warn("sendRemoteResponse failed:", err);
  }
}

/**
 * Execute a remote command and deliver the result to the requesting client.
 * @returns {{ok: boolean, error?: string}} always an object, never undefined
 */
function handleRemoteCommand(msg) {
  var result = executeRemoteCommand(msg);
  replyToRemote(msg, result);
  return result;
}

function executeRemoteCommand(msg) {
  var type = String(msg.type || "");
  var handler = REMOTE_COMMANDS[type];
  var ts = new Date().toLocaleTimeString();
  remoteStats.totalCmds++;
  if (!handler) {
    remoteStats.errCmds++;
    log('Remote: unbekannter Befehl "' + type + '"', "warning");
    addRemoteCmdLog("[" + ts + '] WARN: unbekannter Befehl "' + type + '"');
    return { ok: false, error: 'unknown command: "' + type + '"' };
  }
  // Safety gate: only stop/read commands during panic cooldown or PIN lock.
  // Individual handlers rely on this and do not re-check.
  if (!REMOTE_ALWAYS_ALLOWED.has(type)) {
    if (isPanicCooldownActive()) {
      remoteStats.errCmds++;
      log("Remote: " + type + " blockiert (Panic-Cooldown).", "warning");
      addRemoteCmdLog("[" + ts + "] ERR: " + type + " — panic cooldown");
      return { ok: false, error: "panic cooldown active" };
    }
    if (isPinLocked()) {
      remoteStats.errCmds++;
      log("Remote: " + type + " blockiert (Session-PIN).", "warning");
      addRemoteCmdLog("[" + ts + "] ERR: " + type + " — session PIN locked");
      return { ok: false, error: "session PIN locked" };
    }
  }
  try {
    var result = handler(msg);
    trackStat("remote_command");
    // Handlers that only act (no read-back) may return undefined \u2014 treat as ok.
    if (!result || typeof result !== "object") result = { ok: true };

    if (result.ok !== false) {
      remoteStats.okCmds++;
      log("Remote: " + type + " ausgef\u00fchrt", "info");
      addRemoteCmdLog(
        "[" +
          ts +
          "] OK: " +
          type +
          " " +
          (msg.channel ? msg.channel + "=" + msg.value : msg.name || "")
      );
    } else {
      remoteStats.errCmds++;
      log("Remote: " + type + " fehlgeschlagen \u2014 " + result.error, "error");
      addRemoteCmdLog("[" + ts + "] ERR: " + type + " \u2014 " + result.error);
    }
    return result;
  } catch (err) {
    remoteStats.errCmds++;
    log("Remote: " + type + " Fehler \u2014 " + err.message, "error");
    addRemoteCmdLog("[" + ts + "] ERR: " + type + " \u2014 " + err.message);
    return { ok: false, error: err.message };
  }
}

// First-pass update (called for legacy settings tab)
async function _updateRemoteUISettings() {
  if (!window.electronAPI || typeof window.electronAPI.getRemoteStatus !== "function") return;
  try {
    var status = await window.electronAPI.getRemoteStatus();
    lastRemoteStatus = status;
    var el = document.getElementById("remote-status");
    var toggle = document.getElementById("btn-toggle-remote");
    var tokenEl = document.getElementById("remote-token");
    if (el) {
      el.textContent = status.running
        ? "läuft auf ws://127.0.0.1:" +
          status.port +
          " (" +
          status.clients +
          " Client" +
          (status.clients !== 1 ? "s" : "") +
          ")"
        : "gestoppt";
      el.className = status.running ? "remote-status running" : "remote-status";
    }
    if (toggle) {
      toggle.textContent = status.running ? "Server stoppen" : "Server starten";
    }
    if (tokenEl) {
      if (status.running && status.token) {
        tokenEl.textContent = status.token;
        var wrap = document.getElementById("remote-token-wrap");
        if (wrap) wrap.style.display = "block";
      } else {
        var wrap2 = document.getElementById("remote-token-wrap");
        if (wrap2) wrap2.style.display = "none";
      }
    }
  } catch (err) {
    console.warn("Failed to get remote status:", err);
  }
}

function updateRemoteUI() {
  _updateRemoteUISettings();
  updateEditorRemoteUI();
  pushStateToRemoteClients();
}

/**
 * Push a state snapshot to connected remote clients when something changed.
 * Lets external tools follow along without polling get_state.
 */
function pushStateToRemoteClients() {
  if (!lastRemoteStatus.running || lastRemoteStatus.clients < 1) return;
  if (!window.electronAPI || typeof window.electronAPI.broadcastRemoteState !== "function") return;
  var snapshot = REMOTE_COMMANDS.get_state().state;
  var json = JSON.stringify(snapshot);
  if (json === lastBroadcastJson) return;
  lastBroadcastJson = json;
  try {
    window.electronAPI.broadcastRemoteState(snapshot);
  } catch (err) {
    console.warn("broadcastRemoteState failed:", err);
  }
}

// Editor Remote tab UI
async function updateEditorRemoteUI() {
  if (!window.electronAPI || typeof window.electronAPI.getRemoteStatus !== "function") return;
  try {
    const status = await window.electronAPI.getRemoteStatus();
    lastRemoteStatus = status;
    const el = document.getElementById("editor-remote-status");
    const toggle = document.getElementById("btn-editor-toggle-remote");
    const tokenEl = document.getElementById("editor-remote-token");
    const copyBtn = document.getElementById("btn-editor-copy-token");
    remoteStats.connCount = status.clients || 0;
    if (el) {
      el.textContent = status.running
        ? "l\u00e4uft auf ws://127.0.0.1:" +
          status.port +
          " (" +
          status.clients +
          " Client" +
          (status.clients !== 1 ? "s" : "") +
          ")"
        : "gestoppt";
      el.className = status.running ? "remote-status running" : "remote-status";
    }
    if (toggle) {
      toggle.textContent = status.running ? "Server stoppen" : "Server starten";
    }
    if (tokenEl && copyBtn) {
      if (status.running && status.token) {
        tokenEl.textContent = status.token;
        document.getElementById("editor-remote-token-wrap").style.display = "block";
        copyBtn.style.display = "inline-block";
      } else {
        document.getElementById("editor-remote-token-wrap").style.display = "none";
        copyBtn.style.display = "none";
      }
    }
    updateRemoteCodeSnippet();
    renderRemoteCmdLog();
  } catch (err) {
    console.warn("Failed to get remote status:", err);
  }
}

function testRemoteCommand() {
  var cmd = document.getElementById("editor-test-cmd")?.value || "get_state";
  var argsStr = document.getElementById("editor-test-args")?.value || "{}";
  var args;
  try {
    args = JSON.parse(argsStr);
  } catch (e) {
    document.getElementById("editor-test-result").textContent = "JSON-Fehler: " + e.message;
    return;
  }
  args.type = cmd;
  handleRemoteCommand(args);
  document.getElementById("editor-test-result").textContent = 'Befehl "' + cmd + '" gesendet.';
}

async function toggleEditorRemote() {
  if (!window.electronAPI) return;
  try {
    var status = await window.electronAPI.getRemoteStatus();
    if (status.running) {
      await window.electronAPI.stopRemote();
      log("Remote-Server gestoppt.", "info");
    } else {
      var portEl = document.getElementById("editor-remote-port");
      var port = portEl ? parseInt(portEl.value, 10) || 8080 : 8080;
      var result = await window.electronAPI.startRemote(port);
      if (result.ok) {
        log("Remote-Server gestartet auf ws://127.0.0.1:" + (result.port || port), "success");
      } else {
        log("Remote-Server Fehler: " + result.error, "error");
      }
    }
    updateRemoteUI();
  } catch (err) {
    log("Remote-Server Fehler: " + err.message, "error");
  }
}

function copyTokenToClipboard() {
  var tokenEl = document.getElementById("editor-remote-token");
  if (!tokenEl || !tokenEl.textContent) return;
  navigator.clipboard
    .writeText(tokenEl.textContent)
    .then(function () {
      log("Token in Zwischenablage kopiert.", "success");
    })
    .catch(function () {
      log("Token konnte nicht kopiert werden.", "error");
    });
}

document.addEventListener("DOMContentLoaded", function () {
  // Register remote command listener
  if (window.electronAPI && typeof window.electronAPI.onRemoteCommand === "function") {
    window.electronAPI.onRemoteCommand(handleRemoteCommand);
  }

  // Legacy settings toggle button (old)
  document.getElementById("btn-toggle-remote")?.addEventListener("click", toggleEditorRemote);

  // Editor Remote tab toggle
  document
    .getElementById("btn-editor-toggle-remote")
    ?.addEventListener("click", toggleEditorRemote);

  // Editor Remote copy token
  document.getElementById("btn-editor-copy-token")?.addEventListener("click", copyTokenToClipboard);

  // Editor Remote test command
  document.getElementById("btn-editor-test-cmd")?.addEventListener("click", testRemoteCommand);

  // Editor Remote clear log
  document.getElementById("btn-editor-clear-cmd-log")?.addEventListener("click", function () {
    cmdLog.length = 0;
    renderRemoteCmdLog();
  });

  // Log filter
  document.getElementById("remote-log-filter")?.addEventListener("change", function () {
    renderRemoteCmdLog();
  });

  // Code language selector
  document.getElementById("remote-code-lang")?.addEventListener("change", function () {
    updateRemoteCodeSnippet();
  });

  // Refresh status periodically
  setInterval(updateRemoteUI, 3000);
  updateRemoteUI();
  renderRemoteCmdLog();
});

export {
  handleRemoteCommand,
  updateRemoteUI,
  updateEditorRemoteUI,
  addRemoteCmdLog,
  updateRemoteCodeSnippet,
  remoteStats,
};
