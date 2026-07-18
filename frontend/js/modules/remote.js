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
    const val = Math.min(100, Math.max(0, parseInt(msg.value, 10) || 100));
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
    const chA = Array.isArray(msg.channelA) ? msg.channelA.slice(0, 32) : [];
    const chB = Array.isArray(msg.channelB) ? msg.channelB.slice(0, 32) : [];
    const interval = parseInt(msg.interval, 10) || 100;
    if (chA.length === 0 && chB.length === 0) {
      return { ok: false, error: "channelA or channelB required" };
    }
    AppState.aiCustomPatternA = chA.map(function (v) {
      return Math.min(100, Math.max(0, Math.round(v)));
    });
    AppState.aiCustomPatternB = chB.map(function (v) {
      return Math.min(100, Math.max(0, Math.round(v)));
    });
    AppState.aiCustomInterval = interval;
    AppState.activePattern = CONSTANTS.PATTERNS.AI_CUSTOM;
    document.querySelectorAll(".pattern-card").forEach(function (c) {
      c.classList.remove("active");
    });
    if (typeof ensureGameStrength === "function") ensureGameStrength(40);
    if (typeof updateAIDashboard === "function") updateAIDashboard();
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
  var portEl = document.getElementById("editor-remote-port");
  if (!pre || !token || !token.textContent) {
    if (pre) pre.textContent = "Server muss laufen, um Codebeispiele anzuzeigen.";
    return;
  }
  var t = token.textContent;
  var port = portEl ? portEl.value : "8080";
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
      "        # Intensität setzen\n" +
      '        await ws.send(json.dumps({"type":"set_intensity","channel":"A","value":80}))\n' +
      "        # Status abfragen\n" +
      '        await ws.send(json.dumps({"type":"get_state"}))\n' +
      "        resp = json.loads(await ws.recv())\n" +
      '        print("Status:", resp)\n\n' +
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
      "  // Intensität setzen\n" +
      '  ws.send(JSON.stringify({ type: "set_intensity", channel: "A", value: 80 }));\n' +
      "  // Status abfragen\n" +
      '  ws.send(JSON.stringify({ type: "get_state" }));\n' +
      "});\n\n" +
      'ws.on("message", (data) => {\n' +
      "  const msg = JSON.parse(data);\n" +
      '  console.log("Antwort:", msg);\n' +
      "});",

    curl:
      "# curl kann kein WebSocket direkt.\n" +
      "# Nutze websocat oder wscat zum Testen:\n\n" +
      "# Mit websocat (https://github.com/vi/websocat):\n" +
      'echo \'{"type":"set_intensity","channel":"A","value":80}\' | \\\n' +
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

function handleRemoteCommand(msg) {
  var type = String(msg.type || "");
  var handler = REMOTE_COMMANDS[type];
  var ts = new Date().toLocaleTimeString();
  remoteStats.totalCmds++;
  if (!handler) {
    remoteStats.errCmds++;
    log('Remote: unbekannter Befehl "' + type + '"', "warning");
    addRemoteCmdLog("[" + ts + '] WARN: unbekannter Befehl "' + type + '"');
    return;
  }
  try {
    var result = handler(msg);
    if (typeof trackStat === "function") trackStat("remote_command");
    if (result && result.ok !== false) {
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
    } else if (result && result.error) {
      remoteStats.errCmds++;
      log("Remote: " + type + " fehlgeschlagen \u2014 " + result.error, "error");
      addRemoteCmdLog("[" + ts + "] ERR: " + type + " \u2014 " + result.error);
    }
  } catch (err) {
    remoteStats.errCmds++;
    log("Remote: " + type + " Fehler \u2014 " + err.message, "error");
    addRemoteCmdLog("[" + ts + "] ERR: " + type + " \u2014 " + err.message);
  }
}

// First-pass update (called for legacy settings tab)
async function _updateRemoteUISettings() {
  if (!window.electronAPI || typeof window.electronAPI.getRemoteStatus !== "function") return;
  try {
    var status = await window.electronAPI.getRemoteStatus();
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
}

// Editor Remote tab UI
async function updateEditorRemoteUI() {
  if (!window.electronAPI || typeof window.electronAPI.getRemoteStatus !== "function") return;
  try {
    const status = await window.electronAPI.getRemoteStatus();
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

window.handleRemoteCommand = handleRemoteCommand;
window.updateRemoteUI = updateRemoteUI;
window.updateEditorRemoteUI = updateEditorRemoteUI;
window.addRemoteCmdLog = addRemoteCmdLog;
window.updateRemoteCodeSnippet = updateRemoteCodeSnippet;
window.remoteStats = remoteStats;
