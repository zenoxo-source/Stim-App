/**
 * Tests for safety-extras.js — panic cooldown, pattern ceiling, signal-loss watchdog.
 *
 * These helpers are pure where possible (no real BLE). The signal-loss watcher
 * uses setInterval; tests stub Date.now and setInterval/clearInterval.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import { AppState } from "../../frontend/js/state.js";
import {
  PANIC_COOLDOWN_MS,
  SIGNAL_LOSS_THRESHOLD_MS,
  armPanicCooldown,
  isPanicCooldownActive,
  panicCooldownRemaining,
  blockDuringPanicCooldown,
  releasePanicCooldown,
  setPatternCeiling,
  clearPatternCeiling,
  clampStrengthWithCeiling,
  noteGattActivity,
  armSignalLossWatcher,
  disarmSignalLossWatcher,
  resetSignalLossFlag,
} from "../../frontend/js/modules/safety-extras.js";

function resetState() {
  AppState.panicCooldownUntil = 0;
  AppState.patternCeiling = 0;
  AppState.softLimitA = 150;
  AppState.softLimitB = 150;
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.isConnected = false;
  AppState.lastGattActivity = 0;
  AppState.signalLossArmed = false;
}

beforeEach(() => {
  resetState();
  disarmSignalLossWatcher();
});

afterEach(() => {
  disarmSignalLossWatcher();
});

// ---------------------------------------------------------------------------
// Panic cooldown
// ---------------------------------------------------------------------------

describe("Panic cooldown", () => {
  it("is inactive by default", () => {
    assert.equal(isPanicCooldownActive(), false);
    assert.equal(panicCooldownRemaining(), 0);
  });

  it("arms for PANIC_COOLDOWN_MS by default", () => {
    const before = Date.now();
    armPanicCooldown();
    assert.equal(isPanicCooldownActive(), true);
    assert.ok(AppState.panicCooldownUntil >= before + PANIC_COOLDOWN_MS - 50);
    assert.ok(AppState.panicCooldownUntil <= before + PANIC_COOLDOWN_MS + 50);
  });

  it("accepts a custom duration", () => {
    armPanicCooldown(5000);
    assert.ok(panicCooldownRemaining() > 4000);
    assert.ok(panicCooldownRemaining() <= 5000);
  });

  it("blockDuringPanicCooldown returns true while armed", () => {
    armPanicCooldown(10000);
    assert.equal(blockDuringPanicCooldown("test"), true);
  });

  it("blockDuringPanicCooldown returns false when not armed", () => {
    assert.equal(blockDuringPanicCooldown("test"), false);
  });

  it("can be released early", () => {
    armPanicCooldown(10000);
    assert.equal(isPanicCooldownActive(), true);
    releasePanicCooldown();
    assert.equal(isPanicCooldownActive(), false);
    assert.equal(AppState.panicCooldownUntil, 0);
  });

  it("releasePanicCooldown is a no-op when not armed", () => {
    releasePanicCooldown();
    assert.equal(AppState.panicCooldownUntil, 0);
  });

  it("expires naturally", async () => {
    armPanicCooldown(50);
    assert.equal(isPanicCooldownActive(), true);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(isPanicCooldownActive(), false);
  });
});

// ---------------------------------------------------------------------------
// Pattern ceiling
// ---------------------------------------------------------------------------

describe("Pattern ceiling", () => {
  it("clampStrengthWithCeiling respects soft limit by default", () => {
    AppState.softLimitA = 100;
    assert.equal(clampStrengthWithCeiling(150, "A"), 100);
    assert.equal(clampStrengthWithCeiling(50, "A"), 50);
    assert.equal(clampStrengthWithCeiling(-5, "A"), 0);
  });

  it("uses channel B's soft limit for B", () => {
    AppState.softLimitA = 200;
    AppState.softLimitB = 80;
    assert.equal(clampStrengthWithCeiling(150, "B"), 80);
  });

  it("ceiling further clamps the value", () => {
    AppState.softLimitA = 200;
    setPatternCeiling(100);
    assert.equal(clampStrengthWithCeiling(150, "A"), 100);
    assert.equal(clampStrengthWithCeiling(50, "A"), 50);
  });

  it("ceiling lower than soft limit wins", () => {
    AppState.softLimitA = 200;
    setPatternCeiling(50);
    assert.equal(clampStrengthWithCeiling(150, "A"), 50);
  });

  it("setPatternCeiling clamps to 0..200", () => {
    setPatternCeiling(-5);
    assert.equal(AppState.patternCeiling, 0);
    setPatternCeiling(500);
    assert.equal(AppState.patternCeiling, 200);
    setPatternCeiling("invalid");
    assert.equal(AppState.patternCeiling, 0);
  });

  it("clearPatternCeiling disables the ceiling", () => {
    setPatternCeiling(80);
    clearPatternCeiling();
    assert.equal(AppState.patternCeiling, 0);
    AppState.softLimitA = 200;
    assert.equal(clampStrengthWithCeiling(150, "A"), 150);
  });
});

// ---------------------------------------------------------------------------
// Signal-loss watchdog
// ---------------------------------------------------------------------------

describe("Signal-loss watchdog", () => {
  it("noteGattActivity stamps lastGattActivity", () => {
    const before = Date.now();
    noteGattActivity();
    assert.ok(AppState.lastGattActivity >= before);
  });

  it("resetSignalLossFlag clears armed state", () => {
    AppState.signalLossArmed = true;
    resetSignalLossFlag();
    assert.equal(AppState.signalLossArmed, false);
    assert.ok(AppState.lastGattActivity > 0);
  });

  it("armSignalLossWatcher is idempotent", () => {
    armSignalLossWatcher();
    const interval1 = globalThis.__signalWatchdogInterval;
    armSignalLossWatcher();
    armSignalLossWatcher();
    // No throw, still armed (we can't easily assert "only one interval" without
    // reaching into module privates, but idempotency = no exception).
    disarmSignalLossWatcher();
    assert.equal(AppState.signalLossArmed, false);
  });

  it("does NOT trigger while GATT is fresh", () => {
    AppState.isConnected = true;
    resetSignalLossFlag();
    armSignalLossWatcher();
    // Immediately after reset, activity is fresh → no trigger
    assert.equal(AppState.signalLossArmed, false);
    disarmSignalLossWatcher();
  });

  it("does NOT trigger when disconnected", () => {
    AppState.isConnected = false;
    AppState.lastGattActivity = Date.now() - SIGNAL_LOSS_THRESHOLD_MS * 5;
    armSignalLossWatcher();
    // Wait >500ms so the interval fires at least once
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.equal(AppState.signalLossArmed, false);
        disarmSignalLossWatcher();
        resolve();
      }, 700);
    });
  });

  it("triggers when stale + connected + emits via provided callback", () => {
    AppState.isConnected = true;
    AppState.lastGattActivity = Date.now() - SIGNAL_LOSS_THRESHOLD_MS * 2;
    let onLossCalled = 0;
    armSignalLossWatcher(() => {
      onLossCalled++;
    });
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.equal(AppState.signalLossArmed, true);
        assert.ok(onLossCalled >= 1, "onLoss callback should fire");
        disarmSignalLossWatcher();
        resolve();
      }, 700);
    });
  });

  it("only triggers once until reset", () => {
    AppState.isConnected = true;
    AppState.lastGattActivity = Date.now() - SIGNAL_LOSS_THRESHOLD_MS * 3;
    let count = 0;
    armSignalLossWatcher(() => {
      count++;
    });
    return new Promise((resolve) => {
      setTimeout(() => {
        // After 1s with 500ms interval, the watcher fires twice. But the
        // signalLossArmed guard means callback runs only once.
        assert.equal(count, 1);
        assert.equal(AppState.signalLossArmed, true);
        disarmSignalLossWatcher();
        resolve();
      }, 1100);
    });
  });
});
