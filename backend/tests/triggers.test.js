/**
 * Tests for triggers.js - validation, condition evaluation, CRUD.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  validateTrigger,
  loadTriggers,
  saveTriggers,
  addTrigger,
  updateTrigger,
  removeTrigger,
  evaluateCondition,
  armTriggers,
  disarmTriggers,
} from "../../frontend/js/modules/triggers.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  disarmTriggers();
});

describe("triggers.js - validateTrigger", () => {
  it("rejects null/undefined", () => {
    assert.equal(validateTrigger(null).ok, false);
    assert.equal(validateTrigger(undefined).ok, false);
  });

  it("rejects missing condition or action", () => {
    assert.equal(validateTrigger({ condition: {} }).ok, false);
    assert.equal(validateTrigger({ action: {} }).ok, false);
  });

  it("rejects unknown condition type", () => {
    const r = validateTrigger({
      condition: { type: "magic" },
      action: { type: "log", message: "x" },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /condition\.type/);
  });

  it("rejects unknown action type", () => {
    const r = validateTrigger({
      condition: { type: "audio-playing" },
      action: { type: "explode" },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /action\.type/);
  });

  it("rejects strength condition without numeric value", () => {
    const r = validateTrigger({
      condition: { type: "strength-above", channel: "A", value: "high" },
      action: { type: "log", message: "x" },
    });
    assert.equal(r.ok, false);
  });

  it("accepts well-formed trigger", () => {
    const r = validateTrigger({
      condition: { type: "strength-above", channel: "A", value: 100 },
      action: { type: "soft-stop" },
    });
    assert.equal(r.ok, true);
  });
});

describe("triggers.js - CRUD", () => {
  it("starts empty", () => {
    assert.equal(loadTriggers().length, 0);
  });

  it("addTrigger persists", () => {
    const r = addTrigger({
      condition: { type: "audio-playing" },
      action: { type: "log", message: "Audio läuft" },
    });
    assert.equal(r.ok, true);
    assert.ok(r.trigger.id);
    assert.equal(loadTriggers().length, 1);
  });

  it("addTrigger rejects invalid", () => {
    const r = addTrigger({ condition: {}, action: {} });
    assert.equal(r.ok, false);
    assert.equal(loadTriggers().length, 0);
  });

  it("updateTrigger toggles enabled", () => {
    const r = addTrigger({
      condition: { type: "audio-playing" },
      action: { type: "log", message: "x" },
    });
    updateTrigger(r.trigger.id, { enabled: false });
    const list = loadTriggers();
    assert.equal(list[0].enabled, false);
  });

  it("updateTrigger returns false for unknown id", () => {
    assert.equal(updateTrigger("ghost", { enabled: false }), false);
  });

  it("removeTrigger deletes", () => {
    const r = addTrigger({
      condition: { type: "audio-playing" },
      action: { type: "log", message: "x" },
    });
    removeTrigger(r.trigger.id);
    assert.equal(loadTriggers().length, 0);
  });

  it("saveTriggers + loadTriggers roundtrip", () => {
    saveTriggers([
      {
        id: "x",
        enabled: true,
        lastFired: null,
        condition: { type: "audio-playing" },
        action: { type: "log", message: "x" },
      },
    ]);
    const list = loadTriggers();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "x");
  });
});

describe("triggers.js - evaluateCondition", () => {
  const ctx = (overrides = {}) => ({
    strengthA: 0,
    strengthB: 0,
    activePattern: null,
    isAudioPlaying: false,
    armTime: 0,
    now: 0,
    ...overrides,
  });

  it("strength-above", () => {
    const t = { condition: { type: "strength-above", channel: "A", value: 50 } };
    assert.equal(evaluateCondition(t, ctx({ strengthA: 60 })), true);
    assert.equal(evaluateCondition(t, ctx({ strengthA: 40 })), false);
  });

  it("strength-below for channel B", () => {
    const t = { condition: { type: "strength-below", channel: "B", value: 50 } };
    assert.equal(evaluateCondition(t, ctx({ strengthB: 40 })), true);
    assert.equal(evaluateCondition(t, ctx({ strengthB: 60 })), false);
  });

  it("time-elapsed", () => {
    const t = { condition: { type: "time-elapsed", seconds: 10 } };
    assert.equal(evaluateCondition(t, ctx({ armTime: 0, now: 10_000 })), true);
    assert.equal(evaluateCondition(t, ctx({ armTime: 0, now: 9_000 })), false);
  });

  it("pattern-active", () => {
    const t = { condition: { type: "pattern-active", name: "wave" } };
    assert.equal(evaluateCondition(t, ctx({ activePattern: "wave" })), true);
    assert.equal(evaluateCondition(t, ctx({ activePattern: "climax" })), false);
  });

  it("audio-playing", () => {
    const t = { condition: { type: "audio-playing" } };
    assert.equal(evaluateCondition(t, ctx({ isAudioPlaying: true })), true);
    assert.equal(evaluateCondition(t, ctx({ isAudioPlaying: false })), false);
  });
});

describe("triggers.js - arm/disarm", () => {
  it("armTriggers is idempotent (no throw on re-arm)", () => {
    armTriggers();
    armTriggers();
    disarmTriggers();
    assert.ok(true);
  });
});
