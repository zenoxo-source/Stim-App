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
  processB1Notification,
  deviceToLogicalStrength,
  logicalToDeviceStrength,
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
  AppState._lastStrengthSeq = 0;
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
  AppState.outputOwner = "none";
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

    it("swapChannels swaps both strength and wave", () => {
      connect();
      AppState.swapChannels = true;
      AppState.strengthA = 80;
      AppState.strengthB = 20;
      AppState.btPendingMode = 0x0f;

      sendB0Now(30, 100, 90, 50);

      const p = writes[writes.length - 1];
      // Physical A gets logical B strength/wave
      assert.equal(p[2], 20);
      assert.equal(p[3], 80);
      assert.equal(p[4], 90); // freq physical A = logical B
      assert.equal(p[12], 30); // freq physical B = logical A
      assert.equal(p[8], 50); // amp physical A
      assert.equal(p[16], 100); // amp physical B
    });

    it("applies masterScale to strength wire values", () => {
      connect();
      AppState.masterScale = 0.5;
      AppState.strengthA = 100;
      AppState.strengthB = 80;
      AppState.btPendingMode = 0x0f;

      sendB0Now(45, 100, 45, 100);

      const p = writes[writes.length - 1];
      assert.equal(p[2], 50);
      assert.equal(p[3], 40);
    });

    it("stores lastWave as logical inputs (no double scale on re-send)", () => {
      connect();
      AppState.masterScale = 0.5;
      AppState.pulseWidthA = 100;
      AppState.strengthA = 10;

      sendB0Now(45, 80, 60, 40);

      assert.equal(AppState.lastWaveFreqA, 45);
      assert.equal(AppState.lastWaveAmpA, 80);
      assert.equal(AppState.lastWaveFreqB, 60);
      assert.equal(AppState.lastWaveAmpB, 40);
      // Wire amp is scaled
      const p = writes[writes.length - 1];
      assert.equal(p[8], 40); // 80 * 0.5
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
      assert.equal(p[2], 0);
      assert.equal(p[3], 0);
      assert.equal(p[1] & 0x0f, 0x0f);
    });

    it("keepStrength leaves wire strength and mode 0", () => {
      connect();
      AppState.strengthA = 40;
      AppState.strengthB = 30;
      AppState.masterScale = 1;

      sendSoftStop({ keepStrength: true });

      const p = writes[writes.length - 1];
      assert.equal(p[2], 40);
      assert.equal(p[3], 30);
      assert.equal(p[1] & 0x0f, 0);
      assert.equal(p[8], 101);
    });

    it("swapChannels applies to soft-stop strength bytes", () => {
      connect();
      AppState.swapChannels = true;
      AppState.strengthA = 40;
      AppState.strengthB = 10;

      sendSoftStop({ keepStrength: true });

      const p = writes[writes.length - 1];
      assert.equal(p[2], 10);
      assert.equal(p[3], 40);
    });

    it("updates dirty tracking so next B0 is not skipped incorrectly", async () => {
      connect();
      AppState.strengthA = 0;
      sendSoftStop({ keepStrength: false });
      // Flush BLE queue microtasks from soft-stop
      await Promise.resolve();
      await Promise.resolve();
      const n = writes.length;
      sendB0Now(45, 100, 45, 100);
      await Promise.resolve();
      await Promise.resolve();
      assert.ok(writes.length > n, "wave after soft-stop must send");
      const p = writes[writes.length - 1];
      assert.equal(p[8], 100);
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

  describe("processB1Notification", () => {
    it("clears awaitingAck on matching sequence without changing logical strength", () => {
      connect();
      AppState.masterScale = 0.5;
      AppState.strengthA = 100;
      AppState.strengthB = 80;
      AppState.btAwaitingAck = true;
      AppState.btSeq = 3;
      AppState._lastStrengthSeq = 3;

      // Device reports scaled wire values
      processB1Notification(new Uint8Array([0xb1, 3, 50, 40]));

      assert.equal(AppState.btAwaitingAck, false);
      assert.equal(AppState.btSeq, 0);
      assert.equal(AppState.strengthA, 100, "logical strength must stay");
      assert.equal(AppState.strengthB, 80);
    });

    it("late ACK after timeout does not treat our echo as wheel event", () => {
      connect();
      AppState.masterScale = 0.5;
      AppState.strengthA = 100;
      AppState.strengthB = 100;
      AppState.btAwaitingAck = false;
      AppState.btSeq = 0;
      AppState._lastStrengthSeq = 5;

      processB1Notification(new Uint8Array([0xb1, 5, 50, 50]));

      assert.equal(AppState.strengthA, 100);
      assert.equal(AppState.strengthB, 100);
    });

    it("ignores B1 when wire strength already matches scaled logical", () => {
      connect();
      AppState.masterScale = 0.5;
      AppState.strengthA = 100;
      AppState.strengthB = 60;

      processB1Notification(new Uint8Array([0xb1, 0, 50, 30]));

      assert.equal(AppState.strengthA, 100);
      assert.equal(AppState.strengthB, 60);
    });

    it("maps external wheel change through inverse masterScale", () => {
      connect();
      AppState.masterScale = 0.5;
      AppState.softLimitA = 150;
      AppState.softLimitB = 150;
      AppState.strengthA = 40;
      AppState.strengthB = 40;

      // Wheel sets physical to 80/60 → logical 160/120 but soft-capped to 150
      processB1Notification(new Uint8Array([0xb1, 0, 80, 60]));

      assert.equal(AppState.strengthA, 150);
      assert.equal(AppState.strengthB, 120);
    });

    it("swapChannels maps physical B1 channels back to logical UI", () => {
      connect();
      AppState.swapChannels = true;
      AppState.masterScale = 1;
      AppState.strengthA = 10;
      AppState.strengthB = 10;

      // Physical A=70 B=20 → with swap, logical A=20 B=70
      processB1Notification(new Uint8Array([0xb1, 0, 70, 20]));

      assert.equal(AppState.strengthA, 20);
      assert.equal(AppState.strengthB, 70);
    });
  });

  describe("deviceToLogicalStrength / logicalToDeviceStrength", () => {
    it("round-trips with masterScale", () => {
      AppState.masterScale = 0.5;
      AppState.softLimitA = 200;
      const wire = logicalToDeviceStrength(100, "A");
      assert.equal(wire, 50);
      assert.equal(deviceToLogicalStrength(wire, "A"), 100);
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
