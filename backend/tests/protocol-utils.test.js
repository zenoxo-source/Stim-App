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
    for (let i = 4; i <= 7; i++) assert.equal(p[i], 0);
    for (let i = 8; i <= 11; i++) assert.equal(p[i], 101);
    for (let i = 12; i <= 15; i++) assert.equal(p[i], 0);
    for (let i = 16; i <= 19; i++) assert.equal(p[i], 101);
  });
});

describe("applyPulseWidthScale", () => {
  it("scales amp by pulse width percent", () => {
    assert.equal(ProtocolUtils.applyPulseWidthScale(100, 50), 50);
    assert.equal(ProtocolUtils.applyPulseWidthScale(80, 100), 80);
    assert.equal(ProtocolUtils.applyPulseWidthScale(100, 0), 0);
  });
});

describe("resolveWaveSegment", () => {
  it("marks zero amp as inactive (freq 0, intensity 101)", () => {
    const s = ProtocolUtils.resolveWaveSegment(45, 0);
    assert.equal(s.freq, 0);
    assert.equal(s.intensity, 101);
  });

  it("clamps active segments", () => {
    const s = ProtocolUtils.resolveWaveSegment(45, 80);
    assert.equal(s.freq, 45);
    assert.equal(s.intensity, 80);
  });
});

describe("encodeWaveFreqLogical", () => {
  it("passes through 10–100", () => {
    assert.equal(ProtocolUtils.encodeWaveFreqLogical(45), 45);
    assert.equal(ProtocolUtils.encodeWaveFreqLogical(100), 100);
  });

  it("compresses mid and high ranges to wire 10–240", () => {
    assert.equal(ProtocolUtils.encodeWaveFreqLogical(350), 150); // (350-100)/5+100
    assert.equal(ProtocolUtils.encodeWaveFreqLogical(800), 220); // (800-600)/10+200
    assert.equal(ProtocolUtils.encodeWaveFreqLogical(1000), 240);
  });
});

describe("waveFreqLabel", () => {
  it("returns sensation labels not Hz claims", () => {
    assert.equal(ProtocolUtils.waveFreqLabel(45), "standard");
    assert.equal(ProtocolUtils.waveFreqLabel(240), "maximum");
  });
});

describe("buildSoftStopBytes", () => {
  it("keeps optional strength with inactive wave", () => {
    const p = ProtocolUtils.buildSoftStopBytes({ strengthA: 40, strengthB: 30, modeNibble: 0 });
    assert.equal(p[2], 40);
    assert.equal(p[3], 30);
    assert.equal(p[8], 101);
    assert.equal(p[16], 101);
    assert.equal(p[4], 0);
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

describe("master scale edge cases", () => {
  it("treats missing masterScale as 1", () => {
    assert.equal(ProtocolUtils.getDeviceStrength(80, 150, undefined), 80);
    assert.equal(ProtocolUtils.scaleWaveAmp(50, null), 50);
  });

  it("applies near-limit soft clamp before scale", () => {
    assert.equal(ProtocolUtils.getDeviceStrength(200, 100, 0.8), 80);
  });
});

describe("settings export/import", () => {
  it("exports without secrets and with format marker", () => {
    const exp = ProtocolUtils.buildSettingsExport(
      { softLimitA: 120, softLimitB: 90, masterScale: 0.5, swapChannels: true },
      { aiProvider: "openrouter", aiModel: "test-model" }
    );
    assert.equal(exp.format, "stim-app-settings");
    assert.equal(exp.settings.softLimitA, 120);
    assert.equal(exp.settings.masterScale, 0.5);
    assert.equal(exp.settings.aiProvider, "openrouter");
    assert.equal(exp.settings.aiApiKey, undefined);
  });

  it("imports and clamps values, strips secrets", () => {
    const raw = JSON.stringify({
      settings: {
        softLimitA: 999,
        softLimitB: 1,
        masterScale: 2,
        aiApiKey: "secret-should-drop",
        aiProvider: "ollama",
      },
    });
    const s = ProtocolUtils.parseSettingsImport(raw);
    assert.equal(s.softLimitA, 200);
    assert.equal(s.softLimitB, 10);
    assert.equal(s.masterScale, 1);
    assert.equal(s.aiApiKey, undefined);
    assert.equal(s.aiProvider, "ollama");
  });

  it("rejects invalid JSON", () => {
    assert.throws(() => ProtocolUtils.parseSettingsImport("not-json"), /JSON|Ungültig/i);
  });
});

describe("mergeHighscore", () => {
  it("updates only when score is higher", () => {
    const a = ProtocolUtils.mergeHighscore({}, "edge", 10);
    assert.equal(a.isNew, true);
    assert.equal(a.best, 10);
    const b = ProtocolUtils.mergeHighscore(a.store, "edge", 5);
    assert.equal(b.isNew, false);
    assert.equal(b.best, 10);
    const c = ProtocolUtils.mergeHighscore(b.store, "edge", 12);
    assert.equal(c.isNew, true);
    assert.equal(c.store.edge, 12);
  });
});
