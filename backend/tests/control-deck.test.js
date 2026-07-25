// control-deck.test.js — the wave engine and the slider path.
//
// This is the code that decides what the device actually emits, so the tests
// focus on the invariants that keep output inside safe bounds rather than on
// the exact shape of each waveform.
import "./helpers/dom-mock.js";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AppState, CONSTANTS } from "../../frontend/js/state.js";
import {
  computeNamedPatternWave,
  updateSlidersA,
  updateSlidersB,
  setChannelFreq,
} from "../../frontend/js/control-deck.js";
import { armPanicCooldown, releasePanicCooldown } from "../../frontend/js/modules/safety-extras.js";

const ALL_PATTERNS = Object.values(CONSTANTS.PATTERNS);

/** Reset the shared singleton to a known, permissive baseline. */
function baseline() {
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.softLimitA = 150;
  AppState.softLimitB = 150;
  AppState.frequencyA = 45;
  AppState.frequencyB = 45;
  AppState.masterScale = 1;
  AppState.isConnected = false;
  AppState.activePattern = null;
  AppState.patternCeiling = null;
  releasePanicCooldown();
}

describe("computeNamedPatternWave — output bounds", () => {
  beforeEach(baseline);

  test("amplitudes stay within 0–100 for every pattern", () => {
    const violations = [];
    for (const pattern of ALL_PATTERNS) {
      for (let t = 0; t < 500; t++) {
        const { aA, aB } = computeNamedPatternWave(pattern, t);
        if (!(aA >= 0 && aA <= 100)) violations.push(`${pattern} t=${t} aA=${aA}`);
        if (!(aB >= 0 && aB <= 100)) violations.push(`${pattern} t=${t} aB=${aB}`);
      }
    }
    assert.deepEqual(violations.slice(0, 10), [], `amplitude out of range: ${violations.length}`);
  });

  test("frequencies stay within the protocol range for every pattern", () => {
    const violations = [];
    for (const pattern of ALL_PATTERNS) {
      for (let t = 0; t < 500; t++) {
        const { fA, fB } = computeNamedPatternWave(pattern, t);
        for (const [name, f] of [
          ["fA", fA],
          ["fB", fB],
        ]) {
          if (!(f >= CONSTANTS.MIN_FREQUENCY && f <= CONSTANTS.MAX_FREQUENCY)) {
            violations.push(`${pattern} t=${t} ${name}=${f}`);
          }
        }
      }
    }
    assert.deepEqual(violations.slice(0, 10), [], `frequency out of range: ${violations.length}`);
  });

  test("returns finite integers, never NaN", () => {
    for (const pattern of ALL_PATTERNS) {
      const w = computeNamedPatternWave(pattern, 7);
      for (const [k, v] of Object.entries(w)) {
        assert.ok(Number.isFinite(v), `${pattern}.${k} is not finite: ${v}`);
        assert.equal(v, Math.round(v), `${pattern}.${k} is not an integer: ${v}`);
      }
    }
  });

  test("an unknown pattern falls back to a safe mid-level wave", () => {
    const w = computeNamedPatternWave("does-not-exist", 0);
    assert.deepEqual(w, { fA: 45, aA: 60, fB: 45, aB: 60 });
  });

  test("output is deterministic for the same loop counter", () => {
    for (const pattern of ALL_PATTERNS) {
      assert.deepEqual(
        computeNamedPatternWave(pattern, 13),
        computeNamedPatternWave(pattern, 13),
        `${pattern} is not deterministic`
      );
    }
  });

  test("a missing loop counter behaves like t=0", () => {
    for (const pattern of ALL_PATTERNS) {
      assert.deepEqual(
        computeNamedPatternWave(pattern, undefined),
        computeNamedPatternWave(pattern, 0),
        pattern
      );
    }
  });

  test("strobe and flutter alternate on every step", () => {
    for (const pattern of ["strobe", "flutter"]) {
      const even = computeNamedPatternWave(pattern, 0);
      const odd = computeNamedPatternWave(pattern, 1);
      assert.ok(even.aA > 0, `${pattern} should be on at t=0`);
      assert.equal(odd.aA, 0, `${pattern} should be off at t=1`);
    }
  });
});

describe("updateSliders — soft-limit enforcement", () => {
  beforeEach(baseline);

  test("clamps channel A to its soft limit", () => {
    AppState.softLimitA = 80;
    updateSlidersA(200);
    assert.equal(AppState.strengthA, 80);
  });

  test("clamps channel B to its soft limit", () => {
    AppState.softLimitB = 60;
    updateSlidersB(999);
    assert.equal(AppState.strengthB, 60);
  });

  test("never goes negative", () => {
    updateSlidersA(-50);
    assert.equal(AppState.strengthA, 0);
    updateSlidersB(-1);
    assert.equal(AppState.strengthB, 0);
  });

  test("accepts a value below the limit unchanged", () => {
    AppState.softLimitA = 100;
    updateSlidersA(42);
    assert.equal(AppState.strengthA, 42);
  });

  test("non-numeric input does not produce NaN", () => {
    updateSlidersA("abc");
    assert.ok(Number.isFinite(AppState.strengthA), `got ${AppState.strengthA}`);
    updateSlidersB(null);
    assert.ok(Number.isFinite(AppState.strengthB), `got ${AppState.strengthB}`);
  });

  test("lowering the soft limit is respected by the next slider write", () => {
    AppState.softLimitA = 150;
    updateSlidersA(140);
    assert.equal(AppState.strengthA, 140);
    AppState.softLimitA = 50;
    updateSlidersA(140);
    assert.equal(AppState.strengthA, 50);
  });

  test("panic cooldown blocks strength changes on both channels", () => {
    updateSlidersA(50);
    updateSlidersB(50);
    armPanicCooldown();
    updateSlidersA(120);
    updateSlidersB(120);
    assert.equal(AppState.strengthA, 50, "A must not move during cooldown");
    assert.equal(AppState.strengthB, 50, "B must not move during cooldown");
    releasePanicCooldown();
  });
});

describe("setChannelFreq — protocol range", () => {
  beforeEach(baseline);

  test("clamps above the maximum", () => {
    setChannelFreq("A", 9999, "silent");
    assert.equal(AppState.frequencyA, CONSTANTS.MAX_FREQUENCY);
  });

  test("raises a positive value below the minimum up to it", () => {
    setChannelFreq("B", 3, "silent");
    assert.equal(AppState.frequencyB, CONSTANTS.MIN_FREQUENCY);
  });

  test("documents the current zero/negative handling in clampWireFreq", () => {
    // NOTE: these two disagree, and that is the shipped behaviour.
    //   0  → 45, because `Number(freq) || 45` treats 0 as falsy, which makes
    //            the `if (f <= 0) return 0` branch unreachable for 0.
    //   -5 →  0, because that branch does fire for negatives.
    // Whether "wire frequency 0" means "channel off" on the device cannot be
    // confirmed without hardware, so this test pins the status quo instead of
    // asserting an intent. See protocol-utils.js:56.
    setChannelFreq("B", 0, "silent");
    assert.equal(AppState.frequencyB, 45, "0 falls through to the default");
    setChannelFreq("B", -5, "silent");
    assert.equal(AppState.frequencyB, 0, "negatives are treated as off");
  });

  test("keeps an in-range value", () => {
    setChannelFreq("A", 120, "silent");
    assert.equal(AppState.frequencyA, 120);
  });

  test("rounds fractional input", () => {
    setChannelFreq("A", 77.6, "silent");
    assert.equal(AppState.frequencyA, 78);
  });

  test("garbage input falls back to a valid frequency", () => {
    setChannelFreq("A", "not-a-number", "silent");
    assert.ok(
      AppState.frequencyA >= CONSTANTS.MIN_FREQUENCY &&
        AppState.frequencyA <= CONSTANTS.MAX_FREQUENCY,
      `got ${AppState.frequencyA}`
    );
  });
});
