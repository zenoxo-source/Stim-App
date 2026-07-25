// autodrive.test.js — the module layer around the autodrive engine.
//
// The engine's maths lives in lib/autodrive-engine.js and is covered by
// autodrive-engine.test.js. What is exercised here is the part that owns real
// output: the start guards, the lifecycle, and config persistence.
import "./helpers/dom-mock.js";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AppState } from "../../frontend/js/state.js";
import {
  loadAutodriveConfig,
  saveAutodriveConfig,
  isAutodriveActive,
  getAutodriveState,
  startAutodrive,
  stopAutodrive,
  pauseAutodrive,
  resumeAutodrive,
  injectFeedback,
  clearAutodriveAppliedMarkers,
} from "../../frontend/js/modules/autodrive.js";
import { armPanicCooldown, releasePanicCooldown } from "../../frontend/js/modules/safety-extras.js";

function baseline() {
  AppState.isConnected = false;
  AppState.softLimitA = 150;
  AppState.softLimitB = 150;
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.activePattern = null;
  AppState.patternCeiling = null;
  releasePanicCooldown();
  stopAutodrive("test-teardown");
}

describe("autodrive — config persistence", () => {
  beforeEach(baseline);

  test("returns defaults when nothing is stored", () => {
    localStorage.removeItem("stim_autodrive_cfg");
    const cfg = loadAutodriveConfig();
    assert.equal(typeof cfg, "object");
    assert.ok(cfg.goal, "a goal is always present");
  });

  test("survives corrupt JSON in localStorage", () => {
    localStorage.setItem("stim_autodrive_cfg", "{not valid json");
    const cfg = loadAutodriveConfig();
    assert.equal(typeof cfg, "object");
    assert.ok(cfg.goal);
  });

  test("save merges a patch and round-trips", () => {
    const saved = saveAutodriveConfig({ goal: "edge_ladder" });
    assert.equal(saved.goal, "edge_ladder");
    assert.equal(loadAutodriveConfig().goal, "edge_ladder");
  });

  test("rejects an invalid goal instead of storing it", () => {
    const saved = saveAutodriveConfig({ goal: "not-a-real-goal" });
    assert.notEqual(saved.goal, "not-a-real-goal");
  });
});

describe("autodrive — start guards", () => {
  beforeEach(baseline);
  afterEach(baseline);

  test("refuses to start while disconnected", () => {
    AppState.isConnected = false;
    const res = startAutodrive();
    assert.equal(res.ok, false);
    assert.match(res.error, /verbunden/i);
    assert.equal(isAutodriveActive(), false);
  });

  test("refuses to start during panic cooldown", () => {
    AppState.isConnected = true;
    armPanicCooldown();
    const res = startAutodrive();
    assert.equal(res.ok, false);
    assert.match(res.error, /cooldown/i);
    releasePanicCooldown();
  });

  test("refuses to start when a soft limit is below 20", () => {
    AppState.isConnected = true;
    AppState.softLimitA = 10;
    const res = startAutodrive();
    assert.equal(res.ok, false);
    assert.match(res.error, /Soft-Limits/i);
    assert.equal(isAutodriveActive(), false);
  });

  test("checks both channels for the minimum soft limit", () => {
    AppState.isConnected = true;
    AppState.softLimitA = 150;
    AppState.softLimitB = 5;
    const res = startAutodrive();
    assert.equal(res.ok, false);
    assert.match(res.error, /Soft-Limits/i);
  });
});

describe("autodrive — lifecycle", () => {
  beforeEach(baseline);
  afterEach(baseline);

  test("is idle before any start", () => {
    assert.equal(isAutodriveActive(), false);
    const state = getAutodriveState();
    assert.equal(state.phase, "IDLE");
    assert.equal(state.progress, 0);
  });

  test("getAutodriveState always reports a usable shape", () => {
    const state = getAutodriveState();
    for (const key of ["phase", "phaseLabel", "progress", "config", "learning"]) {
      assert.ok(key in state, `state.${key} missing`);
    }
  });

  test("start → active → stop → idle", () => {
    AppState.isConnected = true;
    const res = startAutodrive();
    assert.equal(res.ok, true, res.error);
    assert.equal(isAutodriveActive(), true);
    assert.equal(AppState.activePattern, "autodrive");

    stopAutodrive("test");
    assert.equal(isAutodriveActive(), false);
  });

  test("starting twice is refused", () => {
    AppState.isConnected = true;
    assert.equal(startAutodrive().ok, true);
    const second = startAutodrive();
    assert.equal(second.ok, false);
    assert.match(second.error, /läuft bereits/i);
  });

  test("a running session sets a pattern ceiling below the soft limit", () => {
    AppState.isConnected = true;
    AppState.softLimitA = 100;
    AppState.softLimitB = 100;
    startAutodrive();
    assert.ok(AppState.patternCeiling > 0, "ceiling must be set");
    assert.ok(
      AppState.patternCeiling <= 100,
      `ceiling ${AppState.patternCeiling} must not exceed the soft limit`
    );
  });

  test("stop clears the active pattern", () => {
    AppState.isConnected = true;
    startAutodrive();
    stopAutodrive("test");
    assert.notEqual(AppState.activePattern, "autodrive");
  });

  test("pause and resume do not throw when idle", () => {
    assert.doesNotThrow(() => pauseAutodrive());
    assert.doesNotThrow(() => resumeAutodrive());
  });

  test("stopping when never started is harmless", () => {
    assert.doesNotThrow(() => stopAutodrive("never-started"));
    assert.equal(isAutodriveActive(), false);
  });

  test("clearAutodriveAppliedMarkers resets the applied cache", () => {
    AppState._autodriveLastAppliedA = 42;
    AppState._autodriveLastAppliedB = 43;
    clearAutodriveAppliedMarkers();
    assert.equal(AppState._autodriveLastAppliedA, null);
    assert.equal(AppState._autodriveLastAppliedB, null);
  });
});

describe("autodrive — feedback", () => {
  beforeEach(baseline);
  afterEach(baseline);

  test("feedback while idle does not throw", () => {
    assert.doesNotThrow(() => injectFeedback("too_weak"));
  });

  test("accepts the documented feedback vocabulary while running", () => {
    AppState.isConnected = true;
    startAutodrive();
    for (const fb of ["too_weak", "good", "too_strong", "almost", "not_yet"]) {
      assert.doesNotThrow(() => injectFeedback(fb), fb);
    }
  });

  test("an unknown feedback token does not throw", () => {
    AppState.isConnected = true;
    startAutodrive();
    assert.doesNotThrow(() => injectFeedback("banana"));
  });
});
