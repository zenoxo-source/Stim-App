// state.js - Central application state and DOM cache

const AppState = {
  device: null,
  server: null,
  writeChar: null,
  notifyChar: null,
  batteryChar: null,
  isConnected: false,
  batteryLevel: 0,

  strengthA: 0,
  strengthB: 0,
  frequencyA: 45,
  frequencyB: 45,
  pulseWidthA: 15,
  pulseWidthB: 15,

  masterScale: 1.0,
  softLimitA: 150,
  softLimitB: 150,

  waveLoopInterval: null,
  loopTimeCounter: 0,
  activePattern: null,

  isBluetoothWriting: false,
  pendingStrengthData: null,
  pendingWaveformData: null,
  swapChannels: false,

  audioCtx: null,
  audioElement: new Audio(),
  mediaElementSource: null,
  audioGainNode: null,
  audioSplitterNode: null,
  analyserA: null,
  analyserB: null,
  isAudioPlaying: false,
  audioTimer: null,
  audioHearSound: true,
  sensitivityA: 1.2,
  sensitivityB: 1.2,
  canvasCtxA: null,
  canvasCtxB: null,
  animationFrameId: null,

  lastWaveFreqA: 45,
  lastWaveFreqB: 45,
  lastWaveAmpA: 0,
  lastWaveAmpB: 0,

  aiCustomPatternA: [],
  aiCustomPatternB: [],
  aiCustomInterval: 100,
  aiVisRunning: false,

  reflexState: "IDLE",
  reflexLevel: 1,
  reflexTargetTime: 450,
  reflexHighscore: 0,
  reflexStartTime: 0,
  reflexTimeoutId: null,
  reflexShockVal: 30,
  reflexScore: 0,

  rhythmState: "IDLE",
  rhythmTempo: 95,
  rhythmScore: 0,
  rhythmCombo: 0,
  rhythmMultiplier: 1,
  rhythmShockVal: 30,
  rhythmIntervalId: null,
  rhythmBeatsArray: [true, false, true, true],
  rhythmCurrentBeatIndex: 0,
  rhythmNextBeatTime: 0,
  rhythmLastTapTime: 0,
  rhythmWindow: 150,

  reconnectAttempts: 0,
  reconnectTimer: null,
  batteryIntervalId: null,

  btSeq: 0,
  btAwaitingAck: false,
  btPendingMode: 0,

  reset() {
    this.strengthA = 0;
    this.strengthB = 0;
    this.frequencyA = 45;
    this.frequencyB = 45;
    this.pulseWidthA = 15;
    this.pulseWidthB = 15;
    this.activePattern = null;
    this.isAudioPlaying = false;
    this.lastWaveFreqA = 45;
    this.lastWaveFreqB = 45;
    this.lastWaveAmpA = 0;
    this.lastWaveAmpB = 0;
    this.btSeq = 0;
    this.btAwaitingAck = false;
    this.btPendingMode = 0;
    this.reflexState = "IDLE";
    this.rhythmState = "IDLE";
  },
};

const DOM = {};

document.addEventListener("DOMContentLoaded", () => {
  const ids = [
    // Header / Status
    "connection-text",
    "connection-indicator",
    "btn-connect",
    "btn-disconnect",
    "battery-level-bar",
    "battery-text",
    "master-val-text",
    "slider-master",
    // Channel A
    "slider-intensity-a",
    "intensity-circle-a",
    "label-intensity-a",
    "btn-dec-a",
    "btn-inc-a",
    "select-freq-a",
    "slider-width-a",
    "badge-mode-a",
    // Channel B
    "slider-intensity-b",
    "intensity-circle-b",
    "label-intensity-b",
    "btn-dec-b",
    "btn-inc-b",
    "select-freq-b",
    "slider-width-b",
    "badge-mode-b",
    // Deck visuals
    "deck-visualizer-a",
    "deck-visualizer-b",
    // Patterns
    "btn-stop-pattern",
    // Sessions
    "session-indicator",
    "session-phase",
    "session-time",
    "session-progress",
    "btn-session-pause",
    "btn-session-stop",
    // STIM Player
    "drop-zone",
    "input-stim-file",
    "audio-panel",
    "btn-play-audio",
    "audio-track-title",
    "audio-time-elapsed",
    "audio-time-duration",
    "audio-timeline-slider",
    "check-hear-audio",
    "canvas-vis-a",
    "canvas-vis-b",
    "slider-sens-a",
    "slider-sens-b",
    "visualizer-val-a",
    "visualizer-val-b",
    // Games
    "game-selectors",
    "arena-reflex",
    "btn-start-reflex",
    "btn-exit-reflex",
    "reflex-tap-box",
    "reflex-text",
    "reflex-subtext",
    "reflex-level",
    "reflex-time",
    "reflex-target",
    "reflex-shock",
    "reflex-feedback-message",
    "arena-rhythm",
    "btn-start-rhythm",
    "btn-exit-rhythm",
    "rhythm-tap-area",
    "rhythm-score",
    "rhythm-combo",
    "rhythm-tempo",
    "rhythm-shock",
    "rhythm-feedback-message",
    "rhythm-start-prompt",
    // AI
    "ai-dash-int-a",
    "ai-dash-int-b",
    "ai-dash-pattern",
    "ai-dash-visualizer",
    "ai-visualizer-a",
    "ai-visualizer-b",
    // Settings
    "slider-limit-a",
    "slider-limit-b",
    "label-limit-a",
    "label-limit-b",
    "info-device-name",
    "info-manufacturer",
    "info-firmware",
    "info-hardware",
    "check-swap-channels",
    "check-settings-audio",
    "ai-provider",
    "ai-endpoint",
    "ai-api-key",
    "ai-model",
    "ai-system-prompt",
    // Logs
    "terminal-log",
    "btn-clear-logs",
    "btn-export-logs",
    "app-version-text",
    "gh-update-token",
    "btn-check-update",
    "btn-install-update",
    "update-status-text",
    "view-title",
    "view-subtitle",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) DOM[id] = el;
  });
});

function log(msg, type = "info") {
  const terminal = DOM["terminal-log"];
  if (!terminal) return;
  const time = new Date().toLocaleTimeString();
  const colors = {
    info: "#a6e22e",
    error: "#f92672",
    warning: "#fd971f",
    success: "#a6e22e",
  };

  const line = document.createElement("span");
  line.className = "log-line";
  line.style.color = colors[type] || colors.info;
  line.textContent = `[${time}] [${type.toUpperCase()}] ${msg}`;

  terminal.appendChild(document.createTextNode("\n"));
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

window.AppState = AppState;
window.DOM = DOM;
window.log = log;
