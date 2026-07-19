/**
 * Tests for dice.js - config persistence + random helpers + state.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  loadConfig,
  saveConfig,
  randomInRange,
  startDice,
  stopDice,
  isDiceActive,
} from "../../frontend/js/modules/dice.js";
import { AppState } from "../../frontend/js/state.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.softLimitA = 200;
  AppState.softLimitB = 200;
  AppState.writeChar = { writeValue: async () => {}, writeValueWithoutResponse: async () => {} };
  AppState.panicCooldownUntil = 0;
  AppState.patternCeiling = 0;
  stopDice("test setup");
});

afterEach(() => {
  stopDice("test teardown");
});

describe("dice.js - config", () => {
  it("returns defaults on first call", () => {
    const cfg = loadConfig();
    assert.equal(cfg.intervalMs, 5000);
    assert.equal(cfg.min, 10);
    assert.equal(cfg.max, 70);
    assert.equal(cfg.channel, "both");
  });

  it("saveConfig merges", () => {
    saveConfig({ min: 20, max: 80 });
    const cfg = loadConfig();
    assert.equal(cfg.min, 20);
    assert.equal(cfg.max, 80);
    assert.equal(cfg.intervalMs, 5000); // unchanged
  });

  it("survives corrupt localStorage", () => {
    localStorage.setItem("stim_app_dice_config_v1", "not-json");
    const cfg = loadConfig();
    assert.equal(cfg.intervalMs, 5000);
  });
});

describe("dice.js - randomInRange", () => {
  it("produces values within [min, max]", () => {
    for (let i = 0; i < 100; i++) {
      const v = randomInRange(10, 20);
      assert.ok(v >= 10 && v <= 20, `got ${v}`);
    }
  });

  it("clamps to 0..200", () => {
    const v1 = randomInRange(-100, -50);
    assert.ok(v1 >= 0 && v1 <= 200);
    const v2 = randomInRange(500, 999);
    assert.ok(v2 >= 0 && v2 <= 200);
  });

  it("returns lo when lo == hi", () => {
    assert.equal(randomInRange(50, 50), 50);
  });
});

describe("dice.js - startDice / stopDice", () => {
  it("rejects interval below 500ms", () => {
    const r = startDice({ intervalMs: 100 });
    assert.equal(r.ok, false);
    assert.match(r.error, /500/);
    assert.equal(isDiceActive(), false);
  });

  it("rejects min > max", () => {
    const r = startDice({ min: 80, max: 20 });
    assert.equal(r.ok, false);
    assert.match(r.error, /min/);
  });

  it("starts + is active", () => {
    const r = startDice({ intervalMs: 1000 });
    assert.equal(r.ok, true);
    assert.equal(isDiceActive(), true);
  });

  it("rejects double-start", () => {
    startDice({ intervalMs: 1000 });
    const r = startDice({ intervalMs: 2000 });
    assert.equal(r.ok, false);
  });

  it("stopDice clears active state", () => {
    startDice({ intervalMs: 1000 });
    stopDice("test");
    assert.equal(isDiceActive(), false);
  });

  it("stopDice is safe when never started", () => {
    stopDice("never started");
    assert.equal(isDiceActive(), false);
  });
});
