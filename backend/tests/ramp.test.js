/**
 * Tests for ramp.js — linear strength ramp engine.
 *
 * Strategy: drive startRamp, then advance fake timers manually by invoking
 * rampTick via setInterval real time at fast tick. To keep tests fast, we use
 * short durations (0.01 min = 600 ms).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import { AppState } from "../../frontend/js/state.js";
import {
  startRamp,
  stopRamp,
  isRampActive,
  getRampState,
} from "../../frontend/js/modules/ramp.js";
import { setPatternCeiling } from "../../frontend/js/modules/safety-extras.js";

// mock sendStrengthCommand by capturing AppState mutations it triggers.
// Ramp -> sendStrengthCommand requires a non-null writeChar; we mock it so the
// command actually applies to AppState.
function mockWriteChar() {
  return {
    writeValueWithoutResponse: async () => {},
    writeValue: async () => {},
  };
}

function resetState() {
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.softLimitA = 200;
  AppState.softLimitB = 200;
  AppState.isConnected = true;
  AppState.writeChar = mockWriteChar();
  AppState.panicCooldownUntil = 0;
  AppState.patternCeiling = 0;
  AppState.rampState = null;
  // btPendingMode / seq not relevant here
}

beforeEach(() => {
  resetState();
  stopRamp("test setup");
});

afterEach(() => {
  stopRamp("test teardown");
});

describe("ramp.js", () => {
  it("is inactive by default", () => {
    assert.equal(isRampActive(), false);
    assert.equal(getRampState(), null);
  });

  it("rejects invalid duration (zero)", () => {
    const r = startRamp({ targetA: 100, targetB: 100, durationMin: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /Dauer/);
  });

  it("rejects invalid duration (negative)", () => {
    const r = startRamp({ targetA: 100, targetB: 100, durationMin: -5 });
    assert.equal(r.ok, false);
  });

  it("rejects duration over 180 minutes", () => {
    const r = startRamp({ targetA: 100, targetB: 100, durationMin: 200 });
    assert.equal(r.ok, false);
  });

  it("rejects when panic cooldown active", () => {
    AppState.panicCooldownUntil = Date.now() + 60000;
    const r = startRamp({ targetA: 100, targetB: 100, durationMin: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /Cooldown/);
  });

  it("rejects when another ramp is already active", () => {
    const r1 = startRamp({ targetA: 50, targetB: 50, durationMin: 0.05 });
    assert.equal(r1.ok, true);
    const r2 = startRamp({ targetA: 100, targetB: 100, durationMin: 0.05 });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /bereits/);
  });

  it("clamps target to soft-limit + sets pattern ceiling", () => {
    AppState.softLimitA = 80;
    AppState.softLimitB = 80;
    const r = startRamp({ targetA: 200, targetB: 200, durationMin: 0.05 });
    assert.equal(r.ok, true);
    assert.equal(AppState.rampState.targetA, 80);
    assert.equal(AppState.rampState.targetB, 80);
    // ceiling = max(targetA, targetB) = 80
    assert.equal(AppState.patternCeiling, 80);
  });

  it("reaches target within ~duration", async () => {
    const r = startRamp({ targetA: 60, targetB: 60, durationMin: 0.02 }); // 1.2s
    assert.equal(r.ok, true);
    // Wait for ramp to complete (1.2s of real time, 2 ticks of 1s)
    await new Promise((resolve) => setTimeout(resolve, 3500));
    assert.equal(isRampActive(), false);
    // Final strength should be at or very near target (60)
    assert.ok(
      AppState.strengthA >= 58 && AppState.strengthA <= 60,
      `expected ~60, got ${AppState.strengthA}`
    );
  });

  it("is cancellable", async () => {
    const r = startRamp({ targetA: 100, targetB: 100, durationMin: 1 });
    assert.equal(r.ok, true);
    assert.equal(isRampActive(), true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    stopRamp("test cancel");
    assert.equal(isRampActive(), false);
    // ceiling cleared
    assert.equal(AppState.patternCeiling, 0);
  });

  it("stops on disconnect", async () => {
    AppState.isConnected = true;
    const r = startRamp({ targetA: 80, targetB: 80, durationMin: 1 });
    assert.equal(r.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    AppState.isConnected = false;
    // Wait one tick for watchdog to notice
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(isRampActive(), false);
  });

  it("getRampState returns snapshot while active", () => {
    const r = startRamp({ targetA: 50, targetB: 70, durationMin: 1 });
    assert.equal(r.ok, true);
    const snap = getRampState();
    assert.equal(snap.targetA, 50);
    assert.equal(snap.targetB, 70);
    assert.equal(snap.progress, 0);
    assert.ok(snap.totalMs > 0);
  });
});
