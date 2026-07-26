import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  derivePlacementFromSetup,
  buildWiringChecklist,
  getSetupPreset,
  listSetupPresets,
  WIRING_MODES,
} from "../../frontend/js/lib/estim-setup.js";
import { sanitiseAutodriveConfig, resolveChannelStrengths } from "../../frontend/js/lib/autodrive-engine.js";

describe("estim-setup", () => {
  it("has penis loop presets", () => {
    assert.ok(listSetupPresets().length >= 5);
    assert.ok(getSetupPreset("loops_ab_classic"));
    assert.equal(getSetupPreset("loops_ab_classic").wiringMode, "independent_4");
  });

  it("derives loops_ab_penis for dual shaft loops", () => {
    const p = derivePlacementFromSetup({
      electrodeKind: "loops",
      wiringMode: "independent_4",
      siteB2: "glans",
      balanceB: 85,
    });
    assert.equal(p, "loops_ab_penis");
  });

  it("wiring checklist mentions both channels for independent_4", () => {
    const lines = buildWiringChecklist({
      wiringMode: "independent_4",
      siteA1: "base",
      siteA2: "mid",
      siteB1: "corona",
      siteB2: "glans",
    });
    assert.ok(lines.some((l) => /Kanal A/.test(l)));
    assert.ok(lines.some((l) => /Kanal B/.test(l)));
  });

  it("common_3 wiring has a warning", () => {
    assert.ok(WIRING_MODES.common_3.warn);
  });

  it("balanceB reduces channel B strength", () => {
    const full = sanitiseAutodriveConfig({
      placement: "loops_ab_penis",
      balanceB: 100,
      sensitivity: "medium",
      maxSessionIntensityFactor: 1,
      channelFocus: "both",
    });
    const cut = sanitiseAutodriveConfig({
      placement: "loops_ab_penis",
      balanceB: 50,
      sensitivity: "medium",
      maxSessionIntensityFactor: 1,
      channelFocus: "both",
    });
    const rFull = resolveChannelStrengths(1, full, 100, 100);
    const rCut = resolveChannelStrengths(1, cut, 100, 100);
    assert.ok(rCut.strengthB < rFull.strengthB);
    assert.equal(rCut.strengthA, rFull.strengthA);
  });
});
