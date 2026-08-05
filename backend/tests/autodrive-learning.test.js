// autodrive-learning.test.js — the cross-session adaptation maths.
//
// These formulas decide how autodrive behaves over weeks, and a sign error
// here shows up as "sessions feel slightly wrong" rather than as a crash.
// The engine's per-session maths lives in autodrive-engine.test.js.
import "./helpers/dom-mock.js";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { applyDebrief, getLastSessionSnapshot } from "../../frontend/js/modules/autodrive.js";
import {
  recordExperimentOutcome,
  pickStrategyFromExperiments,
  getExperimentSummary,
  EXPERIMENT_MIN_SESSIONS,
} from "../../frontend/js/modules/autodrive.js";

const LEARN_KEY = "stim_app_autodrive_learn_v1";
const LAST_SESSION_KEY = "stim_app_autodrive_last_session_v1";

function setLearning(obj) {
  localStorage.setItem(LEARN_KEY, JSON.stringify(obj));
}

function getLearning() {
  return JSON.parse(localStorage.getItem(LEARN_KEY) || "{}");
}

/** Pretend a session just ended, marked or unmarked. */
function setLastSession({ marked, endedAt = Date.now() }) {
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ marked, endedAt }));
  return endedAt;
}

function reset() {
  localStorage.removeItem(LEARN_KEY);
  localStorage.removeItem(LAST_SESSION_KEY);
}

describe("applyDebrief — climax accounting", () => {
  beforeEach(reset);

  test("counts a climax that was only reported in the debrief", () => {
    // Regression: the session went unmarked, so climaxHits stayed flat and
    // climaxRate under-reported the run.
    setLearning({ sessions: 4, climaxHits: 1, climaxRate: 0.25 });
    setLastSession({ marked: false });

    const out = applyDebrief({ climax: "yes" });

    assert.equal(out.climaxHits, 2, "debrief-only climax must be counted");
    assert.equal(out.climaxRate, 0.5, "rate must be recomputed");
    assert.equal(out.debriefYes, 1);
  });

  test("does not double-count a session already marked mid-run", () => {
    setLearning({ sessions: 4, climaxHits: 2, climaxRate: 0.5 });
    setLastSession({ marked: true });

    const out = applyDebrief({ climax: "yes" });

    assert.equal(out.climaxHits, 2, "already counted at stop time");
    assert.equal(out.climaxRate, 0.5);
    assert.equal(out.debriefYes, 1, "the debrief answer is still recorded");
  });

  test("re-submitting the same debrief does not count twice", () => {
    setLearning({ sessions: 4, climaxHits: 1, climaxRate: 0.25 });
    setLastSession({ marked: false, endedAt: 12345 });

    const first = applyDebrief({ climax: "yes" });
    assert.equal(first.climaxHits, 2);

    const second = applyDebrief({ climax: "yes" });
    assert.equal(second.climaxHits, 2, "same session must not be counted again");
  });

  test("a later unmarked session is counted again", () => {
    setLearning({ sessions: 4, climaxHits: 1 });
    setLastSession({ marked: false, endedAt: 1000 });
    applyDebrief({ climax: "yes" });

    // Next session ends unmarked as well
    setLastSession({ marked: false, endedAt: 2000 });
    const out = applyDebrief({ climax: "yes" });

    assert.equal(out.climaxHits, 3, "a new session id unlocks counting again");
  });

  test("survives a missing session snapshot", () => {
    setLearning({ sessions: 1, climaxHits: 0 });
    localStorage.removeItem(LAST_SESSION_KEY);
    assert.doesNotThrow(() => applyDebrief({ climax: "yes" }));
    assert.equal(getLastSessionSnapshot(), null);
  });

  test("does not divide by zero when no session was recorded", () => {
    setLearning({ sessions: 0, climaxHits: 0 });
    setLastSession({ marked: false });
    const out = applyDebrief({ climax: "yes" });
    assert.ok(
      out.climaxRate === undefined || Number.isFinite(out.climaxRate),
      `climaxRate must stay finite, got ${out.climaxRate}`
    );
  });

  test("'no' and 'almost' never increase the hit count", () => {
    setLearning({ sessions: 4, climaxHits: 1 });
    setLastSession({ marked: false });

    assert.equal(applyDebrief({ climax: "no" }).climaxHits, 1);
    assert.equal(applyDebrief({ climax: "almost" }).climaxHits, 1);
  });
});

describe("applyDebrief — bias adjustment", () => {
  beforeEach(reset);

  test("'weak' raises the bias", () => {
    setLearning({ preferredBias: 0 });
    const out = applyDebrief({ overall: "weak" });
    assert.ok(out.preferredBias > 0, `expected an increase, got ${out.preferredBias}`);
  });

  test("'strong' lowers the bias", () => {
    setLearning({ preferredBias: 0.1 });
    const out = applyDebrief({ overall: "strong" });
    assert.ok(out.preferredBias < 0.1, `expected a decrease, got ${out.preferredBias}`);
  });

  test("'ok' leaves the bias alone", () => {
    setLearning({ preferredBias: 0.07 });
    const out = applyDebrief({ overall: "ok" });
    assert.equal(out.preferredBias, 0.07);
  });

  test("bias is clamped to the documented range", () => {
    // Repeated "weak" answers must not walk the bias past its ceiling.
    setLearning({ preferredBias: 0.19 });
    for (let i = 0; i < 20; i++) applyDebrief({ overall: "weak" });
    assert.ok(getLearning().preferredBias <= 0.2, `upper clamp broken: ${getLearning().preferredBias}`);

    setLearning({ preferredBias: -0.14 });
    for (let i = 0; i < 20; i++) applyDebrief({ overall: "strong" });
    assert.ok(
      getLearning().preferredBias >= -0.15,
      `lower clamp broken: ${getLearning().preferredBias}`
    );
  });

  test("'almost' nudges the bias up slightly", () => {
    setLearning({ preferredBias: 0 });
    const out = applyDebrief({ climax: "almost" });
    assert.ok(out.preferredBias > 0 && out.preferredBias < 0.05, `got ${out.preferredBias}`);
  });

  test("an empty debrief changes nothing but the timestamp", () => {
    setLearning({ preferredBias: 0.08, sessions: 3, climaxHits: 1 });
    const out = applyDebrief({});
    assert.equal(out.preferredBias, 0.08);
    assert.equal(out.sessions, 3);
    assert.equal(out.climaxHits, 1);
    assert.ok(out.lastDebriefAt > 0);
  });

  test("'weak' arms the soft-limit coach without changing limits", () => {
    setLearning({ preferredBias: 0 });
    const out = applyDebrief({ overall: "weak" });
    assert.equal(out.softLimitCoachPending, true, "coach is a suggestion, never automatic");
  });

  test("persists across calls", () => {
    setLearning({ preferredBias: 0 });
    applyDebrief({ overall: "weak" });
    const reloaded = getLearning();
    assert.ok(reloaded.preferredBias > 0, "the patch must reach localStorage");
  });
});

describe("v6.4 A/B experiment — pure helpers", () => {
  test("recordExperimentOutcome accumulates per strategy", () => {
    let exp = null;
    exp = recordExperimentOutcome(exp, "closed", { marked: true, durationMs: 600000, tooStrong: 2 });
    exp = recordExperimentOutcome(exp, "closed", { marked: false, durationMs: 300000, tooStrong: 4 });
    exp = recordExperimentOutcome(exp, "open", { marked: true, durationMs: 700000, tooStrong: 1 });
    assert.equal(exp.closed.sessions, 2);
    assert.equal(exp.closed.climaxes, 1);
    assert.equal(exp.closed.tooStrong, 6);
    assert.equal(exp.open.sessions, 1);
    assert.equal(exp.open.climaxes, 1);
    assert.ok(exp.closed.timeToClimaxSum > 0, "climax duration recorded");
  });

  test("pickStrategyFromExperiments stays null until both buckets have ≥3 sessions", () => {
    let exp = {};
    for (let i = 0; i < EXPERIMENT_MIN_SESSIONS - 1; i++) {
      exp = recordExperimentOutcome(exp, "closed", { marked: true, durationMs: 1000, tooStrong: 0 });
      exp = recordExperimentOutcome(exp, "open", { marked: false, durationMs: 1000, tooStrong: 0 });
    }
    assert.equal(pickStrategyFromExperiments(exp), null, "too little data");
    exp = recordExperimentOutcome(exp, "closed", { marked: true, durationMs: 1000, tooStrong: 0 });
    exp = recordExperimentOutcome(exp, "open", { marked: false, durationMs: 1000, tooStrong: 0 });
    assert.ok(["closed", "open"].includes(pickStrategyFromExperiments(exp)));
  });

  test("picks the strategy with the better climax rate", () => {
    let exp = {};
    // open: 0/3 → open is bad
    // closed: 3/3 → closed is good
    for (let i = 0; i < 3; i++) {
      exp = recordExperimentOutcome(exp, "open", { marked: false, durationMs: 1000, tooStrong: 0 });
      exp = recordExperimentOutcome(exp, "closed", { marked: true, durationMs: 1000, tooStrong: 0 });
    }
    assert.equal(pickStrategyFromExperiments(exp), "closed");
  });

  test("tie-breaks by fewer too_strong episodes", () => {
    let exp = {};
    for (let i = 0; i < 3; i++) {
      exp = recordExperimentOutcome(exp, "closed", { marked: true, durationMs: 1000, tooStrong: 6 });
      exp = recordExperimentOutcome(exp, "open", { marked: true, durationMs: 1000, tooStrong: 1 });
    }
    assert.equal(pickStrategyFromExperiments(exp), "open", "same rate → fewer too_strong wins");
  });

  test("getExperimentSummary renders buckets + pick", () => {
    let exp = {};
    for (let i = 0; i < 3; i++) {
      exp = recordExperimentOutcome(exp, "closed", { marked: true, durationMs: 60000, tooStrong: 1 });
    }
    const sum = getExperimentSummary(exp);
    assert.equal(sum.closed.sessions, 3);
    assert.equal(sum.closed.climaxRate, 100);
    assert.equal(sum.open, null);
    assert.ok(["closed", "open", null].includes(sum.pick));
  });
});
