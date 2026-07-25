import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/dom-mock.js";
import { AppState } from "../../frontend/js/state.js";
import {
  claimOutput,
  releaseOutput,
  getOutputOwner,
  forceReleaseAll,
  assertCanWrite,
  registerOwnerStop,
  unregisterOwnerStop,
} from "../../frontend/js/modules/output-owner.js";

beforeEach(() => {
  AppState.outputOwner = "none";
  localStorage.clear();
});

describe("output-owner", () => {
  it("claims and releases", () => {
    assert.equal(getOutputOwner(), "none");
    const r = claimOutput("manual");
    assert.equal(r.ok, true);
    assert.equal(getOutputOwner(), "manual");
    assert.equal(releaseOutput("manual"), true);
    assert.equal(getOutputOwner(), "none");
  });

  it("stop-hook on re-claim", () => {
    let stopped = false;
    registerOwnerStop("ramp", () => {
      stopped = true;
    });
    claimOutput("ramp");
    claimOutput("autodrive");
    assert.equal(stopped, true);
    assert.equal(getOutputOwner(), "autodrive");
    unregisterOwnerStop("ramp");
  });

  it("hard-rejects external writes under autodrive", () => {
    claimOutput("autodrive");
    assert.equal(assertCanWrite("external", { kind: "strength" }), false);
    assert.equal(assertCanWrite("wave-loop", { kind: "wave" }), true);
    assert.equal(assertCanWrite("safety", { kind: "strength" }), true);
    assert.equal(assertCanWrite("autodrive", { kind: "strength" }), true);
  });

  it("forceReleaseAll clears owner and runs hooks", () => {
    let n = 0;
    registerOwnerStop("game", () => {
      n += 1;
    });
    claimOutput("game");
    forceReleaseAll("test");
    assert.equal(getOutputOwner(), "none");
    assert.equal(n, 1);
    unregisterOwnerStop("game");
  });
});
