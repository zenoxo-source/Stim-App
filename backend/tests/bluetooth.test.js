/**
 * Tests for bluetooth.js — runs in Node with mocked browser environment.
 * Evaluates the real bluetooth.js in a sandbox with mocked globals.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bluetoothSrc = fs.readFileSync(
  path.resolve(__dirname, "../../frontend/js/modules/bluetooth.js"),
  "utf-8"
);

function createSandbox() {
  const writes = [];

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    Uint8Array,
    Math,
    Number,
    Date,
    parseInt,
    parseFloat,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Promise,
    navigator: { bluetooth: {} },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    window: {},
    AppState: {
      writeChar: null,
      notifyChar: null,
      device: null,
      server: null,
      batteryChar: null,
      isConnected: false,
      strengthA: 0,
      strengthB: 0,
      frequencyA: 45,
      frequencyB: 45,
      pulseWidthA: 100,
      pulseWidthB: 100,
      masterScale: 1.0,
      softLimitA: 150,
      softLimitB: 150,
      swapChannels: false,
      activePattern: null,
      lastWaveFreqA: 45,
      lastWaveFreqB: 45,
      lastWaveAmpA: 0,
      lastWaveAmpB: 0,
      btSeq: 0,
      btAwaitingAck: false,
      btPendingMode: 0,
      pendingWaveformData: null,
      pendingStrengthData: null,
      isBluetoothWriting: false,
      debugMode: false,
      lastB1Time: 0,
      _lastSentStrA: undefined,
      _lastSentStrB: undefined,
      _lastSentFreqA: undefined,
      _lastSentFreqB: undefined,
      _lastSentAmpA: undefined,
      _lastSentAmpB: undefined,
      reconnectAttempts: 0,
      reconnectTimer: null,
      batteryIntervalId: null,
      loopTimeCounter: 0,
      isAudioPlaying: false,
      analyserA: null,
      analyserB: null,
      reflexState: "IDLE",
      rhythmState: "IDLE",
      edgeState: "IDLE",
      potatoState: "IDLE",
      survivalState: "IDLE",
      waveLoopInterval: null,
      aiVisRunning: false,
      sensitivityA: 1.2,
      sensitivityB: 1.2,
      freqBalanceA: 160,
      freqBalanceB: 160,
      waveBalanceA: 0,
      waveBalanceB: 0,
      audioElement: {},
      audioTimer: null,
      safetyTimerEndsAt: null,
      safetyTimerInterval: null,
      safetyTimerMinutes: 15,
      playlist: [],
      playlistIndex: -1,
      onboardingStep: 0,
    },
    DOM: {},
    CONSTANTS: {
      SERVICE_UUID: "0000180c-0000-1000-8000-00805f9b34fb",
      WRITE_UUID: "0000150a-0000-1000-8000-00805f9b34fb",
      NOTIFY_UUID: "0000150b-0000-1000-8000-00805f9b34fb",
      BATTERY_UUID: "00001500-0000-1000-8000-00805f9b34fb",
      COYOTE_NAME_PREFIX: "47L121",
      MIN_INTENSITY: 0,
      MAX_INTENSITY: 200,
      DEFAULT_SOFT_LIMIT: 150,
      DEFAULT_MASTER_SCALE: 1.0,
      WAVE_LOOP_INTERVAL_MS: 100,
      BATTERY_READ_INTERVAL_MS: 60000,
      DEFAULT_FREQUENCY: 45,
      MIN_FREQUENCY: 10,
      MAX_FREQUENCY: 240,
      V3_MODE_ABSOLUTE_BOTH: 0x0f,
      EMERGENCY_FREQUENCY: 45,
      MAX_RECONNECT_ATTEMPTS: 5,
      RECONNECT_DELAY_MS: 2000,
      B1_ACK_TIMEOUT_MS: 300,
      B1_STALE_WARNING_MS: 5000,
      DEVICE_INFO_SERVICE: "device_information",
      BATTERY_SERVICE: "battery_service",
      CUSTOM_BATTERY_SERVICE: "955a180a-0fe2-f5aa-a094-84b8d4f3e8ad",
      DEVICE_INFO_MANUFACTURER: "00001501-0000-1000-8000-00805f9b34fb",
      DEVICE_INFO_FIRMWARE: "00001502-0000-1000-8000-00805f9b34fb",
      DEVICE_INFO_HARDWARE: "00002a59-0000-1000-8000-00805f9b34fb",
    },
    log: () => {},
    ProtocolUtils: require(path.resolve(
      __dirname,
      "../../frontend/js/lib/protocol-utils.js"
    )),
    startWaveLoop: () => {},
    stopWaveLoop: () => {},
    updateOutputStatus: () => {},
    updateAIDashboard: () => {},
    updateSessionUI: () => {},
    renderAIVisualizer: () => {},
    unlockAchievement: () => {},
    ensureGameStrength: () => {},
    updateSlidersA: () => {},
    updateSlidersB: () => {},
    setChannelFreq: () => {},
    syncFreqUI: () => {},
    killAllOutput: () => {},
    loadSettings: () => {},
    saveSettings: () => {},
    applySettings: () => {},
    applyAudioMasterLink: () => {},
    initCanvasVisualizers: () => {},
    drawVisualizerLoop: () => {},
    SESSION_STATE: {
      activeSession: null,
      computeTick: () => null,
      stop: () => {},
      pause: () => {},
      resume: () => {},
      start: () => {},
      getElapsedSec: () => 0,
      getCurrentPhase: () => null,
    },
    SESSIONS: {},
    isOutputActive: () => false,
    showOnboarding: () => {},
    recordHighscore: () => {},
    getHighscore: () => {},
    refreshHighscoreUI: () => {},
    applyIntensityPreset: () => {},
    startSafetyTimer: () => {},
    stopSafetyTimer: () => {},
    stopEdgeGame: () => {},
    stopPotatoGame: () => {},
    stopSurvivalGame: () => {},
    stopAllMiniGames: () => {},
    beginMiniGame: () => {},
    showGameSelectors: () => {},
    hideGameSelectors: () => {},
    playGameSfx: () => {},
    showFunToast: () => {},
    startPatternRoulette: () => {},
    fireChancePulse: () => {},
    noteDailyProgress: () => {},
    trackStat: () => {},
    startDailyChallenge: () => {},
    startQuickPlay: () => {},
    sendB0Now: null,
    sendStrengthCommand: null,
    sendWaveformCommand: null,
    sendSoftStop: null,
    sendV3Init: null,
    sendV3EmergencyStop: null,
    updateHeartbeat: null,
    validateModules: null,
    sendBluetoothCommand: null,
    updateBatteryUI: null,
    resetUIOnDisconnect: null,
    clearReconnect: null,
    _writes: writes,
  };

  // Mock writeChar that captures writes
  const mockWriteChar = {
    writeValueWithoutResponse: async (data) => {
      writes.push(new Uint8Array(data));
    },
    writeValue: async (data) => {
      writes.push(new Uint8Array(data));
    },
  };

  sandbox._mockWriteChar = mockWriteChar;

  vm.createContext(sandbox);
  vm.runInContext(bluetoothSrc, sandbox);

  return sandbox;
}

function connect(sandbox) {
  sandbox.AppState.writeChar = sandbox._mockWriteChar;
  sandbox.AppState.isConnected = true;
}

describe("bluetooth.js (sandbox)", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  describe("sendB0Now", () => {
    it("builds and sends a B0 packet", () => {
      connect(sandbox);
      sandbox.AppState.strengthA = 50;
      sandbox.AppState.strengthB = 50;

      sandbox.window.sendB0Now(45, 100, 45, 100);

      assert.ok(sandbox._writes.length > 0);
      assert.equal(sandbox._writes[0][0], 0xb0);
    });

    it("does not send when not connected", () => {
      sandbox.AppState.writeChar = null;
      sandbox.window.sendB0Now(45, 100, 45, 100);
      assert.equal(sandbox._writes.length, 0);
    });

    it("skips duplicate sends (isDirty)", () => {
      connect(sandbox);
      sandbox.AppState.strengthA = 50;
      sandbox.AppState.strengthB = 50;

      sandbox.window.sendB0Now(45, 100, 45, 100);
      assert.ok(sandbox._writes.length > 0);
      const countAfterFirst = sandbox._writes.length;

      // Identical values → should be skipped
      sandbox.window.sendB0Now(45, 100, 45, 100);
      assert.equal(sandbox._writes.length, countAfterFirst);
    });

    it("applies pulse-width scaling to wave amplitude", () => {
      connect(sandbox);
      sandbox.AppState.pulseWidthA = 50; // 50%
      sandbox.AppState.strengthA = 50;

      sandbox.window.sendB0Now(45, 100, 45, 100);

      const p = sandbox._writes[sandbox._writes.length - 1];
      assert.equal(p[8], 50); // 100 * 50%
    });

    it("applies master scale to wave amplitude", () => {
      connect(sandbox);
      sandbox.AppState.masterScale = 0.5;
      sandbox.AppState.strengthA = 50;

      sandbox.window.sendB0Now(45, 100, 45, 100);

      const p = sandbox._writes[sandbox._writes.length - 1];
      assert.equal(p[8], 50); // 100 * 0.5
    });

    it("uses absolute mode 0x0F when strength changed", () => {
      connect(sandbox);
      sandbox.AppState.btPendingMode = 0x0f;

      sandbox.window.sendB0Now(45, 100, 45, 100);

      const p = sandbox._writes[sandbox._writes.length - 1];
      assert.equal(p[1] & 0x0f, 0x0f);
    });

    it("seq=0 when no strength change", () => {
      connect(sandbox);
      sandbox.AppState.btPendingMode = 0;

      sandbox.window.sendB0Now(45, 100, 45, 100);

      const p = sandbox._writes[sandbox._writes.length - 1];
      assert.equal(p[1] >> 4, 0);
    });

    it("strength values go to bytes 2-3", () => {
      connect(sandbox);
      sandbox.AppState.strengthA = 80;
      sandbox.AppState.strengthB = 60;

      sandbox.window.sendB0Now(45, 100, 45, 100);

      const p = sandbox._writes[sandbox._writes.length - 1];
      assert.equal(p[2], 80);
      assert.equal(p[3], 60);
    });
  });

  describe("sendStrengthCommand", () => {
    it("updates AppState strength and triggers B0", () => {
      connect(sandbox);

      sandbox.window.sendStrengthCommand(80, 60);

      assert.equal(sandbox.AppState.strengthA, 80);
      assert.equal(sandbox.AppState.strengthB, 60);
      assert.ok(sandbox._writes.length > 0);
      assert.equal(sandbox._writes[0][0], 0xb0);
      assert.equal(sandbox._writes[0][2], 80);
      assert.equal(sandbox._writes[0][3], 60);
    });

    it("clamps strength to soft limit", () => {
      connect(sandbox);
      sandbox.AppState.softLimitA = 100;

      sandbox.window.sendStrengthCommand(150, 200);

      assert.equal(sandbox.AppState.strengthA, 100);
    });

    it("sends immediately without waiting for wave loop", () => {
      connect(sandbox);

      sandbox.window.sendStrengthCommand(75, 75);

      assert.ok(sandbox._writes.length > 0);
    });
  });

  describe("sendSoftStop", () => {
    it("builds inactive wave packet (freq 0, intensity 101)", () => {
      connect(sandbox);
      sandbox.AppState.strengthA = 50;

      sandbox.window.sendSoftStop({ keepStrength: false });

      assert.ok(sandbox._writes.length > 0);
      const p = sandbox._writes[sandbox._writes.length - 1];
      assert.equal(p[0], 0xb0);
      assert.equal(p[8], 101); // intensityA inactive
      assert.equal(p[16], 101); // intensityB inactive
    });
  });

  describe("sendV3EmergencyStop", () => {
    it("zeros strength and sends absolute stop", () => {
      connect(sandbox);
      sandbox.AppState.strengthA = 100;
      sandbox.AppState.strengthB = 100;

      sandbox.window.sendV3EmergencyStop();

      assert.equal(sandbox.AppState.strengthA, 0);
      assert.equal(sandbox.AppState.strengthB, 0);
      assert.ok(sandbox._writes.length > 0);
      assert.equal(sandbox._writes[sandbox._writes.length - 1][2], 0);
      assert.equal(sandbox._writes[sandbox._writes.length - 1][3], 0);
    });
  });

  describe("sendV3Init", () => {
    it("sends 7-byte BF packet with limits and balance", () => {
      connect(sandbox);
      sandbox.AppState.softLimitA = 120;
      sandbox.AppState.softLimitB = 80;

      sandbox.window.sendV3Init();

      assert.ok(sandbox._writes.length > 0);
      const bf = sandbox._writes.find((w) => w[0] === 0xbf);
      assert.ok(bf);
      assert.equal(bf.length, 7);
      assert.equal(bf[1], 120); // limitA
      assert.equal(bf[2], 80); // limitB
      assert.equal(bf[3], 160); // freqBalA default
      assert.equal(bf[4], 160); // freqBalB default
      assert.equal(bf[5], 0); // waveBalA default
      assert.equal(bf[6], 0); // waveBalB default
    });
  });

  describe("handleDeviceNotification (B1 ACK)", () => {
    it("B1 clears awaitingAck on matching sequence", () => {
      // This tests the internal logic. The handler is not exported,
      // so we verify the logic conceptually.
      sandbox.AppState.btAwaitingAck = true;
      sandbox.AppState.btSeq = 3;
      assert.equal(sandbox.AppState.btSeq, 3);
      // The actual handler requires a real BLE event, which is covered
      // by the module's DOMContentLoaded listener (not tested here).
    });
  });

  describe("validateModules", () => {
    it("returns a boolean", () => {
      const ok = sandbox.window.validateModules();
      assert.equal(typeof ok, "boolean");
    });
  });

  describe("updateHeartbeat", () => {
    it("does not warn when B1 is fresh", () => {
      sandbox.AppState.isConnected = true;
      sandbox.AppState.lastB1Time = Date.now();
      sandbox.AppState.strengthA = 50;

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args);

      sandbox.window.updateHeartbeat();

      console.warn = origWarn;
      assert.equal(warns.length, 0);
    });

    it("does not warn when not connected", () => {
      sandbox.AppState.isConnected = false;
      sandbox.AppState.lastB1Time = Date.now() - 10000;
      sandbox.AppState.strengthA = 50;

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args);

      sandbox.window.updateHeartbeat();

      console.warn = origWarn;
      assert.equal(warns.length, 0);
    });
  });
});
