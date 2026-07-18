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
  pulseWidthA: 100,
  pulseWidthB: 100,

  masterScale: 1.0,
  softLimitA: 150,
  softLimitB: 150,
  // BF balance params (0–255); defaults match prior fixed 0xA0 / 0x00
  freqBalanceA: 160,
  freqBalanceB: 160,
  waveBalanceA: 0,
  waveBalanceB: 0,

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

  edgeState: "IDLE",
  edgeHolding: false,
  edgeLevel: 0,
  edgeScore: 0,
  edgeZoneMin: 60,
  edgeZoneMax: 75,
  edgeRaf: null,
  edgeLastTick: 0,
  edgeInZoneMs: 0,

  potatoState: "IDLE",
  potatoScore: 0,
  potatoRound: 0,
  potatoChannel: "A",
  potatoDeadline: 0,
  potatoTimeout: null,
  potatoTick: null,

  survivalState: "IDLE",
  survivalScore: 0,
  survivalLevel: 0,
  survivalRaf: null,
  survivalLastTick: 0,
  survivalStartedAt: 0,

  safetyTimerEndsAt: null,
  safetyTimerInterval: null,
  safetyTimerMinutes: 15,

  reconnectAttempts: 0,
  reconnectTimer: null,
  batteryIntervalId: null,

  playlist: [],
  playlistIndex: -1,
  onboardingStep: 0,

  btSeq: 0,
  btAwaitingAck: false,
  btPendingMode: 0,

  reset() {
    this.strengthA = 0;
    this.strengthB = 0;
    this.frequencyA = 45;
    this.frequencyB = 45;
    this.pulseWidthA = 100;
    this.pulseWidthB = 100;
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
    this.edgeState = "IDLE";
    this.potatoState = "IDLE";
    this.survivalState = "IDLE";
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
    "slider-freq-a",
    "label-freq-a",
    "slider-width-a",
    "label-width-a",
    "badge-mode-a",
    // Channel B
    "slider-intensity-b",
    "intensity-circle-b",
    "label-intensity-b",
    "btn-dec-b",
    "btn-inc-b",
    "select-freq-b",
    "slider-freq-b",
    "label-freq-b",
    "slider-width-b",
    "label-width-b",
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
    "arena-edge",
    "btn-start-edge",
    "btn-exit-edge",
    "edge-feedback",
    "edge-score",
    "edge-hold-btn",
    "arena-potato",
    "btn-start-potato",
    "btn-exit-potato",
    "potato-feedback",
    "potato-score",
    "potato-channel",
    "btn-potato-a",
    "btn-potato-b",
    "arena-survival",
    "btn-start-survival",
    "btn-exit-survival",
    "btn-survival-bail",
    "survival-feedback",
    "survival-score",
    "survival-level",
    "survival-bar",
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
    "btn-check-update",
    "btn-install-update",
    "update-status-text",
    "btn-panic",
    "output-status",
    "output-status-text",
    "safety-chip",
    "safety-chip-text",
    "reconnect-status",
    "bt-device-list",
    "stim-playlist",
    "btn-prev-track",
    "btn-next-track",
    "check-audio-master-link",
    "about-version-line",
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
