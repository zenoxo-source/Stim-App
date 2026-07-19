/**
 * Tests for theme.js - theme storage, resolution, cycling.
 * DOM bits are mocked via helpers/dom-mock.js.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  getStoredTheme,
  resolveTheme,
  applyTheme,
  setTheme,
  cycleTheme,
} from "../../frontend/js/modules/theme.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.removeAttribute("data-theme");
});

describe("theme.js", () => {
  it("defaults to dark when nothing stored", () => {
    assert.equal(getStoredTheme(), "dark");
  });

  it("persists via setTheme", () => {
    setTheme("light");
    assert.equal(getStoredTheme(), "light");
    assert.equal(localStorage.getItem("stim_app_theme"), "light");
  });

  it("resolveTheme passes through dark/light", () => {
    assert.equal(resolveTheme("dark"), "dark");
    assert.equal(resolveTheme("light"), "light");
  });

  it("resolveTheme resolves auto to a concrete theme", () => {
    const r = resolveTheme("auto");
    assert.ok(r === "dark" || r === "light");
  });

  it("applyTheme sets data-theme attribute", () => {
    applyTheme("dark");
    assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
    applyTheme("light");
    assert.equal(document.documentElement.getAttribute("data-theme"), "light");
  });

  it("applyTheme resolves auto before setting attribute", () => {
    const resolved = resolveTheme("auto");
    applyTheme("auto");
    assert.equal(document.documentElement.getAttribute("data-theme"), resolved);
  });

  it("applyTheme ignores invalid theme", () => {
    applyTheme("dark");
    applyTheme("hot-pink");
    assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
  });

  it("cycleTheme rotates dark → light → auto → dark", () => {
    setTheme("dark");
    cycleTheme();
    assert.equal(getStoredTheme(), "light");
    cycleTheme();
    assert.equal(getStoredTheme(), "auto");
    cycleTheme();
    assert.equal(getStoredTheme(), "dark");
  });

  it("setTheme rejects invalid values", () => {
    setTheme("dark");
    setTheme("invalid");
    assert.equal(getStoredTheme(), "dark");
  });
});
