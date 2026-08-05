import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLIMAX_WAVES,
  CLIMAX_WAVES_FINISH,
  PUSH_RETRY,
  climaxWaveTable,
  pushRetryBudget,
  pushBoostForRetry,
  pushFloorRel,
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
    const hfo = sanitiseAutodriveConfig({ templateId: "hfo" });
    assert.equal(hfo.climaxCurve, "verzoegert");
    assert.equal(hfo.pushRetry, true);
    const classic = sanitiseAutodriveConfig({ templateId: "classic" });
    assert.equal(classic.climaxCurve, "none");
    assert.equal(classic.pushRetry, false);
    const tpl = AUTODRIVE_TEMPLATES.finish_loops;
    assert.equal(tpl.climaxCurve, "standard");
    assert.equal(tpl.pushRetry, true);
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
