/**
 * Tests for pattern-import.js - validation, parsing, merge.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  validatePatternEntry,
  parseImportPayload,
  summarizePattern,
  mergePatterns,
} from "../../frontend/js/modules/pattern-import.js";

describe("pattern-import.js - validatePatternEntry", () => {
  it("accepts a well-formed entry", () => {
    const r = validatePatternEntry({
      steps: 4,
      channelA: [10, 20, 30, 40],
      channelB: [5, 15, 25, 35],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sanitized.channelA, [10, 20, 30, 40]);
  });

  it("rejects non-object", () => {
    assert.equal(validatePatternEntry(null).ok, false);
    assert.equal(validatePatternEntry("hello").ok, false);
    assert.equal(validatePatternEntry(42).ok, false);
  });

  it("rejects invalid steps", () => {
    const r = validatePatternEntry({ steps: 0, channelA: [], channelB: [] });
    assert.equal(r.ok, false);
  });

  it("rejects non-integer steps", () => {
    const r = validatePatternEntry({ steps: 4.5, channelA: [1, 2, 3, 4], channelB: [1, 2, 3, 4] });
    assert.equal(r.ok, false);
  });

  it("rejects array length mismatch", () => {
    const r = validatePatternEntry({
      steps: 4,
      channelA: [1, 2, 3],
      channelB: [1, 2, 3, 4],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /4 Werte/);
  });

  it("rejects missing channels", () => {
    const r = validatePatternEntry({ steps: 4 });
    assert.equal(r.ok, false);
  });

  it("clamps values to 0-100", () => {
    const r = validatePatternEntry({
      steps: 2,
      channelA: [-5, 150],
      channelB: [50, "70"],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sanitized.channelA, [0, 100]);
    assert.deepEqual(r.sanitized.channelB, [50, 70]);
  });
});

describe("pattern-import.js - parseImportPayload", () => {
  it("parses valid JSON", () => {
    const payload = JSON.stringify({
      "Pattern A": { steps: 2, channelA: [10, 20], channelB: [5, 15] },
      "Pattern B": { steps: 2, channelA: [30, 40], channelB: [25, 35] },
    });
    const r = parseImportPayload(payload);
    assert.equal(r.valid.length, 2);
    assert.equal(r.errors.length, 0);
  });

  it("collects errors for invalid entries", () => {
    const payload = JSON.stringify({
      "Good": { steps: 2, channelA: [10, 20], channelB: [5, 15] },
      "Bad": { steps: 5, channelA: [1, 2], channelB: [1, 2] },
    });
    const r = parseImportPayload(payload);
    assert.equal(r.valid.length, 1);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].name, "Bad");
  });

  it("returns fatalError on bad JSON", () => {
    const r = parseImportPayload("{not valid json}");
    assert.equal(r.valid.length, 0);
    assert.ok(r.fatalError);
    assert.match(r.fatalError, /JSON/);
  });

  it("returns fatalError on non-object payload", () => {
    const r = parseImportPayload(JSON.stringify([1, 2, 3]));
    assert.ok(r.fatalError);
  });
});

describe("pattern-import.js - summarizePattern", () => {
  it("computes avg/max/peak", () => {
    const s = summarizePattern({ steps: 4, channelA: [10, 80, 30, 40], channelB: [5, 15, 25, 35] });
    assert.equal(s.maxA, 80);
    assert.equal(s.peakStepA, 1);
    assert.equal(s.maxB, 35);
    assert.equal(s.peakStepB, 3);
    assert.equal(s.avgA, 40);
  });

  it("handles empty pattern", () => {
    const s = summarizePattern({ steps: 0, channelA: [], channelB: [] });
    assert.equal(s.maxA, 0);
    assert.equal(s.avgA, 0);
  });
});

describe("pattern-import.js - mergePatterns", () => {
  it("adds new patterns to empty target", () => {
    const target = {};
    const renames = mergePatterns(target, [
      { name: "A", pattern: { steps: 2, channelA: [1, 2], channelB: [3, 4] } },
    ]);
    assert.equal(Object.keys(target).length, 1);
    assert.equal(renames.length, 1);
    assert.equal(renames[0].storedAs, "A");
  });

  it("renames on collision", () => {
    const target = { A: { steps: 2, channelA: [1, 2], channelB: [3, 4] } };
    const renames = mergePatterns(target, [
      { name: "A", pattern: { steps: 2, channelA: [5, 6], channelB: [7, 8] } },
    ]);
    assert.equal(Object.keys(target).length, 2);
    assert.equal(renames[0].original, "A");
    assert.notEqual(renames[0].storedAs, "A");
    assert.match(renames[0].storedAs, /^A_imported_\d+$/);
  });

  it("preserves existing patterns", () => {
    const target = { Existing: { steps: 2, channelA: [1, 2], channelB: [3, 4] } };
    mergePatterns(target, [
      { name: "New", pattern: { steps: 2, channelA: [5, 6], channelB: [7, 8] } },
    ]);
    assert.deepEqual(target.Existing.channelA, [1, 2]);
  });
});
