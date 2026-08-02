// pattern-engine.js — Named pattern waveform samples (shared with Autodrive).
// Pure computation: one tick of a named pattern → { fA, aA, fB, aB }.
// Split from control-deck.js so the wave-loop file stays focused on playback.

import { AppState, CONSTANTS } from "../state.js";

/**
 * Compute one tick of a named pattern waveform.
 * @param {string} patternId
 * @param {number} loopCounter
 * @returns {{ fA: number, aA: number, fB: number, aB: number }}
 */
export function computeNamedPatternWave(patternId, loopCounter) {
  let fA = AppState.frequencyA;
  let aA = 0;
  let fB = AppState.frequencyB;
  let aB = 0;
  const t = loopCounter || 0;

  switch (patternId) {
    case CONSTANTS.PATTERNS.GENTLE:
    case "gentle":
      fA = 45;
      fB = 45;
      aA = Math.round(40 + 40 * Math.sin(t * 0.3));
      aB = Math.round(40 + 40 * Math.cos(t * 0.3));
      break;
    case CONSTANTS.PATTERNS.RHYTHM:
    case "rhythm": {
      const cycleIndex = t % 12;
      fA = 35;
      fB = 35;
      if (cycleIndex === 0) {
        aA = 100;
        aB = 0;
      } else if (cycleIndex === 1) {
        aA = 50;
        aB = 0;
      } else if (cycleIndex === 3) {
        aA = 0;
        aB = 100;
      } else if (cycleIndex === 4) {
        aA = 0;
        aB = 50;
      }
      break;
    }
    case CONSTANTS.PATTERNS.TEASE:
    case "tease": {
      const cycleIndex = t % 60;
      if (cycleIndex < 20) {
        fA = Math.round(45 + cycleIndex * 5);
        fB = fA;
        aA = Math.round(cycleIndex * 5);
        aB = aA;
      }
      break;
    }
    case CONSTANTS.PATTERNS.CLIMAX:
    case "climax":
      fA = Math.round(60 + 50 * Math.sin(t * 0.4));
      fB = Math.round(60 + 50 * Math.cos(t * 0.4));
      aA = Math.round(70 + 30 * Math.sin(t * 1.5));
      aB = Math.round(70 + 30 * Math.cos(t * 1.5));
      break;
    case CONSTANTS.PATTERNS.STROBE:
    case "strobe": {
      const on = t % 2 === 0;
      fA = 60;
      fB = 60;
      aA = on ? 100 : 0;
      aB = on ? 100 : 0;
      break;
    }
    case CONSTANTS.PATTERNS.WAVE:
    case "wave": {
      const sweep = t % 80;
      const tt = sweep / 80;
      const span = CONSTANTS.MAX_FREQUENCY - CONSTANTS.MIN_FREQUENCY;
      fA = Math.round(CONSTANTS.MIN_FREQUENCY + span * Math.sin(tt * Math.PI));
      // B trails A by a quarter turn. Past tt=0.75 that pushes the argument
      // beyond π, where sin() goes negative — clamp so the sweep bottoms out
      // at the minimum instead of running to a negative wire frequency.
      fB = Math.round(CONSTANTS.MIN_FREQUENCY + span * Math.sin(tt * Math.PI + Math.PI / 4));
      fA = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fA));
      fB = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fB));
      aA = 70;
      aB = 70;
      break;
    }
    case CONSTANTS.PATTERNS.HEARTBEAT:
    case "heartbeat": {
      const cycle60 = t % 10;
      fA = 45;
      fB = 45;
      if (cycle60 === 0) {
        aA = 90;
        aB = 70;
      } else if (cycle60 === 1) {
        aA = 30;
        aB = 20;
      } else if (cycle60 === 3) {
        aA = 70;
        aB = 90;
      } else if (cycle60 === 4) {
        aA = 20;
        aB = 30;
      }
      break;
    }
    case CONSTANTS.PATTERNS.ALTERNATE:
    case "alternate": {
      const altIdx = t % 6;
      fA = 50;
      fB = 50;
      if (altIdx < 3) {
        aA = 80;
        aB = 0;
      } else {
        aA = 0;
        aB = 80;
      }
      break;
    }
    case CONSTANTS.PATTERNS.ESCALATE:
    case "escalate": {
      const escCycle = t % 35;
      fA = 50;
      fB = 50;
      if (escCycle < 30) {
        aA = Math.round((escCycle / 30) * 100);
        aB = aA;
      }
      break;
    }
    case CONSTANTS.PATTERNS.FLUTTER:
    case "flutter": {
      const flutIdx = t % 2;
      fA = 80;
      fB = 80;
      aA = flutIdx === 0 ? 100 : 0;
      aB = flutIdx === 0 ? 80 : 0;
      break;
    }
    case CONSTANTS.PATTERNS.DRIFT:
    case "drift": {
      const dt = t * 0.02;
      fA = Math.round(80 + 60 * Math.sin(dt * 0.7) * Math.cos(dt * 0.3));
      fB = Math.round(80 + 60 * Math.cos(dt * 0.5) * Math.sin(dt * 0.4));
      fA = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fA));
      fB = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fB));
      aA = Math.round(50 + 40 * Math.sin(dt * 0.6));
      aB = Math.round(50 + 40 * Math.cos(dt * 0.6));
      break;
    }
    case CONSTANTS.PATTERNS.SAWTOOTH:
    case "sawtooth": {
      const sawCycle = t % 20;
      fA = 50;
      fB = 55;
      aA = Math.round((sawCycle / 20) * 100);
      aB = Math.round(((20 - sawCycle) / 20) * 100);
      break;
    }
    case CONSTANTS.PATTERNS.DUET:
    case "duet": {
      const duetT = t * 0.15;
      fA = Math.round(60 + 30 * Math.sin(duetT));
      fB = Math.round(60 + 30 * Math.cos(duetT));
      aA = Math.round(60 + 35 * Math.sin(duetT * 1.5));
      aB = Math.round(60 + 35 * Math.cos(duetT * 1.5));
      break;
    }
    default:
      fA = 45;
      fB = 45;
      aA = 60;
      aB = 60;
  }
  return { fA, aA, fB, aB };
}
