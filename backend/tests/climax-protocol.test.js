import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLIMAX_WAVES,
  CLIMAX_WAVES_FINISH,
  CLIMAX_WAVES_COMMIT,
  PUSH_RETRY,
  COMMIT_ALMOST_THRESHOLD,
  COMMIT_EDGE_SCORE_MIN,
  COMMIT_HR_SUSTAINED_MS,
  COMMIT_HR_SPIKE_DELTA,
  climaxWaveTable,
  pushRetryBudget,
  pushBoostForRetry,
  pushFloorRel,
  commitThreshold,
  commitFromBiofeedback,
  autoClimaxSignal,
  adaptivePushExtensionMs,
} from "../../frontend/js/lib/climax-protocol.js";
import {
  createInitialState,
  reduceAutodrive,
  sanitiseAutodriveConfig,
  AUTODRIVE_TEMPLATES,
} from "../../frontend/js/lib/autodrive-engine.js";

const t0 = 1_000_000;

describe("climax-protocol", () => {
  it("finish wave table has shorter drops and a long final crest", () => {
    assert.equal(CLIMAX_WAVES.length, 4);
    assert.equal(CLIMAX_WAVES_FINISH.length, 4);
    const classic = CLIMAX_WAVES.reduce((a, w) => a + w.dropMs, 0);
    const finish = CLIMAX_WAVES_FINISH.reduce((a, w) => a + w.dropMs, 0);
    assert.ok(finish < classic, "finish path drops less total time");
    assert.ok(
      CLIMAX_WAVES_FINISH[CLIMAX_WAVES_FINISH.length - 1].crestMs >= 20000,
      "final crest is long"
    );
  });

  it("climaxWaveTable picks the finish table when climaxPriority is on", () => {
    assert.equal(climaxWaveTable({ climaxPriority: true }), CLIMAX_WAVES_FINISH);
    assert.equal(climaxWaveTable({ climaxPriority: false }), CLIMAX_WAVES);
    assert.equal(climaxWaveTable(undefined), CLIMAX_WAVES);
  });

  it("pushRetryBudget is bounded and disabled unless enabled", () => {
    assert.deepEqual(pushRetryBudget({}), { enabled: false, maxRetries: 0 });
    assert.deepEqual(pushRetryBudget({ pushRetry: true }), {
      enabled: true,
      maxRetries: PUSH_RETRY.maxRetries,
    });
    assert.equal(PUSH_RETRY.maxRetries, 2);
  });

  it("pushBoostForRetry scales with the retry number", () => {
    assert.equal(pushBoostForRetry(0), 0);
    assert.equal(pushBoostForRetry(1), 1);
    assert.equal(pushBoostForRetry(2), 2);
  });

  it("pushFloorRel starts at floor and rises per retry, capped", () => {
    assert.equal(pushFloorRel({}, 0), PUSH_RETRY.floorRel);
    assert.ok(pushFloorRel({}, 1) > pushFloorRel({}, 0));
    assert.ok(pushFloorRel({}, 99) <= 0.72);
  });
});

describe("autodrive push-retry (Abspritzgarantie)", () => {
  function pushState(cfg, now = t0) {
    let s = createInitialState(sanitiseAutodriveConfig({ ...cfg, skipCalibration: true }), now);
    return {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: now,
      phaseDeadlineAt: now + 60000,
      relStrength: 0.9,
    };
  }

  it("finish templates enable climaxCurve + pushRetry; classic stays unchanged", () => {
    const finish = sanitiseAutodriveConfig({ templateId: "finish_loops" });
    assert.equal(finish.climaxCurve, "standard");
    assert.equal(finish.pushRetry, true);
    assert.equal(finish.silentCommit, true);
    const hfo = sanitiseAutodriveConfig({ templateId: "hfo" });
    assert.equal(hfo.climaxCurve, "verzoegert");
    assert.equal(hfo.pushRetry, true);
    assert.equal(hfo.silentCommit, true);
    const classic = sanitiseAutodriveConfig({ templateId: "classic" });
    assert.equal(classic.climaxCurve, "none");
    assert.equal(classic.pushRetry, false);
    assert.equal(classic.silentCommit, false);
    const tpl = AUTODRIVE_TEMPLATES.finish_loops;
    assert.equal(tpl.climaxCurve, "standard");
    assert.equal(tpl.pushRetry, true);
  });

  it("v6.2 new templates exist and wire silentCommit correctly", () => {
    const intense = sanitiseAutodriveConfig({ templateId: "finish_intense" });
    assert.equal(intense.silentCommit, true);
    assert.equal(intense.climaxCurve, "kurz");
    assert.equal(intense.goal, "direct");
    const internal = sanitiseAutodriveConfig({ templateId: "finish_internal" });
    assert.equal(internal.silentCommit, true);
    assert.equal(internal.climaxCurve, "verzoegert");
    assert.equal(internal.placement, "insertable");
    const marathon = sanitiseAutodriveConfig({ templateId: "loops_marathon" });
    assert.equal(marathon.silentCommit, false);
    assert.equal(marathon.edgeCount, 5);
    assert.equal(marathon.goal, "edge_ladder");
    assert.ok(AUTODRIVE_TEMPLATES.finish_intense, "template registered");
    assert.ok(AUTODRIVE_TEMPLATES.finish_internal, "template registered");
    assert.ok(AUTODRIVE_TEMPLATES.loops_marathon, "template registered");
  });

  it("an unmarked push timeout with pushRetry re-arms TEASE instead of ending", () => {
    let s = pushState({ templateId: "finish_loops" });
    // Force a timeout: deadline in the past.
    s = { ...s, phaseDeadlineAt: t0 - 1 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 });
    assert.equal(s.phase, "TEASE");
    assert.equal(s.pushRetriesUsed, 1);
    assert.ok(s.relStrength < 0.5, "re-arm drops intensity");
  });

  it("without pushRetry an unmarked push timeout ends in AFTERCARE", () => {
    let s = pushState({ templateId: "classic" });
    s = { ...s, phaseDeadlineAt: t0 - 1 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 });
    assert.equal(s.phase, "AFTERCARE");
    assert.equal(s.userMarkedClimax, false);
  });

  it("push retry is bounded: after max retries it ends in AFTERCARE", () => {
    let s = pushState({ templateId: "finish_loops" });
    // First timeout → TEASE retry 1
    s = { ...s, phaseDeadlineAt: t0 - 1 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 });
    assert.equal(s.phase, "TEASE");
    assert.equal(s.pushRetriesUsed, 1);

    // Re-enter push (via SURGE) → retry boost granted
    s = { ...s, phase: "SURGE", phaseDeadlineAt: t0 + 60000, relStrength: 0.7 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 2000 });
    assert.equal(s.phase, "CLIMAX_PUSH");
    assert.ok(s.pushBoostRemaining >= 1, "retry push carries extra boost");

    // Second timeout → TEASE retry 2
    s = { ...s, phaseDeadlineAt: t0 + 2001 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 3000 });
    assert.equal(s.phase, "TEASE");
    assert.equal(s.pushRetriesUsed, 2);

    // Third push also times out → budget exhausted → AFTERCARE
    s = { ...s, phase: "SURGE", phaseDeadlineAt: t0 + 90000, relStrength: 0.7 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 5000 });
    assert.equal(s.phase, "CLIMAX_PUSH");
    s = { ...s, phaseDeadlineAt: t0 + 5001 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 6000 });
    assert.equal(s.phase, "AFTERCARE");
    assert.equal(s.pushRetriesUsed, 2);
  });

  it("too_strong in a finish push is floored, never kills the drive", () => {
    let s = pushState({ templateId: "finish_loops" });
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "too_strong", nowMs: t0 + 1000 });
    assert.equal(s.phase, "CLIMAX_PUSH");
    assert.ok(s.relStrength >= pushFloorRel(s.config, 0), `rel ${s.relStrength} below floor`);
  });

  it("classic push too_strong still drops normally (no floor)", () => {
    let s = pushState({ templateId: "classic" });
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "too_strong", nowMs: t0 + 1000 });
    assert.ok(s.relStrength < 0.9);
  });
});

describe("climax-protocol v6.2 — silent commit + biofeedback", () => {
  it("CLIMAX_WAVES_COMMIT is a single long crest with no drops", () => {
    assert.equal(CLIMAX_WAVES_COMMIT.length, 1);
    const wave = CLIMAX_WAVES_COMMIT[0];
    assert.equal(wave.dropMs, 0, "commit wave has no drop");
    assert.ok(wave.crestMs >= 20000, "commit crest is a long hold");
    assert.ok(wave.peakBoost > 0, "commit wave peaks high");
  });

  it("climaxWaveTable picks COMMIT table when commitMode is on", () => {
    assert.equal(climaxWaveTable({ commitMode: true }), CLIMAX_WAVES_COMMIT);
    assert.equal(climaxWaveTable({ climaxPriority: true }), CLIMAX_WAVES_FINISH);
    assert.equal(climaxWaveTable({ climaxPriority: false }), CLIMAX_WAVES);
  });

  it("commitThreshold fires only on finish paths with repeated almost + no too_strong", () => {
    assert.equal(
      commitThreshold({
        almostWithoutClimax: COMMIT_ALMOST_THRESHOLD,
        tooStrongRecent: false,
        edgeScore: COMMIT_EDGE_SCORE_MIN,
        climaxPriority: true,
      }),
      true
    );
    // no climaxPriority → never
    assert.equal(
      commitThreshold({
        almostWithoutClimax: 5,
        tooStrongRecent: false,
        edgeScore: 95,
        climaxPriority: false,
      }),
      false
    );
    // recent too_strong → never override
    assert.equal(
      commitThreshold({
        almostWithoutClimax: 5,
        tooStrongRecent: true,
        edgeScore: 95,
        climaxPriority: true,
      }),
      false
    );
    // too few almost
    assert.equal(
      commitThreshold({
        almostWithoutClimax: COMMIT_ALMOST_THRESHOLD - 1,
        tooStrongRecent: false,
        edgeScore: 95,
        climaxPriority: true,
      }),
      false
    );
    // edge score too low
    assert.equal(
      commitThreshold({
        almostWithoutClimax: 5,
        tooStrongRecent: false,
        edgeScore: COMMIT_EDGE_SCORE_MIN - 1,
        climaxPriority: true,
      }),
      false
    );
  });

  it("commitFromBiofeedback requires a sustained HR spike on a finish path", () => {
    assert.equal(
      commitFromBiofeedback({
        hrDelta: COMMIT_HR_SPIKE_DELTA,
        sustainedMs: COMMIT_HR_SUSTAINED_MS,
        climaxPriority: true,
        tooStrongRecent: false,
      }),
      true
    );
    // not sustained long enough
    assert.equal(
      commitFromBiofeedback({
        hrDelta: COMMIT_HR_SPIKE_DELTA,
        sustainedMs: COMMIT_HR_SUSTAINED_MS - 1,
        climaxPriority: true,
        tooStrongRecent: false,
      }),
      false
    );
    // too_strong blocks
    assert.equal(
      commitFromBiofeedback({
        hrDelta: 30,
        sustainedMs: 60000,
        climaxPriority: true,
        tooStrongRecent: true,
      }),
      false
    );
  });

  it("autoClimaxSignal only fires with opt-in + commit + sustained max", () => {
    assert.equal(
      autoClimaxSignal({
        autoClimaxEnabled: true,
        commitActive: true,
        edgeScore: 90,
        hrDelta: COMMIT_HR_SPIKE_DELTA,
        sustainedPeakMs: COMMIT_HR_SUSTAINED_MS,
      }),
      true
    );
    // opt-out → never (consent gate)
    assert.equal(
      autoClimaxSignal({
        autoClimaxEnabled: false,
        commitActive: true,
        edgeScore: 100,
        hrDelta: 40,
        sustainedPeakMs: 60000,
      }),
      false
    );
    // not in commit → never
    assert.equal(
      autoClimaxSignal({
        autoClimaxEnabled: true,
        commitActive: false,
        edgeScore: 100,
        hrDelta: 40,
        sustainedPeakMs: 60000,
      }),
      false
    );
  });

  it("adaptivePushExtensionMs grows with almost + retries and is bounded", () => {
    const none = adaptivePushExtensionMs({});
    assert.equal(none, 0);
    const few = adaptivePushExtensionMs({ almostWithoutClimax: 2, retries: 1 });
    assert.ok(few > 0);
    // capped: 5+ almost and max retries should not explode beyond 5*18000 + 2*12000
    const capped = adaptivePushExtensionMs({ almostWithoutClimax: 99, retries: 99 });
    const maxExpected = 5 * 18000 + 2 * 12000;
    assert.ok(capped <= maxExpected, `capped exceeded: ${capped}`);
    // more almost → more extension
    assert.ok(
      adaptivePushExtensionMs({ almostWithoutClimax: 3 }) >
        adaptivePushExtensionMs({ almostWithoutClimax: 1 })
    );
  });
});

describe("autodrive engine v6.2 — silent commit + biofeedback integration", () => {
  const COMMIT_ALMOST = COMMIT_ALMOST_THRESHOLD;

  function pushState(cfg, now = t0) {
    let s = createInitialState(sanitiseAutodriveConfig({ ...cfg, skipCalibration: true }), now);
    return {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: now,
      phaseDeadlineAt: now + 120000,
      relStrength: 0.9,
      edgeScore: 80,
      commitMode: false,
    };
  }

  it("commitMode stays off when climaxPriority is false (non-finish session)", () => {
    let s = pushState({ templateId: "classic", climaxPriority: false });
    s.almostWithoutClimax = COMMIT_ALMOST;
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.commitMode, false);
  });

  it("repeated 'almost' without climax flips commitMode on a finish template", () => {
    let s = pushState({ templateId: "finish_loops" });
    // Two "almost" responses land during the push.
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 1000 });
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 3000 });
    assert.ok(s.almostWithoutClimax >= COMMIT_ALMOST);
    // Next TICK evaluates the commit decision.
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 4000 });
    assert.equal(s.commitMode, true, "commit mode should engage");
    assert.ok(s.dutyCycle >= 0.95, "commit pins duty high");
  });

  it("a recent too_strong blocks commit (never override the user)", () => {
    let s = pushState({ templateId: "finish_loops" });
    s.almostWithoutClimax = COMMIT_ALMOST + 2;
    s.edgeScore = 90;
    s.lastTooStrongAt = t0 + 500; // recent
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 1000 });
    assert.equal(s.commitMode, false);
  });

  it("commit mode resets when leaving CLIMAX_PUSH", () => {
    let s = pushState({ templateId: "finish_loops" });
    s.almostWithoutClimax = COMMIT_ALMOST;
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 1000 });
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 2000 });
    assert.equal(s.commitMode, true);
    // Climax → aftercare: commit must clear.
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "climaxed", nowMs: t0 + 3000 });
    assert.equal(s.phase, "AFTERCARE");
    assert.equal(s.commitMode, false);
  });

  it("BIO_FEEDBACK sustains and triggers commit via HR spike", () => {
    let s = pushState({ templateId: "finish_loops" });
    // Feed a strong HR delta for long enough (≥ COMMIT_HR_SUSTAINED_MS).
    const start = t0;
    for (let k = 0; k <= Math.ceil(COMMIT_HR_SUSTAINED_MS / 2000) + 1; k++) {
      const now = start + k * 2000;
      s = reduceAutodrive(s, { type: "BIO_FEEDBACK", hrDelta: 18, nowMs: now });
      s = reduceAutodrive(s, { type: "TICK", nowMs: now + 100 });
      if (s.commitMode) break;
    }
    assert.equal(s.commitMode, true, "sustained HR spike should engage commit");
    assert.ok(s.lastHrDelta >= 12);
  });

  it("a transient HR spike (not sustained) does NOT trigger commit", () => {
    let s = pushState({ templateId: "finish_loops" });
    s = reduceAutodrive(s, { type: "BIO_FEEDBACK", hrDelta: 30, nowMs: t0 + 1000 });
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 1100 });
    // Spike disappears immediately.
    s = reduceAutodrive(s, { type: "BIO_FEEDBACK", hrDelta: 2, nowMs: t0 + 3000 });
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 3100 });
    assert.equal(s.commitMode, false);
  });

  it("autoClimax stays off by default (consent gate)", () => {
    const cfg = sanitiseAutodriveConfig({ templateId: "finish_loops" });
    assert.equal(cfg.autoClimax, false);
    assert.equal(cfg.silentCommit, true);
  });

  it("autoClimax opt-in marks a climax during sustained commit + HR spike", () => {
    let s = pushState({ templateId: "finish_loops", autoClimax: true });
    // Force commit mode on manually (via repeated almost).
    s.almostWithoutClimax = COMMIT_ALMOST;
    s.edgeScore = 92;
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 1000 });
    assert.equal(s.commitMode, true);
    // Sustained HR spike + max edge score long enough → auto-mark climax.
    for (let k = 0; k <= Math.ceil(COMMIT_HR_SUSTAINED_MS / 2000) + 1; k++) {
      const now = t0 + 2000 + k * 2000;
      s = reduceAutodrive(s, { type: "BIO_FEEDBACK", hrDelta: 20, nowMs: now });
      s = reduceAutodrive(s, { type: "TICK", nowMs: now + 100 });
      if (s.phase !== "CLIMAX_PUSH") break;
    }
    assert.equal(s.phase, "AFTERCARE");
    assert.equal(s.userMarkedClimax, true);
    assert.equal(s.autoClimaxMarked, true);
  });

  it("without autoClimax opt-in, sustained commit + spike does NOT mark climax", () => {
    let s = pushState({ templateId: "finish_loops", autoClimax: false });
    s.almostWithoutClimax = COMMIT_ALMOST;
    s.edgeScore = 95;
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 1000 });
    assert.equal(s.commitMode, true);
    for (let k = 0; k <= Math.ceil(COMMIT_HR_SUSTAINED_MS / 2000) + 1; k++) {
      const now = t0 + 2000 + k * 2000;
      s = reduceAutodrive(s, { type: "BIO_FEEDBACK", hrDelta: 25, nowMs: now });
      s = reduceAutodrive(s, { type: "TICK", nowMs: now + 100 });
    }
    assert.equal(s.phase, "CLIMAX_PUSH", "session must not auto-end without opt-in");
    assert.equal(s.userMarkedClimax, false);
  });
});
