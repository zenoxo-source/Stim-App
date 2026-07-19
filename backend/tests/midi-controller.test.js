/**
 * Tests for midi-controller.js - pure mapping logic.
 *
 * Web MIDI API itself isn't available in Node; we test the pure helpers
 * (validation, value mapping, message matching).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  validateMapping,
  mapMidiToRange,
  matchMessage,
  loadMappings,
  saveMappings,
  addMapping,
  updateMapping,
  removeMapping,
} from "../../frontend/js/modules/midi-controller.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("midi-controller.js - validateMapping", () => {
  it("accepts well-formed CC mapping", () => {
    const r = validateMapping({
      type: "cc",
      number: 7,
      action: { type: "set-strength", channel: "A", min: 0, max: 100 },
    });
    assert.equal(r.ok, true);
  });

  it("rejects unknown type", () => {
    const r = validateMapping({ type: "sysex", number: 0, action: { type: "set-strength", channel: "A" } });
    assert.equal(r.ok, false);
  });

  it("rejects number out of range", () => {
    const r = validateMapping({ type: "cc", number: 200, action: { type: "set-strength", channel: "A" } });
    assert.equal(r.ok, false);
  });

  it("rejects missing action", () => {
    const r = validateMapping({ type: "cc", number: 0 });
    assert.equal(r.ok, false);
  });

  it("rejects invalid channel", () => {
    const r = validateMapping({
      type: "cc",
      number: 0,
      action: { type: "set-strength", channel: "X" },
    });
    assert.equal(r.ok, false);
  });

  it("rejects missing patternName for trigger-pattern", () => {
    const r = validateMapping({
      type: "note",
      number: 60,
      action: { type: "trigger-pattern" },
    });
    assert.equal(r.ok, false);
  });

  it("rejects invalid midi channel", () => {
    const r = validateMapping({
      type: "cc",
      channel: 20,
      number: 0,
      action: { type: "set-strength", channel: "A" },
    });
    assert.equal(r.ok, false);
  });
});

describe("midi-controller.js - mapMidiToRange", () => {
  it("returns min at MIDI 0", () => {
    assert.equal(mapMidiToRange(0, 50, 150), 50);
  });

  it("returns max at MIDI 127", () => {
    assert.equal(mapMidiToRange(127, 0, 200), 200);
  });

  it("returns midpoint at MIDI 64", () => {
    const v = mapMidiToRange(64, 0, 100);
    assert.ok(v >= 49 && v <= 51, `expected ~50, got ${v}`);
  });

  it("clamps MIDI value to 0-127", () => {
    assert.equal(mapMidiToRange(-10, 0, 100), 0);
    assert.equal(mapMidiToRange(999, 0, 100), 100);
  });

  it("handles min == max", () => {
    assert.equal(mapMidiToRange(50, 75, 75), 75);
  });
});

describe("midi-controller.js - matchMessage", () => {
  it("matches CC message", () => {
    // CC on channel 0, controller 7, value 100
    // Status byte: 0xB0 (176) = 1011_0000 (channel 0, CC)
    const msg = new Uint8Array([0xb0, 7, 100]);
    const mapping = { type: "cc", number: 7, enabled: true };
    const r = matchMessage(msg, mapping, "");
    assert.equal(r.match, true);
    assert.equal(r.value, 100);
  });

  it("rejects CC with wrong controller number", () => {
    const msg = new Uint8Array([0xb0, 7, 100]);
    const mapping = { type: "cc", number: 8, enabled: true };
    assert.equal(matchMessage(msg, mapping, "").match, false);
  });

  it("respects channel filter", () => {
    const msg = new Uint8Array([0xb1, 7, 100]); // channel 1
    const mapping = { type: "cc", number: 7, channel: 0, enabled: true };
    assert.equal(matchMessage(msg, mapping, "").match, false);
  });

  it("matches any channel when -1", () => {
    const msg = new Uint8Array([0xb5, 7, 100]);
    const mapping = { type: "cc", number: 7, channel: -1, enabled: true };
    assert.equal(matchMessage(msg, mapping, "").match, true);
  });

  it("matches Note On with velocity > 0", () => {
    // Note On channel 0, note 60, velocity 100
    // 0x90 = 1001_0000
    const msg = new Uint8Array([0x90, 60, 100]);
    const mapping = { type: "note", number: 60, enabled: true };
    assert.equal(matchMessage(msg, mapping, "").match, true);
  });

  it("Note On with velocity 0 = Note Off (no match)", () => {
    const msg = new Uint8Array([0x90, 60, 0]);
    const mapping = { type: "note", number: 60, enabled: true };
    assert.equal(matchMessage(msg, mapping, "").match, false);
  });

  it("Program Change matches", () => {
    // Program Change channel 0, program 5
    // 0xC0 = 1100_0000
    const msg = new Uint8Array([0xc0, 5]);
    const mapping = { type: "program", number: 5, enabled: true };
    assert.equal(matchMessage(msg, mapping, "").match, true);
  });

  it("inputName substring filter", () => {
    const msg = new Uint8Array([0xb0, 7, 100]);
    const mapping = { type: "cc", number: 7, inputName: "nanoKONTROL", enabled: true };
    assert.equal(matchMessage(msg, mapping, "nanoKONTROL Studio").match, true);
    assert.equal(matchMessage(msg, mapping, "Akai LPD8").match, false);
  });

  it("disabled mapping never matches", () => {
    const msg = new Uint8Array([0xb0, 7, 100]);
    const mapping = { type: "cc", number: 7, enabled: false };
    assert.equal(matchMessage(msg, mapping, "").match, false);
  });

  it("handles too-short messages", () => {
    const msg = new Uint8Array([0xb0]);
    const mapping = { type: "cc", number: 7 };
    assert.equal(matchMessage(msg, mapping, "").match, false);
  });
});

describe("midi-controller.js - CRUD", () => {
  it("starts empty", () => {
    assert.equal(loadMappings().length, 0);
  });

  it("addMapping persists + validates", () => {
    const r = addMapping({
      type: "cc",
      number: 7,
      action: { type: "set-strength", channel: "A", min: 0, max: 100 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.mapping.id);
    assert.equal(loadMappings().length, 1);
  });

  it("addMapping rejects invalid", () => {
    const r = addMapping({ type: "sysex", number: 0, action: {} });
    assert.equal(r.ok, false);
    assert.equal(loadMappings().length, 0);
  });

  it("updateMapping toggles enabled", () => {
    const r = addMapping({
      type: "cc",
      number: 7,
      action: { type: "set-strength", channel: "A" },
    });
    updateMapping(r.mapping.id, { enabled: false });
    const list = loadMappings();
    assert.equal(list[0].enabled, false);
  });

  it("updateMapping returns false for unknown id", () => {
    assert.equal(updateMapping("ghost", { enabled: false }), false);
  });

  it("removeMapping deletes", () => {
    const r = addMapping({
      type: "cc",
      number: 7,
      action: { type: "set-strength", channel: "A" },
    });
    removeMapping(r.mapping.id);
    assert.equal(loadMappings().length, 0);
  });
});
