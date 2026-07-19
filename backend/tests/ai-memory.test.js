/**
 * Tests for ai-memory.js - add, forget, snapshot, search.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  loadMemory,
  saveMemory,
  addMemory,
  forgetMemory,
  forgetUnpinned,
  clearMemory,
  getMemorySnapshot,
  getMemoryCount,
  searchMemory,
} from "../../frontend/js/modules/ai-memory.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("ai-memory.js - addMemory", () => {
  it("starts empty", () => {
    assert.equal(loadMemory().length, 0);
    assert.equal(getMemoryCount(), 0);
  });

  it("adds valid entry", () => {
    const r = addMemory("like", "Sanftes Anlaufen");
    assert.equal(r.ok, true);
    assert.equal(r.entry.category, "like");
    assert.equal(r.entry.content, "Sanftes Anlaufen");
    assert.equal(r.entry.pinned, false);
    assert.equal(getMemoryCount(), 1);
  });

  it("rejects unknown category", () => {
    const r = addMemory("super-like", "x");
    assert.equal(r.ok, false);
    assert.match(r.error, /Kategorie/);
  });

  it("rejects empty content", () => {
    const r = addMemory("like", "   ");
    assert.equal(r.ok, false);
    assert.match(r.error, /Inhalt/);
  });

  it("rejects content over 500 chars", () => {
    const r = addMemory("like", "x".repeat(501));
    assert.equal(r.ok, false);
    assert.match(r.error, /zu lang/);
  });

  it("rejects duplicates in same category", () => {
    addMemory("like", "Pizza");
    const r = addMemory("like", "Pizza");
    assert.equal(r.ok, false);
    assert.match(r.error, /existiert bereits/);
  });

  it("allows same content in different categories", () => {
    addMemory("like", "Pizza");
    const r = addMemory("preference", "Pizza");
    assert.equal(r.ok, true);
  });

  it("pinned flag respected", () => {
    const r = addMemory("fact", "Lieblingszahl: 7", true);
    assert.equal(r.entry.pinned, true);
  });
});

describe("ai-memory.js - forgetMemory", () => {
  it("removes by id", () => {
    const r = addMemory("like", "Pizza");
    const ok = forgetMemory(r.entry.id);
    assert.equal(ok, true);
    assert.equal(getMemoryCount(), 0);
  });

  it("returns false for unknown id", () => {
    assert.equal(forgetMemory("ghost"), false);
  });
});

describe("ai-memory.js - forgetUnpinned", () => {
  it("removes only unpinned", () => {
    addMemory("like", "A");
    addMemory("like", "B");
    addMemory("like", "C", true);
    const removed = forgetUnpinned();
    assert.equal(removed, 2);
    assert.equal(getMemoryCount(), 1);
  });

  it("returns 0 if nothing to remove", () => {
    addMemory("like", "A", true);
    assert.equal(forgetUnpinned(), 0);
  });
});

describe("ai-memory.js - clearMemory", () => {
  it("removes everything", () => {
    addMemory("like", "A");
    addMemory("dislike", "B");
    clearMemory();
    assert.equal(getMemoryCount(), 0);
  });
});

describe("ai-memory.js - getMemorySnapshot", () => {
  it("returns empty string for no entries", () => {
    assert.equal(getMemorySnapshot(), "");
  });

  it("groups by category", () => {
    addMemory("like", "Pizza");
    addMemory("dislike", "Kälte");
    addMemory("like", "Musik");
    const snap = getMemorySnapshot();
    assert.match(snap, /Mag: Pizza; Musik/);
    assert.match(snap, /Mag nicht: Kälte/);
  });

  it("includes all category labels", () => {
    addMemory("preference", "X");
    addMemory("fact", "Y");
    addMemory("note", "Z");
    const snap = getMemorySnapshot();
    assert.match(snap, /Präferenzen:/);
    assert.match(snap, /Fakten:/);
    assert.match(snap, /Notizen:/);
  });
});

describe("ai-memory.js - searchMemory", () => {
  it("returns all on empty query", () => {
    addMemory("like", "Pizza");
    addMemory("dislike", "Kälte");
    assert.equal(searchMemory("").length, 2);
  });

  it("case-insensitive search", () => {
    addMemory("like", "PIZZA");
    addMemory("dislike", "kälte");
    const r = searchMemory("piz");
    assert.equal(r.length, 1);
    assert.equal(r[0].content, "PIZZA");
  });

  it("no match returns empty array", () => {
    addMemory("like", "Pizza");
    assert.equal(searchMemory("xyz").length, 0);
  });
});

describe("ai-memory.js - persistence", () => {
  it("survives reload", () => {
    addMemory("fact", "Persistent");
    // Reload by calling loadMemory (simulates new app start)
    const list = loadMemory();
    assert.equal(list.length, 1);
    assert.equal(list[0].content, "Persistent");
  });

  it("caps at MAX_ENTRIES (200)", () => {
    for (let i = 0; i < 250; i++) addMemory("note", `entry-${i}`);
    // After saveMemory's slice(-200), only 200 newest should remain
    const list = loadMemory();
    assert.ok(list.length <= 200);
    // The most recent should be entry-249 (highest number)
    assert.match(list[list.length - 1].content, /entry-249/);
  });
});
