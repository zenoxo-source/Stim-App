/**
 * Tests for webcam-vision.js — local-only motion-energy biofeedback helpers.
 *
 * getUserMedia / video capture aren't available in Node; those paths are
 * exercised by the Electron smoke test. Here we cover the pure math:
 * config, consent, grayscale capture fallback, motion energy, delta mapping.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  loadConfig,
  saveConfig,
  getConsent,
  setConsent,
  captureGrayscale,
  motionEnergy,
  motionToDelta,
  isActive,
  disable,
  getMotionAvg,
} from "../../frontend/js/modules/webcam-vision.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  setConsent("not-asked");
  disable("test-setup");
});

describe("webcam-vision.js - config (local motion)", () => {
  it("returns defaults with a small grayscale sample size", () => {
    const cfg = loadConfig();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.intervalMs, 1000);
    assert.equal(cfg.sampleWidth, 64);
    assert.equal(cfg.sampleHeight, 48);
    assert.equal(cfg.motionFloor, 0.012);
    assert.equal(cfg.deltaCeil, 22);
  });

  it("saveConfig merges but FORCES enabled=false", () => {
    saveConfig({ intervalMs: 500, enabled: true });
    const cfg = loadConfig();
    assert.equal(cfg.intervalMs, 500);
    assert.equal(cfg.enabled, false); // forced to false for safety
  });

  it("survives corrupt localStorage", () => {
    localStorage.setItem("stim_app_webcam_motion_v1", "not-json");
    const cfg = loadConfig();
    assert.equal(cfg.intervalMs, 1000);
  });
});

describe("webcam-vision.js - consent state machine", () => {
  it("starts as not-asked", () => {
    assert.equal(getConsent(), "not-asked");
  });

  it("setConsent transitions", () => {
    setConsent("granted");
    assert.equal(getConsent(), "granted");
    setConsent("denied");
    assert.equal(getConsent(), "denied");
    setConsent("not-asked");
    assert.equal(getConsent(), "not-asked");
  });

  it("setConsent rejects invalid values", () => {
    setConsent("granted");
    setConsent("maybe");
    assert.equal(getConsent(), "granted"); // unchanged
  });
});

describe("webcam-vision.js - motionEnergy (pure)", () => {
  it("returns 0 for identical frames", () => {
    const a = new Uint8ClampedArray([10, 20, 30, 40]);
    assert.equal(motionEnergy(a, a), 0);
  });

  it("returns 0 for mismatched lengths or empty", () => {
    assert.equal(motionEnergy(null, null), 0);
    assert.equal(motionEnergy(new Uint8ClampedArray([1]), new Uint8ClampedArray([1, 2])), 0);
    assert.equal(motionEnergy(new Uint8ClampedArray([]), new Uint8ClampedArray([])), 0);
  });

  it("normalises mean absolute difference to 0..1", () => {
    // Max difference across 4 bytes: each differs by 255 → mean 255/255 = 1.
    const a = new Uint8ClampedArray([0, 0, 0, 0]);
    const b = new Uint8ClampedArray([255, 255, 255, 255]);
    assert.ok(Math.abs(motionEnergy(a, b) - 1) < 1e-9);

    // Half difference: mean abs diff 127.5 / 255 ≈ 0.5
    const c = new Uint8ClampedArray([0, 0]);
    const d = new Uint8ClampedArray([255, 0]);
    assert.ok(Math.abs(motionEnergy(c, d) - 127.5 / 255) < 1e-9);
  });
});

describe("webcam-vision.js - motionToDelta (pure)", () => {
  const cfg = {
    motionFloor: 0.02,
    motionCeil: 0.1,
    deltaFloor: -6,
    deltaCeil: 20,
  };

  it("maps motion at/below floor to deltaFloor", () => {
    assert.equal(motionToDelta(0, cfg), -6);
    assert.equal(motionToDelta(0.02, cfg), -6);
  });

  it("maps motion at/above ceil to deltaCeil", () => {
    assert.equal(motionToDelta(0.1, cfg), 20);
    assert.equal(motionToDelta(0.5, cfg), 20);
  });

  it("scales linearly in between and rounds", () => {
    const mid = motionToDelta(0.06, cfg); // midpoint
    assert.ok(mid > -6 && mid < 20);
    // Stillness must be negative (relax), strong motion positive (arousal).
    assert.ok(motionToDelta(0.03, cfg) < motionToDelta(0.09, cfg));
  });

  it("uses module defaults when cfg omitted", () => {
    assert.equal(typeof motionToDelta(0.5), "number");
  });
});

describe("webcam-vision.js - captureGrayscale fallback", () => {
  it("returns null for video without dimensions", () => {
    assert.equal(captureGrayscale(null, 64, 48), null);
    assert.equal(captureGrayscale({}, 64, 48), null);
    assert.equal(captureGrayscale({ videoWidth: 0, videoHeight: 0 }, 64, 48), null);
  });

  it("returns null gracefully when canvas ctx is unavailable (dom-mock)", () => {
    // dom-mock canvas.getContext returns null → helper must not throw.
    const res = captureGrayscale({ videoWidth: 320, videoHeight: 240 }, 64, 48);
    assert.equal(res, null);
  });

  it("works with an injected ctx that returns pixel data", () => {
    // Fake a 2×1 image: pixel (0,0)=white, (1,0)=mid-gray.
    const fakeCtx = {
      drawImage() {},
      getImageData() {
        return {
          data: new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 255]),
        };
      },
    };
    const res = captureGrayscale({ videoWidth: 2, videoHeight: 1 }, 2, 1, fakeCtx);
    assert.ok(res);
    assert.equal(res.width, 2);
    assert.equal(res.height, 1);
    assert.equal(res.gray.length, 2);
    assert.equal(res.gray[0], 255);
    assert.equal(res.gray[1], 128);
  });
});

describe("webcam-vision.js - lifecycle", () => {
  it("isActive is false initially and motion resets to 0", () => {
    assert.equal(isActive(), false);
    assert.equal(getMotionAvg(), 0);
  });
});
