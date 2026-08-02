// wire-shaping.test.js â€” pure "GefÃ¼hl"-engine helpers (v5.1).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PULSE_SHAPES,
  pulseStep,
  applyDither,
  lcg,
  detuneFreqs,
  blendStep,
  easeInOut,
  CLIMAX_CURVES,
  climaxCurveStep,
  BEAT_PATTERNS,
  beatStep,
  bpmFromTaps,
  pitchFromBuffer,
  melodyToWireFreq,
  sanitiseWireShaping,
  DEFAULT_WIRE_SHAPING,
} from "../../frontend/js/lib/wire-shaping.js";

describe("wire-shaping.js - pulse shapes", () => {
  test("hard shape starts at zero, peaks, then decays", () => {
    const shape = PULSE_SHAPES.hard;
    const attackEnd = shape.cycleMs * shape.attack;
    const plateauEnd = attackEnd + shape.cycleMs * shape.plateau;
    const nearStart = pulseStep(shape, 1, 100);
    const atPeak = pulseStep(shape, Math.round(attackEnd + 5), 100);
    const inDecay = pulseStep(shape, Math.round(plateauEnd + shape.cycleMs * 0.4), 100);
    assert.ok(nearStart < 15, `attack start should be small, got ${nearStart}`);
    assert.ok(atPeak >= 95, `peak should be ~100, got ${atPeak}`);
    assert.ok(inDecay < atPeak, "decay should lower amplitude");
    assert.ok(inDecay >= shape.minMult * 100 * 0.5, "decay should not fall below floor");
  });

  test("shape is cyclic and bounded 0..100", () => {
    const shape = PULSE_SHAPES.soft;
    for (let t = 0; t < shape.cycleMs * 3; t += 37) {
      const v = pulseStep(shape, t, 100);
      assert.ok(v >= 0 && v <= 100, `out of range at t=${t}: ${v}`);
    }
  });

  test("none passes through", () => {
    assert.equal(pulseStep(PULSE_SHAPES.none, 123, 42), 42);
  });
});

describe("wire-shaping.js - dithering", () => {
  test("bounded by the configured amount", () => {
    for (let i = 0; i < 200; i++) {
      const v = applyDither(50, 1, i * 7919);
      assert.ok(v >= 48 && v <= 52, `dither out of bounds: ${v}`);
    }
  });

  test("deterministic for the same seed", () => {
    assert.equal(applyDither(50, 1, 12345), applyDither(50, 1, 12345));
    assert.equal(lcg(42)(), lcg(42)());
  });

  test("zero amount is identity", () => {
    assert.equal(applyDither(50, 0, 5), 50);
  });
});

describe("wire-shaping.js - detune", () => {
  test("B runs at A + detune", () => {
    const d = detuneFreqs(45, 45, 3);
    assert.equal(d.fA, 45);
    assert.equal(d.fB, 48);
  });

  test("clamped to wire range", () => {
    const d = detuneFreqs(238, 238, 12);
    assert.ok(d.fB <= 240);
    assert.ok(d.fB >= d.fA);
  });

  test("zero detune is identity", () => {
    const d = detuneFreqs(45, 60, 0);
    assert.equal(d.fA, 45);
    assert.equal(d.fB, 60);
  });
});

describe("wire-shaping.js - crossfade", () => {
  test("blendStep interpolates fields and is eased", () => {
    const from = { fA: 40, aA: 0, fB: 40, aB: 0 };
    const to = { fA: 80, aA: 100, fB: 80, aB: 100 };
    const mid = blendStep(from, to, 0.5);
    assert.equal(mid.fA, 60);
    assert.equal(mid.aA, 50);
    // ease-in-out: 0.5 stays 0.5, but 0.25 is less than linear
    assert.ok(blendStep(from, to, 0.25).aA < 25);
    assert.equal(blendStep(from, to, 0).aA, 0);
    assert.equal(blendStep(from, to, 1).aA, 100);
  });

  test("easeInOut monotonic", () => {
    let prev = 0;
    for (let i = 0; i <= 10; i++) {
      const e = easeInOut(i / 10);
      assert.ok(e >= prev - 1e-9);
      prev = e;
    }
    assert.equal(easeInOut(0), 0);
    assert.equal(easeInOut(1), 1);
  });
});

describe("wire-shaping.js - climax curves", () => {
  test("frequency ramps up over time", () => {
    for (const key of ["kurz", "standard", "verzoegert"]) {
      const curve = CLIMAX_CURVES[key];
      const start = climaxCurveStep(curve, 0);
      const mid = climaxCurveStep(curve, curve.durMs / 2);
      const end = climaxCurveStep(curve, curve.durMs);
      assert.ok(start.f <= mid.f, `${key}: ramp up`);
      assert.ok(mid.f <= end.f, `${key}: keeps ramping`);
      assert.equal(end.f, curve.fEnd);
    }
  });

  test("amplitude staircase steps up and dips at each step start", () => {
    const curve = CLIMAX_CURVES.standard;
    const stepStart = climaxCurveStep(curve, curve.stepMs); // exactly at next step â†’ dip
    const stepMid = climaxCurveStep(curve, curve.stepMs + curve.dipMs + 1);
    assert.ok(stepMid.amp > stepStart.amp, "dip at step start, rise after");
    assert.ok(stepMid.amp <= 1);
    assert.ok(climaxCurveStep(curve, 0).amp >= curve.baseAmp * 0.9);
  });

  test("plateau after duration", () => {
    const curve = CLIMAX_CURVES.kurz;
    const a = climaxCurveStep(curve, curve.durMs + 30000);
    const b = climaxCurveStep(curve, curve.durMs + 60000);
    assert.equal(a.f, b.f);
    assert.equal(a.amp, b.amp);
  });
});

describe("wire-shaping.js - beat sequences", () => {
  test("cycles by bpm", () => {
    const bpm = 120;
    const pattern = BEAT_PATTERNS.throb;
    const stepMs = 60000 / bpm / pattern.steps;
    const onBeat = beatStep("throb", bpm, 0, 100);
    const offBeat = beatStep("throb", bpm, stepMs, 100);
    assert.equal(onBeat.aA, 100);
    assert.equal(offBeat.aA, 0);
    // Same phase next bar repeats
    const nextBar = beatStep("throb", bpm, stepMs * pattern.seq.length, 100);
    assert.equal(nextBar.aA, onBeat.aA);
  });

  test("bounded and scaled by baseAmp", () => {
    for (let t = 0; t < 20000; t += 13) {
      const s = beatStep("staircase", 90, t, 70);
      assert.ok(s.aA >= 0 && s.aA <= 70);
      assert.ok(s.aB >= 0 && s.aB <= 70);
    }
  });

  test("bpmFromTaps averages intervals", () => {
    const taps = [0, 500, 1000, 1500];
    assert.equal(bpmFromTaps(taps), 120);
    assert.equal(bpmFromTaps([0]), null);
    assert.equal(bpmFromTaps([0, 100]), null); // too fast â†’ ignored
  });
});

describe("wire-shaping.js - pitch tracking", () => {
  function makeSine(freq, sampleRate, n, amp = 90) {
    const buf = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      buf[i] = 128 + Math.round(amp * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    }
    return buf;
  }

  test("detects a pure sine", () => {
    const sampleRate = 44100;
    for (const f of [110, 220, 330, 440]) {
      const p = pitchFromBuffer(makeSine(f, sampleRate, 1024), sampleRate);
      assert.ok(p != null, `pitch for ${f} Hz`);
      assert.ok(Math.abs(p - f) < f * 0.06, `pitch ${p} â‰ˆ ${f}`);
    }
  });

  test("returns null for silence", () => {
    const silent = new Uint8Array(1024).fill(128);
    assert.equal(pitchFromBuffer(silent, 44100), null);
  });

  test("melodyToWireFreq maps pitch to wire range", () => {
    const cfg = { freqFixed: 45 };
    assert.equal(melodyToWireFreq(30, cfg), cfg.freqFixed); // below range → fixed
    const low = melodyToWireFreq(80, cfg);
    const high = melodyToWireFreq(600, cfg);
    assert.ok(low >= 10 && low <= 240);
    assert.ok(high > low);
  });
});

describe("wire-shaping.js - config", () => {
  test("sanitise clamps and defaults", () => {
    const c = sanitiseWireShaping({ dither: 99, detuneHz: -3, beatBpm: 9999, shapeA: "bogus" });
    assert.equal(c.dither, 5);
    assert.equal(c.detuneHz, 0);
    assert.equal(c.beatBpm, 240);
    assert.equal(c.shapeA, "none");
    assert.equal(c.shapeB, "none");
    const d = sanitiseWireShaping(null);
    assert.deepEqual(d, DEFAULT_WIRE_SHAPING);
  });
});

