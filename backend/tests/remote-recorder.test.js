/**
 * Tests for remote.js and recorder.js.
 *
 * Pre-migration: each module was evaluated in a separate vm sandbox with
 * mocked globals. With ES modules we import the real implementations and
 * drive them via the singleton AppState (mutating it before each test).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import { AppState } from "../../frontend/js/state.js";
import { RECORDER } from "../../frontend/js/modules/recorder.js";
import { handleRemoteCommand, remoteStats } from "../../frontend/js/modules/remote.js";

function resetAppState() {
  AppState.isConnected = false;
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.frequencyA = 45;
  AppState.frequencyB = 45;
  AppState.activePattern = null;
  AppState.masterScale = 1.0;
  AppState.softLimitA = 150;
  AppState.softLimitB = 150;
  AppState.batteryLevel = 0;
  AppState.swapChannels = false;
  AppState.lastWaveFreqA = 45;
  AppState.lastWaveFreqB = 45;
  AppState.lastWaveAmpA = 0;
  AppState.lastWaveAmpB = 0;
  AppState.writeChar = null;
}

describe("recorder.js", () => {
  beforeEach(() => {
    resetAppState();
    // Reset RECORDER state
    RECORDER.recording = false;
    RECORDER.replaying = false;
    RECORDER.frames = [];
    RECORDER.startTime = 0;
    RECORDER.replayIndex = 0;
    if (RECORDER.replayTimer) {
      clearTimeout(RECORDER.replayTimer);
      RECORDER.replayTimer = null;
    }
  });

  describe("RECORDER state", () => {
    it("starts in idle state", () => {
      assert.equal(RECORDER.recording, false);
      assert.equal(RECORDER.replaying, false);
      assert.equal(RECORDER.frames.length, 0);
    });
  });

  describe("start/stop recording", () => {
    it("starts recording and sets startTime", () => {
      RECORDER.start();
      assert.equal(RECORDER.recording, true);
      assert.ok(RECORDER.startTime > 0);
    });

    it("stops recording and keeps frames", () => {
      RECORDER.start();
      RECORDER.captureTick(45, 50, 45, 50);
      RECORDER.captureTick(50, 60, 50, 60);
      RECORDER.stop();

      assert.equal(RECORDER.recording, false);
      assert.equal(RECORDER.frames.length, 2);
    });

    it("captureTick does nothing when not recording", () => {
      RECORDER.captureTick(45, 50, 45, 50);
      assert.equal(RECORDER.frames.length, 0);
    });

    it("captureTick stores frame with timestamp and values", () => {
      RECORDER.start();
      RECORDER.captureTick(45, 50, 45, 50);
      const frame = RECORDER.frames[0];
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
      await RECORDER.load(file);
      assert.equal(RECORDER.frames.length, 2);
      assert.equal(RECORDER.frames[0].fA, 45);
    });

    it("rejects invalid format", async () => {
      const file = {
        text: async () => JSON.stringify({ format: "wrong", frames: [] }),
      };
      await RECORDER.load(file);
      assert.equal(RECORDER.frames.length, 0);
    });

    it("rejects malformed JSON", async () => {
      const file = { text: async () => "not-json" };
      await RECORDER.load(file);
      assert.equal(RECORDER.frames.length, 0);
    });
  });

  describe("stopReplay", () => {
    it("stops replay and clears timer", () => {
      RECORDER.replaying = true;
      RECORDER.replayTimer = 12345;
      RECORDER.stopReplay();
      assert.equal(RECORDER.replaying, false);
      assert.equal(RECORDER.replayTimer, null);
    });
  });
});

describe("remote.js", () => {
  beforeEach(() => {
    resetAppState();
    // Reset remote stats so assertions are stable
    remoteStats.totalCmds = 0;
    remoteStats.okCmds = 0;
    remoteStats.errCmds = 0;
  });

  describe("handleRemoteCommand", () => {
    it("handles set_intensity for channel A", () => {
      handleRemoteCommand({ type: "set_intensity", channel: "A", value: 75 });
      assert.equal(AppState.strengthA, 75);
    });

    it("handles set_intensity for channel B", () => {
      handleRemoteCommand({ type: "set_intensity", channel: "B", value: 60 });
      assert.equal(AppState.strengthB, 60);
    });

    it("handles set_intensity for both channels when channel is missing", () => {
      handleRemoteCommand({ type: "set_intensity", value: 50 });
      assert.equal(AppState.strengthA, 50);
      assert.equal(AppState.strengthB, 50);
    });

    it("clamps intensity to 0-200", () => {
      handleRemoteCommand({ type: "set_intensity", channel: "A", value: 999 });
      // softLimitA is 150 in resetAppState(); sendStrengthCommand (and
      // updateSlidersA via clampStrengthWithCeiling) clamp to that.
      assert.equal(AppState.strengthA, 150);
    });

    it("handles stop_all (zeros strength via killAllOutput)", () => {
      AppState.strengthA = 80;
      AppState.strengthB = 80;
      handleRemoteCommand({ type: "stop_all" });
      assert.equal(AppState.strengthA, 0);
      assert.equal(AppState.strengthB, 0);
    });

    it("handles get_state without crashing", () => {
      AppState.isConnected = true;
      AppState.strengthA = 50;
      assert.doesNotThrow(() => handleRemoteCommand({ type: "get_state" }));
    });

    it("ignores unknown commands without crashing", () => {
      assert.doesNotThrow(() => handleRemoteCommand({ type: "unknown_command" }));
    });

    it("handles missing type field", () => {
      assert.doesNotThrow(() => handleRemoteCommand({}));
    });
  });
});
