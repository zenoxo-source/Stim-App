import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/dom-mock.js";
import {
  loadFlags,
  saveFlags,
  isFlagEnabled,
  FLAG_DEFAULTS,
} from "../../frontend/js/modules/feature-flags.js";

beforeEach(() => {
  localStorage.clear();
});

describe("feature-flags", () => {
  it("returns defaults when empty", () => {
    const f = loadFlags();
    assert.equal(f.autodrive, FLAG_DEFAULTS.autodrive);
    assert.equal(f.newNav, FLAG_DEFAULTS.newNav);
    assert.equal(f.navV4, true);
  });

  it("persists patch", () => {
    saveFlags({ outputOwnerStrict: true });
    assert.equal(isFlagEnabled("outputOwnerStrict"), true);
    assert.equal(isFlagEnabled("autodrive"), FLAG_DEFAULTS.autodrive);
  });

  it("ignores unknown keys", () => {
    saveFlags({ notAFlag: true });
    const f = loadFlags();
    assert.equal(f.notAFlag, undefined);
  });
});
