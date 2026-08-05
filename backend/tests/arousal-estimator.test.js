// arousal-estimator.test.js — pure-fusion unit tests for the v6.3 estimator.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseHrDelta,
  normaliseMotion,
  normaliseBreathRate,
  heldBreathScore,
  fuseArousal,
  arousalControllerStep,
  AROUSAL_WEIGHTS,
} from "../../frontend/js/lib/arousal-estimator.js";

describe("arousal-estimator — normalisers", () => {
  it("normaliseHrDelta saturates around +25 bpm", () => {
    assert.equal(normaliseHrDelta(0), 0);
    assert.ok(normaliseHrDelta(25) > 0.99);
    assert.equal(normaliseHrDelta(40), 1);
    assert.equal(normaliseHrDelta(-5), 0); // clamped, not negative
    assert.equal(normaliseHrDelta(NaN), 0);
    assert.equal(normaliseHrDelta(undefined), 0);
  });

  it("normaliseMotion emphasises the meaningful range", () => {
    assert.equal(normaliseMotion(0), 0);
    assert.ok(normaliseMotion(0.12) > 0.9);
    assert.equal(normaliseMotion(1), 1);
    assert.equal(normaliseMotion(-1), 0);
  });

  it("normaliseBreathRate maps resting→low, fast→high", () => {
    assert.ok(normaliseBreathRate(12) < 0.4);
    assert.ok(normaliseBreathRate(24) > 0.85);
    assert.equal(normaliseBreathRate(0), 0);
    assert.equal(normaliseBreathRate(undefined), 0);
  });

  it("heldBreathScore ignores brief pauses, saturates ~4s", () => {
    assert.equal(heldBreathScore(0), 0);
    assert.equal(heldBreathScore(1000), 0); // below noise floor
    assert.ok(heldBreathScore(1500) > 0);
    assert.ok(heldBreathScore(4000) > 0.9);
    assert.equal(heldBreathScore(8000), 1);
  });
});

describe("arousal-estimator — fusion", () => {
  it("returns 0 arousal / 0 confidence with no signals", () => {
    const r = fuseArousal({});
    assert.equal(r.arousal, 0);
    assert.equal(r.confidence, 0);
  });

  it("single signal drives arousal + partial confidence", () => {
    const r = fuseArousal({ hrDelta: 20 });
    assert.ok(r.arousal > 0.6, `hr alone should be arousing: ${r.arousal}`);
    assert.ok(r.confidence > 0.2 && r.confidence < 0.3);
  });

  it("more signals → higher confidence", () => {
    const one = fuseArousal({ hrDelta: 15 });
    const many = fuseArousal({ hrDelta: 15, motion: 0.1, edgeScore: 70, breathRate: 18 });
    assert.ok(many.confidence > one.confidence);
  });

  it("fuses all channels and stays in 0..1", () => {
    const r = fuseArousal({ hrDelta: 22, motion: 0.11, breathRate: 22, edgeScore: 85 });
    assert.ok(r.arousal > 0.7 && r.arousal <= 1);
    assert.ok(r.confidence > 0.7);
  });

  it("sustained held breath forces a high arousal floor", () => {
    // Even with weak other signals, a long held breath is a pre-orgasm marker.
    const r = fuseArousal({ breathHeldMs: 4000, hrDelta: 5, motion: 0.02 });
    assert.ok(r.arousal >= 0.85, `held breath should floor high: ${r.arousal}`);
  });

  it("brief held breath (<1.2s) does NOT trigger the floor", () => {
    const r = fuseArousal({ breathHeldMs: 800, hrDelta: 2 });
    assert.ok(r.arousal < 0.5);
  });

  it("recentAlmost adds a small nudge", () => {
    const base = fuseArousal({ hrDelta: 10 });
    const nudged = fuseArousal({ hrDelta: 10, recentAlmost: 3 });
    assert.ok(nudged.arousal > base.arousal);
  });

  it("components echo per-channel normalised values", () => {
    const r = fuseArousal({ hrDelta: 12, motion: 0.06 });
    assert.equal(typeof r.components.hr, "number");
    assert.equal(typeof r.components.motion, "number");
    assert.equal(r.components.breathHeld, null);
  });
});

describe("arousal-estimator — controller", () => {
  it("under-aroused → increases intensity", () => {
    const r = arousalControllerStep({ arousal: 0.4, setpoint: 0.8, prevRel: 0.5, confidence: 1 });
    assert.ok(r.relStrength > 0.5);
    assert.equal(r.mode, "track");
  });

  it("over-aroused → backs off faster (asymmetric)", () => {
    const climb = arousalControllerStep({ arousal: 0.7, setpoint: 0.75, prevRel: 0.6, confidence: 1 });
    const drop = arousalControllerStep({ arousal: 0.8, setpoint: 0.75, prevRel: 0.6, confidence: 1 });
    // same |error| magnitude, but the back-off step must be larger
    const climbStep = Math.abs(climb.relStrength - 0.6);
    const dropStep = Math.abs(drop.relStrength - 0.6);
    assert.ok(dropStep >= climbStep, "back-off should be at least as strong as climb");
  });

  it("low confidence → gentle open-loop fallback climb", () => {
    const r = arousalControllerStep({ arousal: 0.5, setpoint: 0.9, prevRel: 0.5, confidence: 0.1 });
    assert.equal(r.mode, "fallback");
    assert.ok(r.relStrength > 0.5);
    // fallback must be a tiny step (not a big controller swing)
    assert.ok(r.relStrength - 0.5 < 0.05);
  });

  it("clamps to 0..1", () => {
    const hi = arousalControllerStep({ arousal: 0, setpoint: 1, prevRel: 0.99, confidence: 1 });
    assert.ok(hi.relStrength <= 1);
    const lo = arousalControllerStep({ arousal: 1, setpoint: 0, prevRel: 0.01, confidence: 1 });
    assert.ok(lo.relStrength >= 0);
  });
});

describe("arousal-estimator — weights sanity", () => {
  it("weights sum to 1", () => {
    const sum = Object.values(AROUSAL_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);
  });
});
