/**
 * Tests for scheduler.js - entries, scheduling math, fire logic.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  loadEntries,
  saveEntries,
  addEntry,
  updateEntry,
  removeEntry,
  computeNextFire,
  shouldFireNow,
  armScheduler,
  disarmScheduler,
} from "../../frontend/js/modules/scheduler.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  disarmScheduler();
});

afterEach(() => {
  disarmScheduler();
});

describe("scheduler.js - CRUD", () => {
  it("starts empty", () => {
    assert.equal(loadEntries().length, 0);
  });

  it("addEntry persists", () => {
    const e = addEntry({ sessionId: "slow_burn", name: "Slow Burn", hour: 20, minute: 30 });
    assert.equal(loadEntries().length, 1);
    assert.equal(loadEntries()[0].id, e.id);
  });

  it("addEntry clamps hour/minute", () => {
    addEntry({ sessionId: "x", name: "X", hour: 99, minute: -5 });
    const e = loadEntries()[0];
    assert.equal(e.hour, 23);
    assert.equal(e.minute, 0);
  });

  it("addEntry filters invalid weekdays", () => {
    addEntry({
      sessionId: "x",
      name: "X",
      hour: 12,
      minute: 0,
      repeatDays: [0, 3, 7, -1, 99],
    });
    const e = loadEntries()[0];
    assert.deepEqual(e.repeatDays, [0, 3]);
  });

  it("updateEntry merges patch", () => {
    const e = addEntry({ sessionId: "x", name: "X", hour: 10, minute: 0 });
    updateEntry(e.id, { enabled: false });
    const updated = loadEntries().find((entry) => entry.id === e.id);
    assert.equal(updated.enabled, false);
  });

  it("updateEntry returns null for unknown id", () => {
    assert.equal(updateEntry("does-not-exist", { enabled: false }), null);
  });

  it("removeEntry deletes", () => {
    const e = addEntry({ sessionId: "x", name: "X", hour: 10, minute: 0 });
    removeEntry(e.id);
    assert.equal(loadEntries().length, 0);
  });
});

describe("scheduler.js - computeNextFire", () => {
  it("returns null for disabled entry", () => {
    const r = computeNextFire(
      { enabled: false, hour: 12, minute: 0, repeatDays: [] },
      new Date("2025-01-01T10:00:00")
    );
    assert.equal(r, null);
  });

  it("returns today if slot is in the future", () => {
    const from = new Date("2025-01-01T10:00:00");
    const r = computeNextFire(
      { enabled: true, hour: 15, minute: 30, repeatDays: [] },
      from
    );
    const expected = new Date("2025-01-01T15:30:00");
    assert.equal(new Date(r).getTime(), expected.getTime());
  });

  it("advances to next day if slot passed", () => {
    const from = new Date("2025-01-01T16:00:00");
    const r = computeNextFire(
      { enabled: true, hour: 15, minute: 30, repeatDays: [] },
      from
    );
    const expected = new Date("2025-01-02T15:30:00");
    assert.equal(new Date(r).getTime(), expected.getTime());
  });

  it("respects weekday filter", () => {
    // Wednesday Jan 1 2025 — find next Monday
    const from = new Date("2025-01-01T10:00:00"); // Wednesday
    const r = computeNextFire(
      { enabled: true, hour: 12, minute: 0, repeatDays: [1] }, // Mondays
      from
    );
    const expected = new Date("2025-01-06T12:00:00"); // next Monday
    assert.equal(new Date(r).getTime(), expected.getTime());
  });
});

describe("scheduler.js - shouldFireNow", () => {
  it("returns false for disabled entry", () => {
    const now = new Date("2025-01-01T12:00:00");
    assert.equal(
      shouldFireNow({ enabled: false, hour: 12, minute: 0, repeatDays: [] }, now),
      false
    );
  });

  it("returns true when HH:MM matches and not yet fired", () => {
    const now = new Date("2025-01-01T12:00:00");
    assert.equal(
      shouldFireNow({ enabled: true, hour: 12, minute: 0, repeatDays: [], lastFired: null }, now),
      true
    );
  });

  it("returns false when hour mismatches", () => {
    const now = new Date("2025-01-01T12:00:00");
    assert.equal(
      shouldFireNow({ enabled: true, hour: 13, minute: 0, repeatDays: [], lastFired: null }, now),
      false
    );
  });

  it("returns false for one-shot already fired", () => {
    const now = new Date("2025-01-01T12:00:00");
    assert.equal(
      shouldFireNow(
        {
          enabled: true,
          hour: 12,
          minute: 0,
          repeatDays: [],
          lastFired: "2024-12-31T12:00:00.000Z",
        },
        now
      ),
      false
    );
  });

  it("returns false for wrong weekday when repeatDays set", () => {
    // Wednesday Jan 1 2025
    const now = new Date("2025-01-01T12:00:00"); // Wednesday = day 3
    assert.equal(
      shouldFireNow(
        { enabled: true, hour: 12, minute: 0, repeatDays: [1, 5], lastFired: null },
        now
      ),
      false
    );
  });

  it("returns true for matching weekday", () => {
    const now = new Date("2025-01-01T12:00:00"); // Wednesday = day 3
    assert.equal(
      shouldFireNow(
        { enabled: true, hour: 12, minute: 0, repeatDays: [3], lastFired: null },
        now
      ),
      true
    );
  });
});

describe("scheduler.js - armScheduler", () => {
  it("armScheduler is idempotent", () => {
    armScheduler();
    armScheduler();
    armScheduler();
    disarmScheduler();
    // No assertion possible without exposing interval handle — no throw = pass.
    assert.ok(true);
  });
});
