/**
 * Tests for recording-editor.js - trim/loop/fade/normalize.
 *
 * All operations are pure functions on arrays of frame objects.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  sortByTime,
  trimByTime,
  trimByIndex,
  loopSection,
  fadeIn,
  fadeOut,
  normalize,
  getDuration,
  formatDuration,
} from "../../frontend/js/modules/recording-editor.js";

function makeFrames(count, startT = 0, step = 100) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      t: startT + i * step,
      fA: 45,
      aA: 50,
      fB: 45,
      aB: 50,
      strA: 30,
      strB: 30,
    });
  }
  return out;
}

describe("recording-editor.js - sortByTime", () => {
  it("sorts ascending", () => {
    const frames = [{ t: 200 }, { t: 0 }, { t: 100 }];
    const sorted = sortByTime(frames);
    assert.deepEqual(
      sorted.map((f) => f.t),
      [0, 100, 200]
    );
  });

  it("returns empty for non-array", () => {
    assert.deepEqual(sortByTime(null), []);
  });
});

describe("recording-editor.js - trimByTime", () => {
  it("keeps frames within window", () => {
    const frames = makeFrames(5); // t = 0, 100, 200, 300, 400
    const r = trimByTime(frames, 100, 400);
    assert.deepEqual(
      r.map((f) => f.t),
      [100, 200, 300]
    );
  });

  it("returns empty for non-array", () => {
    assert.deepEqual(trimByTime(null, 0, 100), []);
  });

  it("handles invalid bounds", () => {
    const frames = makeFrames(3);
    const r = trimByTime(frames, "abc", undefined);
    assert.equal(r.length, 3);
  });
});

describe("recording-editor.js - trimByIndex", () => {
  it("slices by index", () => {
    const frames = makeFrames(5);
    const r = trimByIndex(frames, 1, 4);
    assert.equal(r.length, 3);
    assert.deepEqual(
      r.map((f) => f.t),
      [100, 200, 300]
    );
  });
});

describe("recording-editor.js - loopSection", () => {
  it("repeats the section N times", () => {
    const frames = makeFrames(5); // 0..400
    const r = loopSection(frames, 100, 300, 3);
    // Section has 2 frames (100, 200). 3 iterations → 6 frames.
    assert.equal(r.length, 6);
    // First frame should be at t=0 (re-zeroed)
    assert.equal(r[0].t, 0);
  });

  it("single iteration = section", () => {
    const frames = makeFrames(5);
    const r = loopSection(frames, 100, 300, 1);
    assert.equal(r.length, 2);
  });

  it("clamps iterations to 50", () => {
    const frames = makeFrames(3); // t = 0, 100, 200
    const r = loopSection(frames, 0, 200, 999); // section = 0, 100 (2 frames)
    assert.equal(r.length, 2 * 50);
  });

  it("empty section → empty result", () => {
    const frames = makeFrames(2);
    const r = loopSection(frames, 5000, 6000, 3);
    assert.equal(r.length, 0);
  });
});

describe("recording-editor.js - fadeIn", () => {
  it("scales amplitudes linearly from 0", () => {
    const frames = [
      { t: 0, aA: 100, aB: 100 },
      { t: 1000, aA: 100, aB: 100 },
      { t: 2000, aA: 100, aB: 100 },
    ];
    const r = fadeIn(frames, 2000);
    assert.equal(r[0].aA, 0); // 0% progress
    assert.equal(r[1].aA, 50); // 50%
    assert.equal(r[2].aA, 100); // 100%
  });

  it("no fade for duration=0", () => {
    const frames = [{ t: 0, aA: 100, aB: 50 }];
    const r = fadeIn(frames, 0);
    assert.equal(r[0].aA, 100);
  });
});

describe("recording-editor.js - fadeOut", () => {
  it("scales amplitudes down to 0 at end", () => {
    const frames = [
      { t: 0, aA: 100, aB: 100 },
      { t: 1000, aA: 100, aB: 100 },
      { t: 2000, aA: 100, aB: 100 },
    ];
    const r = fadeOut(frames, 2000);
    assert.equal(r[0].aA, 100); // start: 100%
    assert.equal(r[1].aA, 50); // 50%
    assert.equal(r[2].aA, 0); // 0%
  });
});

describe("recording-editor.js - normalize", () => {
  it("scales so max becomes target", () => {
    const frames = [
      { t: 0, aA: 50, aB: 0 },
      { t: 100, aA: 25, aB: 80 },
    ];
    const r = normalize(frames, 100);
    // Peak = 80, scale = 100/80 = 1.25
    assert.equal(r[0].aA, 63); // 50 * 1.25 = 62.5 → 63
    assert.equal(r[1].aB, 100); // 80 * 1.25 = 100
  });

  it("no-op when all zero", () => {
    const frames = [{ t: 0, aA: 0, aB: 0 }];
    const r = normalize(frames, 100);
    assert.equal(r[0].aA, 0);
  });
});

describe("recording-editor.js - getDuration + formatDuration", () => {
  it("returns last frame t", () => {
    const frames = [{ t: 0 }, { t: 1000 }, { t: 65000 }];
    assert.equal(getDuration(frames), 65000);
  });

  it("0 for empty array", () => {
    assert.equal(getDuration([]), 0);
    assert.equal(getDuration(null), 0);
  });

  it("formats as M:SS", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(5000), "0:05");
    assert.equal(formatDuration(65000), "1:05");
    assert.equal(formatDuration(3723000), "62:03");
  });
});
