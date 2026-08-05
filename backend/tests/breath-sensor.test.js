// breath-sensor.test.js — minimal coverage for the v6.3 breath signal export.
// (Mic capture / rAF paths are browser-only — exercised by the Electron smoke test.)
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import { isBreathSensorActive, getBreathState, stopBreathSensor } from "../../frontend/js/modules/breath-sensor.js";

beforeEach(() => {
  try {
    stopBreathSensor();
  } catch {
    /* ignore */
  }
});

describe("breath-sensor — v6.3 exports", () => {
  it("is inactive before start", () => {
    assert.equal(isBreathSensorActive(), false);
  });

  it("getBreathState returns a sane shape when inactive", () => {
    const s = getBreathState();
    assert.equal(typeof s.breathHeldMs, "number");
    assert.equal(typeof s.breathRate, "number");
    assert.ok(s.breathHeldMs >= 0);
    assert.ok(s.breathRate >= 0);
    // Inactive → no held breath, no rate.
    assert.equal(s.breathHeldMs, 0);
    assert.equal(s.breathRate, 0);
  });
});
