/**
 * Manual Player (XToys Coyote-block) unit tests
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/dom-mock.js";
import {
  sanitiseManualConfig,
  mapStrengthToFreq,
  mapFreqFromStrengths,
  isManualFreqFollowOn,
  formatStrengthDisplay,
  MANUAL_PATTERN_INFO,
  MANUAL_DEFAULTS,
} from "../../frontend/js/modules/manual-player.js";
import { AppState } from "../../frontend/js/state.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  AppState.softLimitA = 100;
  AppState.softLimitB = 100;
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.frequencyA = 45;
  AppState.frequencyB = 45;
});

describe("manual-player", () => {
  it("sanitise swaps inverted freq range", () => {
    const c = sanitiseManualConfig({ freqMin: 120, freqMax: 40, freqMode: "with_intensity" });
    assert.equal(c.freqMin, 40);
    assert.equal(c.freqMax, 120);
    assert.equal(c.freqMode, "with_intensity");
  });

  it("mapStrengthToFreq scales with soft limit", () => {
    const cfg = { ...MANUAL_DEFAULTS, freqMode: "with_intensity", freqMin: 30, freqMax: 90 };
    assert.equal(mapStrengthToFreq(0, 100, cfg), 30);
    assert.equal(mapStrengthToFreq(100, 100, cfg), 90);
    assert.equal(mapStrengthToFreq(50, 100, cfg), 60);
  });

  it("inverse intensity flips mapping", () => {
    const cfg = { ...MANUAL_DEFAULTS, freqMode: "inverse_intensity", freqMin: 20, freqMax: 80 };
    assert.equal(mapStrengthToFreq(0, 100, cfg), 80);
    assert.equal(mapStrengthToFreq(100, 100, cfg), 20);
  });

  it("isManualFreqFollowOn", () => {
    assert.equal(isManualFreqFollowOn({ freqMode: "fixed" }), false);
    assert.equal(isManualFreqFollowOn({ freqMode: "with_intensity" }), true);
  });

  it("formatStrengthDisplay percent", () => {
    assert.equal(formatStrengthDisplay(50, 100, true), "50%");
    assert.equal(formatStrengthDisplay(50, 100, false), "50");
  });

  it("pattern catalog covers core patterns", () => {
    assert.ok(MANUAL_PATTERN_INFO.gentle.desc.length > 10);
    assert.ok(MANUAL_PATTERN_INFO.climax.name);
    assert.ok(MANUAL_PATTERN_INFO.breath.name, "breath pattern in catalog");
    assert.ok(MANUAL_PATTERN_INFO.triphase.name, "triphase pattern in catalog");
    assert.ok(Object.keys(MANUAL_PATTERN_INFO).length >= 14);
  });

  it("mapFreqFromStrengths uses both channels", () => {
    AppState.softLimitA = 100;
    AppState.softLimitB = 200;
    const cfg = { ...MANUAL_DEFAULTS, freqMode: "with_intensity", freqMin: 10, freqMax: 110 };
    const m = mapFreqFromStrengths(100, 100, cfg);
    assert.equal(m.fA, 110);
    // B at 100/200 = 50% → mid of range
    assert.equal(m.fB, 60);
  });
});
