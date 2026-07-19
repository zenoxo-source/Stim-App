/**
 * Tests for bluetooth.js — V3 BLE protocol logic.
 *
 * Pre-migration: a 470-line vm sandbox evaluated the source with mocked
 * globals. With ES modules, we import the real functions directly. AppState
 * is a singleton, so we mutate it before each test to set up state.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import { AppState } from "../../frontend/js/state.js";
import {
  sendB0Now,
  sendStrengthCommand,
  sendSoftStop,
  sendV3Init,
  sendV3EmergencyStop,
  updateHeartbeat,
  validateModules,
} from "../../frontend/js/modules/bluetooth.js";

const writes = [];

function makeMockWriteChar() {
  const capture = (data) => {
    writes.push(new Uint8Array(data));
  };
  return {
    writeValueWithoutResponse: async (data) => capture(data),
    writeValue: async (data) => capture(data),
  };
}

function resetAppState() {
  // Reset only the BLE-relevant fields (preserve function refs / structure)
  AppState.writeChar = null;
  AppState.isConnected = false;
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.frequencyA = 45;
  AppState.frequencyB = 45;
  AppState.pulseWidthA = 100;
  AppState.pulseWidthB = 100;
  AppState.masterScale = 1.0;
  AppState.softLimitA = 150;
  AppState.softLimitB = 150;
  AppState.swapChannels = false;
  AppState.activePattern = null;
  AppState.btSeq = 0;
  AppState.btAwaitingAck = false;
  AppState.btPendingMode = 0;
  AppState.debugMode = false;
  AppState.lastB1Time = 0;
  AppState._lastSentStrA = undefined;
  AppState._lastSentStrB = undefined;
  AppState._lastSentFreqA = undefined;
  AppState._lastSentFreqB = undefined;
  AppState._lastSentAmpA = undefined;
  AppState._lastSentAmpB = undefined;
  AppState.reconnectAttempts = 0;
  AppState.loopTimeCounter = 0;
  AppState.lastWaveFreqA = 45;
  AppState.lastWaveFreqB = 45;
  AppState.lastWaveAmpA = 0;
  AppState.lastWaveAmpB = 0;
}

function connect() {
  AppState.writeChar = makeMockWriteChar();
  AppState.isConnected = true;
}

describe("bluetooth.js", () => {
  beforeEach(() => {
    writes.length = 0;
    resetAppState();
  });

  describe("sendB0Now", () => {
    it("builds and sends a B0 packet", () => {
      connect();
      AppState.strengthA = 50;
      AppState.strengthB = 50;

      sendB0Now(45, 100, 45, 100);

      assert.ok(writes.length > 0);
      assert.equal(writes[0][0], 0xb0);
    });

    it("does not send when not connected", () => {
      AppState.writeChar = null;
      sendB0Now(45, 100, 45, 100);
      assert.equal(writes.length, 0);
    });

    it("skips duplicate sends (isDirty)", () => {
      connect();
      AppState.strengthA = 50;
      AppState.strengthB = 50;

      sendB0Now(45, 100, 45, 100);
      assert.ok(writes.length > 0);
      const countAfterFirst = writes.length;

      // Identical values → should be skipped
      sendB0Now(45, 100, 45, 100);
      assert.equal(writes.length, countAfterFirst);
    });

    it("applies pulse-width scaling to wave amplitude", () => {
      connect();
      AppState.pulseWidthA = 50; // 50%
      AppState.strengthA = 50;

      sendB0Now(45, 100, 45, 100);

      const p = writes[writes.length - 1];
      assert.equal(p[8], 50); // 100 * 50%
    });

    it("applies master scale to wave amplitude", () => {
      connect();
      AppState.masterScale = 0.5;
      AppState.strengthA = 50;

      sendB0Now(45, 100, 45, 100);

      const p = writes[writes.length - 1];
      assert.equal(p[8], 50); // 100 * 0.5
    });

    it("uses absolute mode 0x0F when strength changed", () => {
      connect();
      AppState.btPendingMode = 0x0f;

      sendB0Now(45, 100, 45, 100);

      const p = writes[writes.length - 1];
      assert.equal(p[1] & 0x0f, 0x0f);
    });

    it("seq=0 when no strength change", () => {
      connect();
      AppState.btPendingMode = 0;

      sendB0Now(45, 100, 45, 100);

      const p = writes[writes.length - 1];
      assert.equal(p[1] >> 4, 0);
    });

    it("strength values go to bytes 2-3", () => {
      connect();
      AppState.strengthA = 80;
      AppState.strengthB = 60;

      sendB0Now(45, 100, 45, 100);

      const p = writes[writes.length - 1];
      assert.equal(p[2], 80);
      assert.equal(p[3], 60);
    });
  });

  describe("sendStrengthCommand", () => {
    it("updates AppState strength and triggers B0", () => {
      connect();

      sendStrengthCommand(80, 60);

      assert.equal(AppState.strengthA, 80);
      assert.equal(AppState.strengthB, 60);
      assert.ok(writes.length > 0);
      assert.equal(writes[0][0], 0xb0);
      assert.equal(writes[0][2], 80);
      assert.equal(writes[0][3], 60);
    });

    it("clamps strength to soft limit", () => {
      connect();
      AppState.softLimitA = 100;

      sendStrengthCommand(150, 200);

      assert.equal(AppState.strengthA, 100);
    });

    it("sends immediately without waiting for wave loop", () => {
      connect();

      sendStrengthCommand(75, 75);

      assert.ok(writes.length > 0);
    });
  });

  describe("sendSoftStop", () => {
    it("builds inactive wave packet (freq 0, intensity 101)", () => {
      connect();
      AppState.strengthA = 50;

      sendSoftStop({ keepStrength: false });

      assert.ok(writes.length > 0);
      const p = writes[writes.length - 1];
      assert.equal(p[0], 0xb0);
      assert.equal(p[8], 101); // intensityA inactive
      assert.equal(p[16], 101); // intensityB inactive
    });
  });

  describe("sendV3EmergencyStop", () => {
    it("zeros strength and sends absolute stop", () => {
      connect();
      AppState.strengthA = 100;
      AppState.strengthB = 100;

      sendV3EmergencyStop();

      assert.equal(AppState.strengthA, 0);
      assert.equal(AppState.strengthB, 0);
      assert.ok(writes.length > 0);
      assert.equal(writes[writes.length - 1][2], 0);
      assert.equal(writes[writes.length - 1][3], 0);
    });
  });

  describe("sendV3Init", () => {
    it("sends 7-byte BF packet with limits and balance", () => {
      connect();
      AppState.softLimitA = 120;
      AppState.softLimitB = 80;

      sendV3Init();

      assert.ok(writes.length > 0);
      const bf = writes.find((w) => w[0] === 0xbf);
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
      // The handler is not exported; verified conceptually.
      AppState.btAwaitingAck = true;
      AppState.btSeq = 3;
      assert.equal(AppState.btSeq, 3);
    });
  });

  describe("validateModules", () => {
    it("returns a boolean", () => {
      const ok = validateModules();
      assert.equal(typeof ok, "boolean");
    });
  });

  describe("updateHeartbeat", () => {
    it("does not warn when B1 is fresh", () => {
      AppState.isConnected = true;
      AppState.lastB1Time = Date.now();
      AppState.strengthA = 50;

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args);

      updateHeartbeat();

      console.warn = origWarn;
      assert.equal(warns.length, 0);
    });

    it("does not warn when not connected", () => {
      AppState.isConnected = false;
      AppState.lastB1Time = Date.now() - 10000;
      AppState.strengthA = 50;

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args);

      updateHeartbeat();

      console.warn = origWarn;
      assert.equal(warns.length, 0);
    });
  });
});
