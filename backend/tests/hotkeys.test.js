/**
 * Tests for hotkeys.js - combo parsing, matching, rebinding, collisions.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  normalizeCombo,
  eventMatchesCombo,
  comboFromEvent,
  registerHotkey,
  getBinding,
  setBinding,
  resetBinding,
  resetAllBindings,
  listActions,
} from "../../frontend/js/modules/hotkeys.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  resetAllBindings();
});

function fakeKeyEvent({ key, ctrlKey, shiftKey, altKey, metaKey, code }) {
  return {
    key,
    code: code || key,
    ctrlKey: !!ctrlKey,
    shiftKey: !!shiftKey,
    altKey: !!altKey,
    metaKey: !!metaKey,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: { tagName: "DIV" },
  };
}

describe("hotkeys.js - normalizeCombo", () => {
  it("uppercase single letters", () => {
    assert.equal(normalizeCombo("p"), "P");
    assert.equal(normalizeCombo("P"), "P");
  });

  it("preserves named keys", () => {
    assert.equal(normalizeCombo("ArrowUp"), "ArrowUp");
    assert.equal(normalizeCombo("Escape"), "Escape");
  });

  it("sorts modifiers alphabetically", () => {
    assert.equal(normalizeCombo("Shift+Ctrl+P"), "ctrl+shift+P");
    assert.equal(normalizeCombo("Mod+Shift+1"), "mod+shift+1");
  });

  it("returns empty for invalid input", () => {
    assert.equal(normalizeCombo(""), "");
    assert.equal(normalizeCombo(null), "");
    assert.equal(normalizeCombo("   "), "");
  });
});

describe("hotkeys.js - eventMatchesCombo", () => {
  it("matches plain letter", () => {
    const e = fakeKeyEvent({ key: "p" });
    assert.equal(eventMatchesCombo(e, "P"), true);
  });

  it("matches arrow keys", () => {
    const e = fakeKeyEvent({ key: "ArrowUp" });
    assert.equal(eventMatchesCombo(e, "ArrowUp"), true);
  });

  it("matches Mod on win/linux (Ctrl)", () => {
    const e = fakeKeyEvent({ key: "1", ctrlKey: true });
    // Force non-mac platform by stubbing navigator.platform
    const orig = Object.getOwnPropertyDescriptor(globalThis.navigator, "platform");
    Object.defineProperty(globalThis.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    assert.equal(eventMatchesCombo(e, "Mod+1"), true);
    if (orig) Object.defineProperty(globalThis.navigator, "platform", orig);
  });

  it("matches Mod on mac (Meta)", () => {
    const e = fakeKeyEvent({ key: "1", metaKey: true });
    const orig = Object.getOwnPropertyDescriptor(globalThis.navigator, "platform");
    Object.defineProperty(globalThis.navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    assert.equal(eventMatchesCombo(e, "Mod+1"), true);
    if (orig) Object.defineProperty(globalThis.navigator, "platform", orig);
  });

  it("rejects when modifier missing", () => {
    const e = fakeKeyEvent({ key: "1" });
    assert.equal(eventMatchesCombo(e, "Mod+1"), false);
  });

  it("matches Shift+P", () => {
    const e = fakeKeyEvent({ key: "P", shiftKey: true });
    assert.equal(eventMatchesCombo(e, "shift+P"), true);
  });

  it("rejects when shift not pressed", () => {
    const e = fakeKeyEvent({ key: "P" });
    assert.equal(eventMatchesCombo(e, "shift+P"), false);
  });
});

describe("hotkeys.js - comboFromEvent", () => {
  it("ignores pure modifier presses", () => {
    assert.equal(comboFromEvent(fakeKeyEvent({ key: "Shift" })), "");
    assert.equal(comboFromEvent(fakeKeyEvent({ key: "Control" })), "");
    assert.equal(comboFromEvent(fakeKeyEvent({ key: "Alt" })), "");
    assert.equal(comboFromEvent(fakeKeyEvent({ key: "Meta" })), "");
  });

  it("produces normalized combo from event", () => {
    const e = fakeKeyEvent({ key: "p", shiftKey: true });
    // On non-mac, no Mod
    const orig = Object.getOwnPropertyDescriptor(globalThis.navigator, "platform");
    Object.defineProperty(globalThis.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    assert.equal(comboFromEvent(e), "shift+P");
    if (orig) Object.defineProperty(globalThis.navigator, "platform", orig);
  });
});

describe("hotkeys.js - registry", () => {
  it("registers with default combo", () => {
    registerHotkey({
      id: "test-action",
      label: "Test",
      defaultCombo: "P",
      handler: () => {},
    });
    assert.equal(getBinding("test-action"), "P");
  });

  it("setBinding overrides default", () => {
    registerHotkey({
      id: "test-action",
      label: "Test",
      defaultCombo: "P",
      handler: () => {},
    });
    const r = setBinding("test-action", "Mod+Shift+P");
    assert.equal(r.ok, true);
    assert.equal(getBinding("test-action"), "mod+shift+P");
  });

  it("setBinding rejects collision", () => {
    registerHotkey({
      id: "a1",
      label: "Action 1",
      defaultCombo: "P",
      handler: () => {},
    });
    registerHotkey({
      id: "a2",
      label: "Action 2",
      defaultCombo: "Q",
      handler: () => {},
    });
    const r = setBinding("a2", "P");
    assert.equal(r.ok, false);
    assert.match(r.error, /Kollision/);
  });

  it("setBinding force overrides collision", () => {
    registerHotkey({
      id: "a1",
      label: "Action 1",
      defaultCombo: "P",
      handler: () => {},
    });
    registerHotkey({
      id: "a2",
      label: "Action 2",
      defaultCombo: "Q",
      handler: () => {},
    });
    const r = setBinding("a2", "P", true);
    assert.equal(r.ok, true);
  });

  it("protected action cannot be rebound", () => {
    registerHotkey({
      id: "protected",
      label: "Protected",
      defaultCombo: "F12",
      allowRebind: false,
      handler: () => {},
    });
    const r = setBinding("protected", "P");
    assert.equal(r.ok, false);
    assert.match(r.error, /geschützt/);
  });

  it("resetBinding restores default", () => {
    registerHotkey({
      id: "x",
      label: "X",
      defaultCombo: "F8",
      handler: () => {},
    });
    setBinding("x", "F9");
    assert.equal(getBinding("x"), "F9");
    resetBinding("x");
    assert.equal(getBinding("x"), "F8");
  });

  it("resetAllBindings clears all overrides", () => {
    registerHotkey({
      id: "y",
      label: "Y",
      defaultCombo: "P",
      handler: () => {},
    });
    setBinding("y", "Q");
    resetAllBindings();
    assert.equal(getBinding("y"), "P");
  });

  it("listActions includes defaults + current bindings", () => {
    registerHotkey({
      id: "z",
      label: "Z Action",
      defaultCombo: "P",
      handler: () => {},
    });
    const list = listActions();
    const z = list.find((a) => a.id === "z");
    assert.ok(z);
    assert.equal(z.defaultCombo, "P");
    assert.equal(z.currentCombo, "P");
  });
});
