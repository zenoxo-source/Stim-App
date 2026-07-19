/**
 * Tests for music-sync.js - pure helpers: RMS, BPM, beat detection.
 *
 * getUserMedia/AudioContext aren't available in Node — those code paths are
 * exercised by the manual Electron smoke test, not here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  computeRms,
  estimateBpm,
  detectBeat,
  loadConfig,
  saveConfig,
  getCurrentBpm,
} from "../../frontend/js/modules/music-sync.js";

describe("music-sync.js - computeRms", () => {
  it("returns 0 for empty samples", () => {
    assert.equal(computeRms([]), 0);
    assert.equal(computeRms(null), 0);
  });

  it("returns 0 for flat signal at 128 (silence)", () => {
    const samples = new Array(64).fill(128);
    assert.equal(computeRms(samples), 0);
  });

  it("returns positive value for oscillating signal", () => {
    const samples = [];
    for (let i = 0; i < 64; i++) samples.push(i % 2 === 0 ? 0 : 255);
    const r = computeRms(samples);
    assert.ok(r > 0.9, `expected ~1.0, got ${r}`);
  });

  it("scales with amplitude", () => {
    const loud = [];
    const quiet = [];
    for (let i = 0; i < 64; i++) {
      loud.push(i % 2 === 0 ? 0 : 255);
      quiet.push(i % 2 === 0 ? 120 : 136);
    }
    assert.ok(computeRms(loud) > computeRms(quiet));
  });
});

describe("music-sync.js - estimateBpm", () => {
  it("returns 0 for fewer than 2 beats", () => {
    assert.equal(estimateBpm([]), 0);
    assert.equal(estimateBpm([1000]), 0);
  });

  it("returns 120 BPM for 500ms intervals", () => {
    const ts = [0, 500, 1000, 1500, 2000];
    const bpm = estimateBpm(ts);
    assert.equal(bpm, 120);
  });

  it("returns 60 BPM for 1000ms intervals", () => {
    const ts = [0, 1000, 2000, 3000];
    const bpm = estimateBpm(ts);
    assert.equal(bpm, 60);
  });

  it("folds half-time into range", () => {
    // 250ms intervals = 240 BPM raw — at edge of range
    const ts = [0, 250, 500, 750, 1000];
    const bpm = estimateBpm(ts);
    assert.ok(bpm >= 40 && bpm <= 240, `expected in [40, 240], got ${bpm}`);
  });

  it("folds double-time up", () => {
    // 3000ms intervals = 20 BPM raw → folded to 40
    const ts = [0, 3000, 6000, 9000];
    const bpm = estimateBpm(ts);
    assert.ok(bpm >= 40, `expected >= 40, got ${bpm}`);
  });

  it("filters outliers", () => {
    // Mostly 500ms but one 5000ms outlier
    const ts = [0, 500, 1000, 1500, 2000, 7000];
    const bpm = estimateBpm(ts);
    // The 5000ms interval gets filtered; should still resolve near 120
    assert.ok(bpm >= 80 && bpm <= 160, `expected ~120, got ${bpm}`);
  });
});

describe("music-sync.js - detectBeat", () => {
  it("returns false for empty history", () => {
    assert.equal(detectBeat(0.5, [], 1.4), false);
  });

  it("returns false when average is 0", () => {
    assert.equal(detectBeat(0.5, [0, 0, 0], 1.4), false);
  });

  it("returns true when rms > avg × sensitivity", () => {
    // History of quiet samples (low avg); current rms is high
    const history = [0.05, 0.05, 0.05, 0.05];
    assert.equal(detectBeat(0.2, history, 1.4), true);
  });

  it("returns false when rms below threshold", () => {
    const history = [0.1, 0.1, 0.1];
    assert.equal(detectBeat(0.12, history, 1.4), false); // 0.12 < 0.1 * 1.4 = 0.14
  });
});

describe("music-sync.js - config", () => {
  it("loads defaults", () => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    const cfg = loadConfig();
    assert.equal(cfg.sensitivity, 1.4);
    assert.equal(cfg.minBpm, 40);
    assert.equal(cfg.maxBpm, 240);
  });

  it("persists", () => {
    saveConfig({ sensitivity: 2.0 });
    assert.equal(loadConfig().sensitivity, 2.0);
  });

  it("getCurrentBpm is 0 when not running", () => {
    assert.equal(getCurrentBpm(), 0);
  });
});
