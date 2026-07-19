/**
 * Tests for tab-persistence.js.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  saveActiveTab,
  getSavedActiveTab,
  clearSavedActiveTab,
} from "../../frontend/js/modules/tab-persistence.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("tab-persistence.js", () => {
  it("returns null when nothing saved", () => {
    assert.equal(getSavedActiveTab(), null);
  });

  it("saves and retrieves", () => {
    saveActiveTab("deck");
    assert.equal(getSavedActiveTab(), "deck");
    saveActiveTab("settings");
    assert.equal(getSavedActiveTab(), "settings");
  });

  it("ignores empty/null values", () => {
    saveActiveTab("deck");
    saveActiveTab("");
    saveActiveTab(null);
    saveActiveTab(undefined);
    assert.equal(getSavedActiveTab(), "deck");
  });

  it("clears", () => {
    saveActiveTab("deck");
    clearSavedActiveTab();
    assert.equal(getSavedActiveTab(), null);
  });
});
