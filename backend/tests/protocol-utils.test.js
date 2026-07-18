/**
 * Node built-in test runner (node --test)
 * Pure protocol helpers without Electron/hardware.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ProtocolUtils = require(path.resolve(
  __dirname,
  "../../frontend/js/lib/protocol-utils.js"
));

describe("getDeviceStrength", () => {
  it("keeps logical value at master 100%", () => {
    assert.equal(ProtocolUtils.getDeviceStrength(100, 150, 1), 100);
  });

  it("scales output without clamping UI soft-limit incorrectly", () => {
    assert.equal(ProtocolUtils.getDeviceStrength(100, 150, 0.5), 50);
  });

  it("respects soft limit before scale", () => {
    assert.equal(ProtocolUtils.getDeviceStrength(200, 100, 1), 100);
    assert.equal(ProtocolUtils.getDeviceStrength(200, 100, 0.5), 50);
  });

  it("clamps negative and over 200 after scale", () => {
    assert.equal(ProtocolUtils.getDeviceStrength(-10, 150, 1), 0);
    assert.equal(ProtocolUtils.getDeviceStrength(200, 200, 2), 200);
  });
});

describe("scaleWaveAmp", () => {
  it("scales wave amplitude with master", () => {
    assert.equal(ProtocolUtils.scaleWaveAmp(100, 0.5), 50);
    assert.equal(ProtocolUtils.scaleWaveAmp(80, 1), 80);
  });

  it("clamps to 0-100", () => {
    assert.equal(ProtocolUtils.scaleWaveAmp(200, 1), 100);
    assert.equal(ProtocolUtils.scaleWaveAmp(-5, 1), 0);
  });
});

describe("buildEmergencyStopBytes", () => {
  it("builds a full inactive 0xB0 packet", () => {
    const p = ProtocolUtils.buildEmergencyStopBytes();
    assert.equal(p.length, 20);
    assert.equal(p[0], 0xb0);
    assert.equal(p[1], 0x0f);
    assert.equal(p[2], 0);
    assert.equal(p[3], 0);
    for (let i = 8; i <= 11; i++) assert.equal(p[i], 101);
    for (let i = 16; i <= 19; i++) assert.equal(p[i], 101);
  });
});

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    assert.equal(
      ProtocolUtils.escapeHtml(`<script>"x"&'y'</script>`),
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;"
    );
  });
});

describe("isCoyoteDeviceName", () => {
  it("matches known prefixes", () => {
    assert.equal(ProtocolUtils.isCoyoteDeviceName("47L121ABC"), true);
    assert.equal(ProtocolUtils.isCoyoteDeviceName("My Coyote Device"), true);
    assert.equal(ProtocolUtils.isCoyoteDeviceName("Random BLE"), false);
  });
});
