/**
 * Tests for search.js - index building + filtering.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import { buildIndex, searchIndex } from "../../frontend/js/modules/search.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("search.js - buildIndex", () => {
  it("always returns an array", () => {
    const idx = buildIndex();
    assert.ok(Array.isArray(idx));
  });

  it("includes the 7 tab entries", () => {
    const idx = buildIndex();
    const tabEntries = idx.filter((e) => e.category === "Tab");
    assert.equal(tabEntries.length, 7);
  });

  it("includes sessions (Slow Burn, Ocean Ride, etc.)", () => {
    const idx = buildIndex();
    const sessionEntries = idx.filter((e) => e.category === "Session");
    assert.ok(sessionEntries.length >= 5);
    assert.ok(sessionEntries.some((e) => e.label === "Slow Burn"));
  });

  it("includes custom patterns from localStorage", () => {
    localStorage.setItem(
      "stim_custom_patterns",
      JSON.stringify({
        MyPattern: { steps: 4, channelA: [1, 2, 3, 4], channelB: [5, 6, 7, 8] },
      })
    );
    const idx = buildIndex();
    const patternEntries = idx.filter((e) => e.category === "Pattern");
    assert.ok(patternEntries.some((e) => e.label === "MyPattern"));
  });

  it("includes stats entries", () => {
    localStorage.setItem(
      "stim_app_stats_v2",
      JSON.stringify({
        patternsUsed: { wave: 5, climax: 3 },
        gamesPlayed: { reflex: 10 },
      })
    );
    const idx = buildIndex();
    assert.ok(idx.some((e) => e.label === "wave" && e.category === "Stat: Pattern"));
    assert.ok(idx.some((e) => e.label === "reflex" && e.category === "Stat: Spiel"));
  });

  it("entries have action functions", () => {
    const idx = buildIndex();
    idx.forEach((e) => {
      assert.equal(typeof e.action, "function");
    });
  });
});

describe("search.js - searchIndex", () => {
  it("returns first N entries on empty query", () => {
    const idx = buildIndex();
    const r = searchIndex(idx, "", 5);
    assert.equal(r.length, 5);
  });

  it("case-insensitive match", () => {
    const idx = buildIndex();
    const r = searchIndex(idx, "SLOW", 20);
    assert.ok(r.some((e) => e.label === "Slow Burn"));
  });

  it("exact match scores higher than prefix", () => {
    const idx = buildIndex();
    // Find a tab "games" — also matches other entries containing "games"
    const r = searchIndex(idx, "games", 20);
    assert.ok(r.length > 0);
    // First result should be the exact-match Tab
    assert.equal(r[0].category, "Tab");
    assert.equal(r[0].label, "games");
  });

  it("prefix match ranks above substring match", () => {
    const idx = [
      { category: "X", label: "Slow Burn", action: () => {} },
      { category: "X", label: "Slower Than Slow", action: () => {} },
      { category: "X", label: "Contains slow inside", action: () => {} },
    ];
    const r = searchIndex(idx, "slow", 10);
    assert.equal(r[0].label, "Slow Burn"); // exact match
  });

  it("respects limit", () => {
    const idx = [];
    for (let i = 0; i < 100; i++) {
      idx.push({ category: "X", label: "Item " + i, action: () => {} });
    }
    const r = searchIndex(idx, "Item", 10);
    assert.equal(r.length, 10);
  });

  it("no match returns empty array", () => {
    const idx = buildIndex();
    const r = searchIndex(idx, "thisdoesnotexist_xyz", 20);
    assert.equal(r.length, 0);
  });
});
