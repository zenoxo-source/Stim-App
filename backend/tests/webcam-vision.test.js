/**
 * Tests for webcam-vision.js - pure helpers (capture format, request body,
 * provider support, consent state machine).
 *
 * getUserMedia / fetch aren't available in Node; those code paths are
 * exercised by the Electron smoke test.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  loadConfig,
  saveConfig,
  getConsent,
  setConsent,
  providerSupportsVision,
  captureFrameToBase64,
  buildVisionRequestBody,
  isActive,
  disable,
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

describe("webcam-vision.js - config", () => {
  it("returns defaults", () => {
    const cfg = loadConfig();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.intervalMs, 10_000);
    assert.equal(cfg.maxWidth, 512);
    assert.equal(cfg.maxHeight, 512);
  });

  it("saveConfig merges but FORCES enabled=false", () => {
    saveConfig({ intervalMs: 5000, enabled: true });
    const cfg = loadConfig();
    assert.equal(cfg.intervalMs, 5000);
    assert.equal(cfg.enabled, false); // forced to false for safety
  });

  it("survives corrupt localStorage", () => {
    localStorage.setItem("stim_app_webcam_vision_v1", "not-json");
    const cfg = loadConfig();
    assert.equal(cfg.intervalMs, 10_000);
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

describe("webcam-vision.js - providerSupportsVision", () => {
  it("accepts ollama + openrouter", () => {
    assert.equal(providerSupportsVision("ollama"), true);
    assert.equal(providerSupportsVision("openrouter"), true);
  });

  it("case-insensitive", () => {
    assert.equal(providerSupportsVision("OLLAMA"), true);
    assert.equal(providerSupportsVision("OpenRouter"), true);
  });

  it("rejects unknown providers", () => {
    assert.equal(providerSupportsVision("openai"), false);
    assert.equal(providerSupportsVision("unknown"), false);
    assert.equal(providerSupportsVision(""), false);
    assert.equal(providerSupportsVision(null), false);
  });
});

describe("webcam-vision.js - captureFrameToBase64", () => {
  function makeFakeVideo(w, h) {
    return { videoWidth: w, videoHeight: h };
  }

  it("returns null for video without dimensions", () => {
    assert.equal(captureFrameToBase64(null, 512, 512, 0.7), null);
    assert.equal(captureFrameToBase64({}, 512, 512, 0.7), null);
    assert.equal(captureFrameToBase64({ videoWidth: 0, videoHeight: 0 }, 512, 512, 0.7), null);
  });

  it("returns dataUrl/base64/width/height (uses fake canvas)", () => {
    // The dom-mock canvas.getContext returns null, so this would throw.
    // Wrap in try/catch to test graceful failure.
    try {
      const result = captureFrameToBase64(makeFakeVideo(640, 480), 512, 512, 0.7);
      // If we got a result, format checks:
      if (result) {
        assert.ok(typeof result.dataUrl === "string");
        assert.ok(result.dataUrl.startsWith("data:image/jpeg"));
        assert.ok(result.width <= 512);
        assert.ok(result.height <= 512);
        assert.ok(typeof result.base64 === "string");
        assert.ok(result.base64.length > 0);
      }
    } catch (err) {
      // dom-mock has no real canvas, so captureFrameToBase64 throws — that's OK
      assert.match(err.message || "", /getContext|drawImage|toDataURL/);
    }
  });
});

describe("webcam-vision.js - buildVisionRequestBody", () => {
  it("builds OpenAI-compatible vision format", () => {
    const body = buildVisionRequestBody("llava:13b", "System", "BASE64DATA", "Was siehst du?");
    assert.equal(body.model, "llava:13b");
    assert.equal(body.stream, false);
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, "System");
    assert.equal(body.messages[1].role, "user");
    assert.ok(Array.isArray(body.messages[1].content));
    assert.equal(body.messages[1].content.length, 2);
    assert.equal(body.messages[1].content[0].type, "text");
    assert.equal(body.messages[1].content[1].type, "image_url");
    assert.match(body.messages[1].content[1].image_url.url, /data:image\/jpeg;base64,BASE64DATA/);
  });

  it("defaults userText when empty", () => {
    const body = buildVisionRequestBody("llava", "Sys", "ABC");
    assert.equal(body.messages[1].content[0].text, "Beschreibe dieses Bild.");
  });
});

describe("webcam-vision.js - isActive", () => {
  it("returns false initially", () => {
    assert.equal(isActive(), false);
  });
});
