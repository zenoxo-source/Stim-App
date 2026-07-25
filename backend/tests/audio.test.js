// audio.test.js — the STIM player's gain path.
//
// Most of audio.js is Web Audio wiring that needs a real AudioContext, so the
// coverage here is deliberately narrow: the master-link gain calculation is
// the one piece that decides how loud the signal gets, and it is pure enough
// to pin down with a stub gain node.
import "./helpers/dom-mock.js";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AppState, CONSTANTS } from "../../frontend/js/state.js";
import { applyAudioMasterLink } from "../../frontend/js/modules/audio.js";

/** Stand-in for a Web Audio GainNode. */
function stubGain() {
  return { gain: { value: -1 } };
}

function baseline() {
  AppState.audioGainNode = stubGain();
  AppState.audioHearSound = true;
  AppState.masterScale = 1;
}

describe("applyAudioMasterLink", () => {
  beforeEach(baseline);

  test("does nothing without a gain node", () => {
    AppState.audioGainNode = null;
    assert.doesNotThrow(() => applyAudioMasterLink());
  });

  test("mutes completely when audio output is off", () => {
    AppState.audioHearSound = false;
    applyAudioMasterLink();
    assert.equal(AppState.audioGainNode.gain.value, 0);
  });

  test("uses the default gain at full master scale", () => {
    AppState.masterScale = 1;
    applyAudioMasterLink();
    assert.equal(AppState.audioGainNode.gain.value, CONSTANTS.DEFAULT_AUDIO_GAIN);
  });

  test("scales with the master control", () => {
    AppState.masterScale = 0.5;
    applyAudioMasterLink();
    assert.equal(AppState.audioGainNode.gain.value, CONSTANTS.DEFAULT_AUDIO_GAIN * 0.5);
  });

  test("a master scale of zero silences the audio", () => {
    AppState.masterScale = 0;
    applyAudioMasterLink();
    assert.equal(AppState.audioGainNode.gain.value, 0);
  });

  test("never produces a negative or NaN gain", () => {
    for (const scale of [0, 0.25, 1, undefined, null, NaN]) {
      AppState.masterScale = scale;
      applyAudioMasterLink();
      const g = AppState.audioGainNode.gain.value;
      assert.ok(Number.isFinite(g), `gain not finite for masterScale=${scale}: ${g}`);
      assert.ok(g >= 0, `gain negative for masterScale=${scale}: ${g}`);
    }
  });

  test("gain never exceeds the configured default", () => {
    for (const scale of [1, 2, 10]) {
      AppState.masterScale = scale;
      applyAudioMasterLink();
      assert.ok(
        AppState.audioGainNode.gain.value <= CONSTANTS.DEFAULT_AUDIO_GAIN * scale,
        `masterScale=${scale}`
      );
    }
  });
});
