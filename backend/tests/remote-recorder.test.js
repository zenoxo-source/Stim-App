/**
 * Tests for remote.js and recorder.js — sandbox approach like bluetooth.test.js
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadInSandbox(filePath, extraGlobals = {}) {
  const src = fs.readFileSync(path.resolve(__dirname, filePath), "utf-8");
  const writes = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: (fn, ms) => {
      // Don't actually run intervals in tests
      return null;
    },
    clearInterval: () => {},
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
    Blob: function (parts, opts) {
      this.parts = parts;
      this.opts = opts;
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ click: () => {}, href: "", download: "" }),
    },
    navigator: { bluetooth: {} },
    localStorage: {
      store: {},
      getItem(k) {
        return this.store[k] || null;
      },
      setItem(k, v) {
        this.store[k] = v;
      },
      removeItem(k) {
        delete this.store[k];
      },
    },
    window: {},
    AppState: {
      isConnected: false,
      strengthA: 0,
      strengthB: 0,
      frequencyA: 45,
      frequencyB: 45,
      activePattern: null,
      masterScale: 1.0,
      softLimitA: 150,
      softLimitB: 150,
      batteryLevel: 0,
      swapChannels: false,
      lastWaveFreqA: 45,
      lastWaveFreqB: 45,
      lastWaveAmpA: 0,
      lastWaveAmpB: 0,
    },
    DOM: {},
    CONSTANTS: {
      WAVE_LOOP_INTERVAL_MS: 100,
    },
    log: () => {},
    ProtocolUtils: require(path.resolve(__dirname, "../../frontend/js/lib/protocol-utils.js")),
    updateSlidersA: () => {},
    updateSlidersB: () => {},
    updateOutputStatus: () => {},
    updateAIDashboard: () => {},
    killAllOutput: () => {},
    sendWaveformCommand: () => {},
    sendSoftStop: () => {},
    ...extraGlobals,
  };

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

describe("recorder.js", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = loadInSandbox("../../frontend/js/modules/recorder.js");
  });

  const R = () => sandbox.window.RECORDER;

  describe("RECORDER state", () => {
    it("starts in idle state", () => {
      assert.equal(R().recording, false);
      assert.equal(R().replaying, false);
      assert.equal(R().frames.length, 0);
    });
  });

  describe("start/stop recording", () => {
    it("starts recording and sets startTime", () => {
      R().start();
      assert.equal(R().recording, true);
      assert.ok(R().startTime > 0);
    });

    it("stops recording and keeps frames", () => {
      R().start();
      R().captureTick(45, 50, 45, 50);
      R().captureTick(50, 60, 50, 60);
      R().stop();

      assert.equal(R().recording, false);
      assert.equal(R().frames.length, 2);
    });

    it("captureTick does nothing when not recording", () => {
      R().captureTick(45, 50, 45, 50);
      assert.equal(R().frames.length, 0);
    });

    it("captureTick stores frame with timestamp and values", () => {
      R().start();
      R().captureTick(45, 50, 45, 50);
      const frame = R().frames[0];
      assert.equal(typeof frame.t, "number");
      assert.equal(frame.fA, 45);
      assert.equal(frame.aA, 50);
      assert.equal(frame.fB, 45);
      assert.equal(frame.aB, 50);
    });
  });

  describe("load", () => {
    it("loads a valid recording", async () => {
      const file = {
        text: async () =>
          JSON.stringify({
            format: "stim-app-recording",
            version: 1,
            duration: 1000,
            frames: [
              { t: 0, fA: 45, aA: 50, fB: 45, aB: 50, strA: 30, strB: 30 },
              { t: 100, fA: 50, aA: 60, fB: 50, aB: 60, strA: 40, strB: 40 },
            ],
          }),
      };
      await R().load(file);
      assert.equal(R().frames.length, 2);
      assert.equal(R().frames[0].fA, 45);
    });

    it("rejects invalid format", async () => {
      const file = {
        text: async () => JSON.stringify({ format: "wrong", frames: [] }),
      };
      await R().load(file);
      assert.equal(R().frames.length, 0);
    });

    it("rejects malformed JSON", async () => {
      const file = { text: async () => "not-json" };
      await R().load(file);
      assert.equal(R().frames.length, 0);
    });
  });

  describe("stopReplay", () => {
    it("stops replay and clears timer", () => {
      R().replaying = true;
      R().replayTimer = 12345;
      R().stopReplay();
      assert.equal(R().replaying, false);
      assert.equal(R().replayTimer, null);
    });
  });
});

describe("remote.js", () => {
  let sandbox;
  let lastSliderCall;

  beforeEach(() => {
    lastSliderCall = null;
    sandbox = loadInSandbox("../../frontend/js/modules/remote.js", {
      updateSlidersA: (v) => {
        lastSliderCall = { channel: "A", value: v };
      },
      updateSlidersB: (v) => {
        lastSliderCall = { channel: "B", value: v };
      },
      killAllOutput: () => {
        lastSliderCall = { killed: true };
      },
    });
  });

  describe("handleRemoteCommand", () => {
    it("handles set_intensity for channel A", () => {
      sandbox.window.handleRemoteCommand({ type: "set_intensity", channel: "A", value: 75 });
      assert.deepEqual(lastSliderCall, { channel: "A", value: 75 });
    });

    it("handles set_intensity for channel B", () => {
      sandbox.window.handleRemoteCommand({ type: "set_intensity", channel: "B", value: 60 });
      assert.deepEqual(lastSliderCall, { channel: "B", value: 60 });
    });

    it("handles set_intensity for both channels when channel is missing", () => {
      sandbox.window.handleRemoteCommand({ type: "set_intensity", value: 50 });
      // Both A and B are called; last call is B
      assert.deepEqual(lastSliderCall, { channel: "B", value: 50 });
    });

    it("clamps intensity to 0-200", () => {
      sandbox.window.handleRemoteCommand({ type: "set_intensity", channel: "A", value: 999 });
      assert.equal(lastSliderCall.value, 200);
    });

    it("handles stop_all", () => {
      sandbox.window.handleRemoteCommand({ type: "stop_all" });
      assert.equal(lastSliderCall.killed, true);
    });

    it("handles get_state without crashing", () => {
      sandbox.AppState.isConnected = true;
      sandbox.AppState.strengthA = 50;
      assert.doesNotThrow(() =>
        sandbox.window.handleRemoteCommand({ type: "get_state" })
      );
    });

    it("ignores unknown commands without crashing", () => {
      sandbox.window.handleRemoteCommand({ type: "unknown_command" });
      assert.equal(lastSliderCall, null);
    });

    it("handles missing type field", () => {
      sandbox.window.handleRemoteCommand({});
      assert.equal(lastSliderCall, null);
    });
  });
});
