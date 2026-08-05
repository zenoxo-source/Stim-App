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
  COMMIT_AROUSAL_THRESHOLD,
  COMMIT_AROUSAL_CONFIDENCE,
  COMMIT_AROUSAL_SUSTAINED_MS,
  AUTO_CLIMAX_AROUSAL_THRESHOLD,
  climaxWaveTable,
  pushRetryBudget,
  pushBoostForRetry,
  pushFloorRel,
  commitThreshold,
  commitFromBiofeedback,
  autoClimaxSignal,
  adaptivePushExtensionMs,
  commitFromArousal,
  autoClimaxFromArousal,
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

describe("climax-protocol v6.3 — closed-loop arousal predicates", () => {
  it("commitFromArousal fires on sustained high arousal + confidence on finish", () => {
    assert.equal(
      commitFromArousal({
        arousal: COMMIT_AROUSAL_THRESHOLD,
        confidence: COMMIT_AROUSAL_CONFIDENCE,
        sustainedMs: COMMIT_AROUSAL_SUSTAINED_MS,
        climaxPriority: true,
        tooStrongRecent: false,
      }),
      true
    );
    // non-finish → never
    assert.equal(
      commitFromArousal({
        arousal: 1,
        confidence: 1,
        sustainedMs: 60000,
        climaxPriority: false,
        tooStrongRecent: false,
      }),
      false
    );
    // recent too_strong → never
    assert.equal(
      commitFromArousal({
        arousal: 1,
        confidence: 1,
        sustainedMs: 60000,
        climaxPriority: true,
        tooStrongRecent: true,
      }),
      false
    );
    // not sustained long enough
    assert.equal(
      commitFromArousal({
        arousal: COMMIT_AROUSAL_THRESHOLD,
        confidence: COMMIT_AROUSAL_CONFIDENCE,
        sustainedMs: COMMIT_AROUSAL_SUSTAINED_MS - 1,
        climaxPriority: true,
        tooStrongRecent: false,
      }),
      false
    );
    // low confidence → no (cold-start safety)
    assert.equal(
      commitFromArousal({
        arousal: 1,
        confidence: COMMIT_AROUSAL_CONFIDENCE - 0.1,
        sustainedMs: 60000,
        climaxPriority: true,
        tooStrongRecent: false,
      }),
      false
    );
  });

  it("autoClimaxFromArousal needs opt-in + commit + longer sustained plateau", () => {
    assert.equal(
      autoClimaxFromArousal({
        autoClimaxEnabled: true,
        commitActive: true,
        arousal: AUTO_CLIMAX_AROUSAL_THRESHOLD,
        confidence: COMMIT_AROUSAL_CONFIDENCE,
        sustainedMs: COMMIT_AROUSAL_SUSTAINED_MS + 2000,
      }),
      true
    );
    // consent gate
    assert.equal(
      autoClimaxFromArousal({
        autoClimaxEnabled: false,
        commitActive: true,
        arousal: 1,
        confidence: 1,
        sustainedMs: 60000,
      }),
      false
    );
    // needs longer plateau than commit (the +2000 ms)
    assert.equal(
      autoClimaxFromArousal({
        autoClimaxEnabled: true,
        commitActive: true,
        arousal: AUTO_CLIMAX_AROUSAL_THRESHOLD,
        confidence: COMMIT_AROUSAL_CONFIDENCE,
        sustainedMs: COMMIT_AROUSAL_SUSTAINED_MS,
      }),
      false
    );
    // not in commit
    assert.equal(
      autoClimaxFromArousal({
        autoClimaxEnabled: true,
        commitActive: false,
        arousal: 1,
        confidence: 1,
        sustainedMs: 60000,
      }),
      false
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

describe("autodrive engine v6.3 — closed-loop + passive + arousal", () => {
  function buildState(cfgPatch, now = t0) {
    let s = createInitialState(sanitiseAutodriveConfig({ ...cfgPatch, skipCalibration: true }), now);
    return s;
  }

  it("closed-loop backs off when arousal is high (BUILD setpoint 0.62)", () => {
    let s = buildState({ templateId: "finish_loops", closedLoop: true });
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      relStrength: 0.7,
      arousal: 0.9, // well above the BUILD setpoint
      arousalConfidence: 0.9,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.relStrength < 0.7, `high arousal should back off: ${s.relStrength}`);
  });

  it("closed-loop climbs when arousal is low", () => {
    let s = buildState({ templateId: "finish_loops", closedLoop: true });
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      relStrength: 0.5,
      arousal: 0.25, // below setpoint
      arousalConfidence: 0.9,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.relStrength > 0.5, `low arousal should climb: ${s.relStrength}`);
  });

  it("closed-loop falls back to gentle climb when confidence is low", () => {
    let s = buildState({ templateId: "finish_loops", closedLoop: true });
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      relStrength: 0.5,
      arousal: 0.9,
      arousalConfidence: 0.1, // untrusted → no aggressive steering
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.relStrength > 0.5 && s.relStrength < 0.56, "fallback tiny climb");
  });

  it("closed-loop steering is off by default (envelope, not controller)", () => {
    let s = buildState({ templateId: "finish_loops" });
    assert.equal(s.config.closedLoop, false);
    // At the BUILD baseline with very high arousal: the closed-loop controller
    // would crash relStrength (back off hard); with it OFF the envelope just
    // holds near baseline. So relStrength must NOT drop far.
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      relStrength: 0.3,
      arousal: 0.95,
      arousalConfidence: 0.9,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.relStrength > 0.2, `envelope held near baseline: ${s.relStrength}`);
  });

  it("passive mode enters EDGE_HOLD from sustained high arousal", () => {
    let s = buildState({ templateId: "finish_loops", passiveMode: true });
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      edgeCountTarget: 1,
      edgeCountDone: 0,
      // Strong, trustworthy bio signal → high fused arousal.
      lastHrDelta: 22,
      lastMotion: 0.1,
      lastBreathRate: 22,
      edgeScore: 90,
      arousal: 0.9, // seed so estimator smoothing keeps it high this tick
      arousalHighSince: t0 - 5000, // sustained long enough
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.phase, "EDGE_HOLD", "passive mode should enter edge hold");
  });

  it("passive mode starts the push when edges are done + very high arousal", () => {
    let s = buildState({ templateId: "finish_loops", passiveMode: true });
    s = {
      ...s,
      phase: "TEASE",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      edgeCountTarget: 1,
      edgeCountDone: 1,
      lastHrDelta: 24,
      lastMotion: 0.11,
      lastBreathHeldMs: 4000,
      edgeScore: 92,
      arousal: 0.94, // held-breath floor keeps fused ≥ 0.95; seed preserves it
      arousalHighSince: t0 - 6000,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.phase, "CLIMAX_PUSH", "passive mode should start the push");
  });

  it("passive mode does NOT act with low confidence (never guess)", () => {
    let s = buildState({ templateId: "finish_loops", passiveMode: true });
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      edgeCountTarget: 1,
      edgeCountDone: 0,
      // No bio signal at all → confidence low → must not transition. Keep
      // edgeScore below the manual edge-score guard (72) so only passive mode
      // could be responsible for a transition here.
      lastHrDelta: 0,
      lastMotion: 0,
      edgeScore: 60,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.phase, "BUILD");
  });

  it("arousal-based commit fires on sustained high fused arousal", () => {
    let s = buildState({ templateId: "finish_loops", silentCommit: true });
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 120000,
      relStrength: 0.9,
      edgeScore: 88,
      lastHrDelta: 22, // + edge → confidence ≥ 0.4 so the estimator trusts it
      lastMotion: 0.1,
      arousal: 0.9,
      arousalConfidence: 0.7,
      arousalHighSince: t0 - (COMMIT_AROUSAL_SUSTAINED_MS + 500),
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.commitMode, true, "sustained arousal should trigger commit");
  });

  it("opt-in auto-climax from sustained peak arousal marks the climax", () => {
    let s = buildState({ templateId: "finish_loops", autoClimax: true });
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 120000,
      relStrength: 0.95,
      edgeScore: 95,
      lastHrDelta: 24,
      lastMotion: 0.11,
      lastBreathHeldMs: 4000,
      commitMode: true,
      arousal: AUTO_CLIMAX_AROUSAL_THRESHOLD,
      arousalConfidence: 0.9,
      arousalHighSince: t0 - (COMMIT_AROUSAL_SUSTAINED_MS + 3000),
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.phase, "AFTERCARE");
    assert.equal(s.userMarkedClimax, true);
    assert.equal(s.autoClimaxMarked, true);
  });

  it("BIO_FEEDBACK accepts a rich payload (motion + breath)", () => {
    let s = buildState({ templateId: "finish_loops" });
    s = reduceAutodrive(s, {
      type: "BIO_FEEDBACK",
      hrDelta: 15,
      motion: 0.08,
      breathHeldMs: 3000,
      breathRate: 20,
      nowMs: t0 + 100,
    });
    assert.equal(s.lastHrDelta, 15);
    assert.equal(s.lastMotion, 0.08);
    assert.equal(s.lastBreathHeldMs, 3000);
    assert.equal(s.lastBreathRate, 20);
  });
});

describe("autodrive engine v6.4 — personal edge + weights + recovery", () => {
  function buildState(cfgPatch, now = t0) {
    return createInitialState(sanitiseAutodriveConfig({ ...cfgPatch, skipCalibration: true }), now);
  }

  it("a learned personal edge lowers the EDGE_HOLD controller setpoint", () => {
    // With personalEdge 0.7, a user at arousal 0.85 is OVER the edge → back off.
    let s = buildState({ templateId: "finish_loops", closedLoop: true });
    s = {
      ...s,
      phase: "EDGE_HOLD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 60000,
      relStrength: 0.75,
      arousal: 0.85,
      arousalConfidence: 0.9,
      personalEdgeArousal: 0.7,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.relStrength < 0.75, `over personal edge → back off: ${s.relStrength}`);

    // Same arousal but arousal BELOW the personal edge → climb.
    let s2 = buildState({ templateId: "finish_loops", closedLoop: true });
    s2 = {
      ...s2,
      phase: "EDGE_HOLD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 60000,
      relStrength: 0.6,
      arousal: 0.55,
      arousalConfidence: 0.9,
      personalEdgeArousal: 0.7,
    };
    s2 = reduceAutodrive(s2, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s2.relStrength > 0.6, `under personal edge → climb: ${s2.relStrength}`);
  });

  it("recovery window keeps the controller gentle after too_strong", () => {
    let s = buildState({ templateId: "finish_loops", closedLoop: true });
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      relStrength: 0.5,
      arousal: 0.2, // way under setpoint → would normally climb hard
      arousalConfidence: 0.9,
      recoveringUntil: t0 + 12000, // in recovery
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.relStrength < 0.55, `recovery must cap the climb: ${s.relStrength}`);
  });

  it("too_strong feedback arms the recovery window", () => {
    let s = buildState({ templateId: "finish_loops", closedLoop: true });
    s = { ...s, phase: "BUILD", phaseDeadlineAt: t0 + 600000, relStrength: 0.6 };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "too_strong", nowMs: t0 + 100 });
    assert.ok(s.recoveringUntil > t0 + 100, "recovery window must be armed");
  });

  it("'almost' captures the arousal sample into state", () => {
    let s = buildState({ templateId: "finish_loops" });
    s = { ...s, phase: "TEASE", phaseDeadlineAt: t0 + 600000, arousal: 0.78 };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 100 });
    assert.ok(s.arousalAtLastAlmost > 0.7, `almost must capture arousal: ${s.arousalAtLastAlmost}`);
  });

  it("learned signal weights bias the fused arousal toward the weighted channel", () => {
    // HR weighted to 1, others 0 → arousal ≈ hr-normalised regardless of others.
    let s = buildState({ templateId: "finish_loops", closedLoop: true });
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      lastHrDelta: 20,
      lastMotion: 0.0, // motion says "nothing" but weight 0 ignores it
      edgeScore: 0,
      signalWeights: { hr: 1, motion: 0, breathHeld: 0, breathRate: 0, edgeScore: 0 },
      arousal: 0.8, // seed so smoothing keeps it high
      arousalConfidence: 0.9,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    // Arousal should track hr (≈0.8 from delta 20), not be dragged down by motion/edge.
    assert.ok(s.arousal > 0.7, `weights should let hr dominate: ${s.arousal}`);
  });
});
