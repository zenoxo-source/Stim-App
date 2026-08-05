// pattern-engine.test.js — v2 pulse-train pattern engine (envelopes + slots).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  envelopeAmp,
  pulseTrainAmp,
  computeNamedPatternWave,
  computePatternSlots,
  PATTERN_SPECS,
  randomLevelAt,
} from "../../frontend/js/lib/pattern-engine.js";
import { CONSTANTS } from "../../frontend/js/constants.js";

const ALL_PATTERNS = Object.values(CONSTANTS.PATTERNS);

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("pattern-engine v2 — envelope core", () => {
  it("envelopeAmp ramps up linearly in attack", () => {
    const hit = { at: 0, level: 80, attack: 4, decay: 6, minMult: 0.1 };
    assert.equal(envelopeAmp(hit, 0), 0);
    assert.equal(envelopeAmp(hit, 2), 40);
    assert.equal(envelopeAmp(hit, 4), 80);
  });

  it("envelopeAmp decays quadratically to the minMult floor", () => {
    const hit = { at: 0, level: 100, attack: 1, decay: 4, minMult: 0.1 };
    assert.ok(envelopeAmp(hit, 2) > envelopeAmp(hit, 5), "decays over time");
    // deep in decay → floor (10)
    assert.ok(Math.abs(envelopeAmp(hit, 20) - 10) < 1e-9, "floor reached");
  });

  it("envelopeAmp is 0 before the hit and clamps to 0..100", () => {
    const hit = { at: 5, level: 200, attack: 1, decay: 2, minMult: 0 };
    assert.equal(envelopeAmp(hit, 0), 0);
    assert.ok(envelopeAmp(hit, 5.5) <= 100);
  });

  it("pulseTrainAmp takes over from the most recent hit", () => {
    const hits = [
      { at: 0, level: 100, attack: 1, decay: 10, minMult: 0 },
      { at: 5, level: 40, attack: 1, decay: 3, minMult: 0 },
    ];
    const before = pulseTrainAmp(4.5, 20, hits);
    const after = pulseTrainAmp(5.5, 20, hits);
    assert.ok(before > after, "new hit takes over the decay tail");
  });

  it("pulseTrainAmp wraps the cycle", () => {
    const hits = [{ at: 0, level: 100, attack: 1, decay: 5, minMult: 0.2 }];
    assert.equal(pulseTrainAmp(1, 10, hits), 100); // peak right after attack
    assert.equal(pulseTrainAmp(11, 10, hits), 100); // same point next cycle
    assert.ok(pulseTrainAmp(5, 10, hits) > 0, "decay tail");
    assert.ok(pulseTrainAmp(5, 10, hits) > pulseTrainAmp(8, 10, hits), "decays");
  });
});

describe("pattern-engine v2 — output invariants (bounds, deterministic)", () => {
  it("amplitudes stay within 0..100 for every pattern", () => {
    for (const pattern of ALL_PATTERNS) {
      for (let t = 0; t < 120; t++) {
        const { aA, aB } = computeNamedPatternWave(pattern, t);
        assert.ok(aA >= 0 && aA <= 100, `${pattern} t=${t} aA=${aA}`);
        assert.ok(aB >= 0 && aB <= 100, `${pattern} t=${t} aB=${aB}`);
      }
    }
  });

  it("frequencies stay within the protocol range", () => {
    for (const pattern of ALL_PATTERNS) {
      for (let t = 0; t < 120; t++) {
        const { fA, fB } = computeNamedPatternWave(pattern, t);
        assert.ok(fA >= 10 && fA <= 240, `${pattern} t=${t} fA=${fA}`);
        assert.ok(fB >= 10 && fB <= 240, `${pattern} t=${t} fB=${fB}`);
      }
    }
  });

  it("outputs are integers and finite", () => {
    for (const pattern of ALL_PATTERNS) {
      const w = computeNamedPatternWave(pattern, 7);
      for (const k of ["fA", "aA", "fB", "aB"]) {
        const v = w[k];
        assert.ok(Number.isFinite(v), `${pattern}.${k} not finite`);
        assert.equal(v, Math.round(v), `${pattern}.${k} not an integer`);
      }
    }
  });

  it("same tick → same output (deterministic, incl. random)", () => {
    for (const pattern of ALL_PATTERNS) {
      const a = computeNamedPatternWave(pattern, 13);
      const b = computeNamedPatternWave(pattern, 13);
      assert.deepEqual(a, b, `${pattern} must be deterministic`);
    }
  });

  it("unknown pattern falls back to a safe mid-level wave", () => {
    const w = computeNamedPatternWave("does-not-exist", 0);
    assert.equal(w.fA, 45);
    assert.ok(w.aA >= 20 && w.aA <= 100);
  });

  it("handles undefined / 0 loopCounter", () => {
    for (const pattern of ALL_PATTERNS) {
      const u = computeNamedPatternWave(pattern, undefined);
      const z = computeNamedPatternWave(pattern, 0);
      assert.ok(Number.isFinite(u.aA) && Number.isFinite(z.aA), pattern);
    }
  });
});

describe("pattern-engine v2 — character checks", () => {
  it("rhythm has multi-level accents (not just 0/100)", () => {
    const levels = new Set();
    for (let t = 0; t < 16; t++) levels.add(computeNamedPatternWave("rhythm", t).aA);
    assert.ok(levels.size >= 3, `rhythm needs ≥3 distinct levels, got ${levels.size}`);
    assert.ok(Math.max(...levels) === 100, "rhythm peaks at 100");
  });

  it("heartbeat lub is stronger than dub (multi-level)", () => {
    const lub = computeNamedPatternWave("heartbeat", 1).aA;
    const dub = computeNamedPatternWave("heartbeat", 4).aA;
    assert.ok(lub > dub, `lub ${lub} should be stronger than dub ${dub}`);
  });

  it("escalate ramps up and then drops", () => {
    const early = computeNamedPatternWave("escalate", 5).aA;
    const peak = computeNamedPatternWave("escalate", 27).aA;
    const late = computeNamedPatternWave("escalate", 33).aA;
    assert.ok(early < peak, "ramp rises");
    assert.ok(peak >= 95, "plateau near max");
    assert.ok(late < peak, "drops after the plateau");
  });

  it("alternate drives A then B (spatial switching)", () => {
    const aOn = computeNamedPatternWave("alternate", 1);
    const bOn = computeNamedPatternWave("alternate", 5);
    assert.ok(aOn.aA > aOn.aB, "A leads at start of cycle");
    assert.ok(bOn.aB > bOn.aA, "B leads later in cycle");
    // B runs at a different frequency for spatial contrast
    assert.notEqual(aOn.fB, aOn.fA, "channels use different freqs in alternate");
  });

  it("duet is a call-and-response", () => {
    const aSpeaks = computeNamedPatternWave("duet", 1);
    const bAnswers = computeNamedPatternWave("duet", 9); // half a cycle later
    assert.ok(aSpeaks.aA > aSpeaks.aB, "A speaks first");
    assert.ok(bAnswers.aB > bAnswers.aA, "B answers");
  });

  it("climax strikes land progressively sharper (freq identity climb)", () => {
    const first = computeNamedPatternWave("climax", 1); // strike 1 (fDelta 0)
    const last = computeNamedPatternWave("climax", 14); // strike 3 (fDelta +65)
    assert.ok(last.fA > first.fA, `climax must climb into the sharp band: ${first.fA} → ${last.fA}`);
  });

  it("gentle keeps a breathing floor (never hard 0)", () => {
    let min = 100;
    for (let t = 0; t < 40; t++) {
      min = Math.min(min, computeNamedPatternWave("gentle", t).aA);
    }
    assert.ok(min > 0, `gentle must not hard-gate to 0: min ${min}`);
  });

  it("random is bounded and never dead air", () => {
    for (let t = 0; t < 100; t++) {
      const l = randomLevelAt(t);
      assert.ok(l >= 20 && l <= 100, `random level ${l}`);
    }
  });
});

describe("pattern-engine v2 — frequency identity (v6.5 bands)", () => {
  const maxFreq = (id, ticks = 80) => {
    let m = 0;
    for (let t = 0; t < ticks; t++) m = Math.max(m, computeNamedPatternWave(id, t).fA);
    return m;
  };
  const minFreq = (id, ticks = 80) => {
    let m = 240;
    for (let t = 0; t < ticks; t++) m = Math.min(m, computeNamedPatternWave(id, t).fA);
    return m;
  };

  it("throb-band patterns stay deep (gentle/heartbeat/breath < 45)", () => {
    for (const id of ["gentle", "heartbeat", "breath"]) {
      assert.ok(maxFreq(id) < 45, `${id} max ${maxFreq(id)} must stay in the deep band`);
    }
  });

  it("sharp-band patterns reach the sting zone (flutter/strobe ≥ 120)", () => {
    for (const id of ["flutter", "strobe"]) {
      assert.ok(minFreq(id) >= 120, `${id} min ${minFreq(id)} must live in the sharp band`);
    }
  });

  it("climax travels from buzz into sharp across the cycle", () => {
    const lo = minFreq("climax");
    const hi = maxFreq("climax");
    assert.ok(lo <= 110, `climax starts in buzz: ${lo}`);
    assert.ok(hi >= 150, `climax reaches sharp: ${hi}`);
  });

  it("tease oscillates between deep and sharp (contrast = unpredictability)", () => {
    const lo = minFreq("tease");
    const hi = maxFreq("tease");
    assert.ok(lo <= 45, `tease dips into throb: ${lo}`);
    assert.ok(hi >= 100, `tease peaks into sharp: ${hi}`);
  });

  it("escalate rides from buzz into sharp on the ramp", () => {
    const early = computeNamedPatternWave("escalate", 2).fA;
    const peak = computeNamedPatternWave("escalate", 27).fA;
    assert.ok(peak > early, `escalate freq must rise: ${early} → ${peak}`);
  });

  it("alternate + duet use spatial frequency contrast (A deep, B sharp)", () => {
    const a1 = computeNamedPatternWave("alternate", 1);
    assert.ok(a1.fB >= a1.fA + 60, `alternate spatial contrast: A ${a1.fA} B ${a1.fB}`);
    const d1 = computeNamedPatternWave("duet", 1);
    assert.ok(d1.fB >= d1.fA + 60, `duet spatial contrast: A ${d1.fA} B ${d1.fB}`);
  });

  it("rhythm bass thump drops into the throb band", () => {
    const thump = computeNamedPatternWave("rhythm", 1); // the 100-level hit
    const accent = computeNamedPatternWave("rhythm", 7); // the 55-level accent
    assert.ok(thump.fA < accent.fA, `bass thump must be deeper: ${thump.fA} vs ${accent.fA}`);
    assert.ok(thump.fA < 45, `thump lands in throb: ${thump.fA}`);
  });
});

describe("pattern-engine v2 — 4-slot texture", () => {
  it("returns 4 slots per channel for spec-based patterns", () => {
    const slots = computePatternSlots("climax", 5, 72, 72);
    assert.ok(slots && slots.A.length === 4 && slots.B.length === 4);
    for (const s of [...slots.A, ...slots.B]) {
      assert.ok(Number.isFinite(s.freq) && Number.isFinite(s.intensity));
      assert.ok(s.freq >= 10 && s.freq <= 240);
      assert.ok(s.intensity >= 0 && s.intensity <= 100);
    }
  });

  it("flutter texture varies slot freqs (micro tremor)", () => {
    const slots = computePatternSlots("flutter", 0, 88, 88);
    const freqs = new Set(slots.A.map((s) => s.freq));
    assert.ok(freqs.size > 1, `flutter texture should vary slot freqs: ${[...freqs]}`);
  });

  it("no texture → flat freq slots but intensity still ramps", () => {
    const slots = computePatternSlots("rhythm", 0, 35, 35);
    const freqs = new Set(slots.A.map((s) => s.freq));
    assert.equal(freqs.size, 1, "rhythm has no freq texture");
    assert.ok(
      slots.A.some((s) => s.intensity > 0) && slots.A.some((s) => s.intensity === 0),
      "intensity ramps within the packet"
    );
  });

  it("returns null for non-spec patterns (wave/escalate/random)", () => {
    assert.equal(computePatternSlots("wave", 0, 45, 45), null);
    assert.equal(computePatternSlots("random", 0, 45, 45), null);
    assert.equal(computePatternSlots("does-not-exist", 0, 45, 45), null);
  });
});

describe("pattern-engine v2 — spec sanity", () => {
  it("every spec has a cycle, hits and sane freqs", () => {
    for (const [id, spec] of Object.entries(PATTERN_SPECS)) {
      assert.ok(spec.cycleTicks >= 2, id);
      assert.ok(Array.isArray(spec.hits) && spec.hits.length > 0, id);
      assert.ok((spec.fBase || 0) >= 10 && (spec.fBase || 0) <= 240, id);
      for (const h of spec.hits) {
        assert.ok(h.level > 0 && h.level <= 100, `${id} level ${h.level}`);
        assert.ok(h.at >= 0 && h.at < spec.cycleTicks, `${id} hit.at ${h.at}`);
      }
    }
  });
});
