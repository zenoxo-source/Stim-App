import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/dom-mock.js";
import {
  sanitiseStimConfig,
  STIM_DEFAULTS,
  processAudioToStim,
  resetStimSmoothing,
} from "../../frontend/js/modules/stim-player.js";
import { AppState } from "../../frontend/js/state.js";

function fakeAnalyser(peak = 64) {
  // peak 64 = mid silence-ish; 200 = loud
  const fftSize = 256;
  return {
    fftSize,
    frequencyBinCount: fftSize / 2,
    getByteTimeDomainData(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = peak;
    },
    getByteFrequencyData(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = i === 10 ? 200 : 10;
    },
  };
}

describe("stim-player", () => {
  it("sanitise clamps and swaps inverted ranges", () => {
    const c = sanitiseStimConfig({
      strengthMin: 90,
      strengthMax: 20,
      freqMin: 100,
      freqMax: 30,
      freqMode: "with_intensity",
      channelMode: "mono_sum",
    });
    assert.ok(c.strengthMin <= c.strengthMax);
    assert.ok(c.freqMin <= c.freqMax);
    assert.equal(c.freqMode, "with_intensity");
    assert.equal(c.channelMode, "mono_sum");
  });

  it("defaults include strengthDrive", () => {
    assert.equal(STIM_DEFAULTS.strengthDrive, true);
  });

  it("processAudioToStim returns bounded outputs", () => {
    AppState.softLimitA = 100;
    AppState.softLimitB = 100;
    resetStimSmoothing();
    const out = processAudioToStim(fakeAnalyser(200), fakeAnalyser(200), {
      ...STIM_DEFAULTS,
      smoothing: 0,
      strengthMin: 10,
      strengthMax: 80,
    });
    assert.ok(out.aA >= 0 && out.aA <= 100);
    assert.ok(out.strengthA >= 0 && out.strengthA <= 100);
    assert.ok(out.fA >= 10 && out.fA <= 240);
  });

  it("gate zeroes low noise", () => {
    AppState.softLimitA = 150;
    AppState.softLimitB = 150;
    resetStimSmoothing();
    const out = processAudioToStim(fakeAnalyser(128), fakeAnalyser(128), {
      ...STIM_DEFAULTS,
      smoothing: 0,
      gateThreshold: 0.05,
      sensitivityA: 1,
      sensitivityB: 1,
    });
    // 128 = silence in time domain (centered)
    assert.equal(out.levelA, 0);
  });
});
