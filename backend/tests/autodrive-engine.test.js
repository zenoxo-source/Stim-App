import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  reduceAutodrive,
  computeAutodriveOutput,
  resolveChannelStrengths,
  sanitiseAutodriveConfig,
  AUTODRIVE_TEMPLATES,
  PLACEMENT_PROFILES,
  CLIMAX_WAVES,
  getPhaseLabel,
} from "../../frontend/js/lib/autodrive-engine.js";

const t0 = 1_000_000;

function classicCfg(extra = {}) {
  return sanitiseAutodriveConfig({
    templateId: "classic",
    skipCalibration: true,
    ...extra,
  });
}

describe("autodrive-engine", () => {
  it("sanitise applies classic template", () => {
    const c = sanitiseAutodriveConfig({ templateId: "classic" });
    assert.equal(c.goal, "edge_then_release");
    assert.equal(c.edgeCount, 2);
    assert.equal(c.allowClimaxPatterns, true);
  });

  it("has expanded template set and placement profiles", () => {
    assert.ok(AUTODRIVE_TEMPLATES.classic);
    assert.ok(AUTODRIVE_TEMPLATES.marathon);
    assert.ok(AUTODRIVE_TEMPLATES.turbo);
    assert.ok(AUTODRIVE_TEMPLATES.deny);
    assert.ok(PLACEMENT_PROFILES.soft_external);
    assert.ok(PLACEMENT_PROFILES.deep_pressure);
    assert.ok(PLACEMENT_PROFILES.dual);
    assert.ok(CLIMAX_WAVES.length >= 3);
  });

  it("placement deep_pressure caps strength below soft limit", () => {
    const soft = sanitiseAutodriveConfig({
      placement: "soft_external",
      maxSessionIntensityFactor: 1,
      sensitivity: "medium",
    });
    const deep = sanitiseAutodriveConfig({
      placement: "deep_pressure",
      maxSessionIntensityFactor: 1,
      sensitivity: "medium",
    });
    const rSoft = resolveChannelStrengths(1, soft, 100, 100);
    const rDeep = resolveChannelStrengths(1, deep, 100, 100);
    assert.ok(rDeep.strengthA < rSoft.strengthA);
  });

  it("resolveChannelStrengths respects per-channel caps and focus A", () => {
    const cfg = sanitiseAutodriveConfig({
      channelFocus: "A",
      coupledFraction: 0.3,
      sensitivity: "medium",
      maxSessionIntensityFactor: 1,
      placement: "soft_external",
    });
    // soft_external has strengthCap 0.9
    const r = resolveChannelStrengths(1, cfg, 80, 150);
    assert.ok(r.strengthA <= 80);
    assert.ok(r.strengthB <= 150);
  });

  it("asymmetric soft B cap on coupled channel", () => {
    const cfg = sanitiseAutodriveConfig({
      channelFocus: "A",
      coupledFraction: 0.3,
      sensitivity: "medium",
      maxSessionIntensityFactor: 1,
    });
    const r = resolveChannelStrengths(1, cfg, 150, 20);
    assert.ok(r.strengthB <= 20);
  });

  it("TEASE almost alone does not increment edge count", () => {
    let s = createInitialState(classicCfg(), t0);
    s = { ...s, phase: "TEASE", phaseDeadlineAt: t0 + 60000, edgeCountDone: 0 };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 100 });
    assert.equal(s.phase, "EDGE_HOLD");
    assert.equal(s.edgeCountDone, 0);
    assert.equal(s.holdCompletedThisVisit, false);
  });

  it("almost raises edge score", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "TEASE",
      phaseDeadlineAt: t0 + 999999,
      edgeScore: 10,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 100 });
    assert.ok(s.edgeScore >= 30);
  });

  it("completeEdge once per hold; classic target 2 then SURGE", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "TEASE",
      phaseDeadlineAt: t0 + 999999,
      edgeCountDone: 0,
      edgeCountTarget: 2,
      settleUntil: null,
    };

    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 1000 });
    assert.equal(s.phase, "EDGE_HOLD");
    assert.equal(s.edgeCountDone, 0);
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: s.phaseDeadlineAt });
    assert.equal(s.phase, "TEASE");
    assert.equal(s.edgeCountDone, 1);

    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: s.phaseStartedAt + 100 });
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: s.phaseDeadlineAt });
    assert.equal(s.edgeCountDone, 2);
    assert.equal(s.phase, "TEASE");

    const afterSettle = (s.settleUntil || 0) + 1;
    s = reduceAutodrive(s, { type: "TICK", nowMs: afterSettle });
    assert.equal(s.phase, "SURGE");
  });

  it("double completeEdge same visit only +1", () => {
    let s = createInitialState(classicCfg(), t0);
    s = reduceAutodrive(
      {
        ...s,
        phase: "TEASE",
        edgeCountDone: 0,
        phaseDeadlineAt: t0 + 999999,
      },
      { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 10 }
    );
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: s.phaseDeadlineAt });
    assert.equal(s.edgeCountDone, 1);
    s = {
      ...s,
      phase: "EDGE_HOLD",
      holdCompletedThisVisit: true,
      phaseDeadlineAt: t0 + 50000,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 20000 });
    assert.equal(s.edgeCountDone, 1);
  });

  it("re-edge after CLIMAX_PUSH not_yet", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      edgeCountDone: 1,
      edgeCountTarget: 2,
      holdCompletedThisVisit: true,
      relStrength: 0.9,
      phaseDeadlineAt: t0 + 60000,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "not_yet", nowMs: t0 + 1000 });
    assert.equal(s.phase, "EDGE_HOLD");
    assert.equal(s.holdCompletedThisVisit, false);
    assert.ok(s.relStrength <= 0.75);
    const before = s.edgeCountDone;
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: s.phaseDeadlineAt });
    assert.equal(s.edgeCountDone, before + 1);
  });

  it("PAUSE freezes and RESUME restores phase", () => {
    let s = createInitialState(classicCfg(), t0);
    s = { ...s, phase: "BUILD", phaseStartedAt: t0, phaseDeadlineAt: t0 + 10000 };
    s = reduceAutodrive(s, {
      type: "PAUSE",
      nowMs: t0 + 3000,
      strengthA: 40,
      strengthB: 40,
    });
    assert.equal(s.phase, "PAUSED");
    assert.equal(s.resumePhase, "BUILD");
    s = reduceAutodrive(s, { type: "RESUME", nowMs: t0 + 8000 });
    assert.equal(s.phase, "BUILD");
  });

  it("CLIMAX_PUSH timeout → AFTERCARE unmarked", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseDeadlineAt: t0 + 1000,
      userMarkedClimax: false,
      denyCount: 99,
      maxDenies: 0,
    };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 1000 });
    assert.equal(s.phase, "AFTERCARE");
    assert.equal(s.userMarkedClimax, false);
  });

  it("computeAutodriveOutput silences PAUSED", () => {
    let s = createInitialState(classicCfg(), t0);
    s = reduceAutodrive(s, { type: "PAUSE", nowMs: t0 + 100, strengthA: 10, strengthB: 10 });
    const out = computeAutodriveOutput(s, t0 + 200);
    assert.equal(out.silenced, true);
    assert.equal(out.patternId, null);
  });

  it("feedback bias persists across ticks", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      relStrength: 0.4,
      feedbackBias: 0,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "too_weak", nowMs: t0 + 1000 });
    assert.ok(s.feedbackBias > 0);
    for (let i = 0; i < 30; i++) {
      s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 2000 + i * 100 });
    }
    assert.ok(s.feedbackBias > 0);
  });

  it("calibration good locks sessionBaseline and advances", () => {
    let s = createInitialState(
      sanitiseAutodriveConfig({ templateId: "classic", skipCalibration: false }),
      t0
    );
    assert.equal(s.phase, "CALIBRATING");
    s = { ...s, relStrength: 0.2, phaseStartedAt: t0, phaseDeadlineAt: t0 + 20000 };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "good", nowMs: t0 + 500 });
    assert.equal(s.phase, "WARMUP");
    assert.equal(s.calibrated, true);
    assert.ok(s.sessionBaseline > 0);
  });

  it("output exposes sensation plane fields", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 60000,
      wireFreq: 55,
      wireFreqTarget: 60,
      dutyCycle: 0.7,
      edgeScore: 40,
      sessionBaseline: 0.15,
    };
    // tick to update plane
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    const out = computeAutodriveOutput(s, t0 + 100);
    assert.ok(out.wireFreq > 0);
    assert.ok(out.dutyCycle > 0);
    assert.ok(out.patternParams.dutyCycle != null);
    assert.equal(out.phaseLabel, getPhaseLabel(s.phase));
    assert.ok(typeof out.edgeScore === "number");
  });

  it("now jumps to CLIMAX_PUSH with multi-wave init", () => {
    let s = createInitialState(classicCfg(), t0);
    s = { ...s, phase: "TEASE", phaseDeadlineAt: t0 + 99999, relStrength: 0.5 };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "now", nowMs: t0 + 200 });
    assert.equal(s.phase, "CLIMAX_PUSH");
    assert.equal(s.climaxWaveIndex, 0);
    assert.ok(s.relStrength >= 0.8);
  });

  it("learning seed applies preferredBias", () => {
    const s = createInitialState(classicCfg(), t0, { preferredBias: 0.1, lastPeakRel: 0.7 });
    assert.ok(s.feedbackBias > 0.05);
  });

  it("deny template can re-enter hold after first push timeout", () => {
    let s = createInitialState(
      sanitiseAutodriveConfig({ templateId: "deny", skipCalibration: true }),
      t0
    );
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseDeadlineAt: t0 + 100,
      denyCount: 0,
      maxDenies: 1,
      userMarkedClimax: false,
    };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 100 });
    assert.equal(s.phase, "EDGE_HOLD");
    assert.equal(s.denyCount, 1);
  });

  it("high edgeScore on TEASE can enter EDGE_HOLD via tick", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "TEASE",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 999999,
      edgeScore: 75,
      edgeCountDone: 0,
      edgeCountTarget: 2,
      relStrength: 0.65,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.phase, "EDGE_HOLD");
  });

  it("good x2 sets peak lock", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 999999,
      relStrength: 0.45,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "good", nowMs: t0 + 100 });
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "good", nowMs: t0 + 2000 });
    assert.ok(s.peakLockRel != null);
    assert.ok(s.peakLockUntil > t0);
  });

  it("almost in CLIMAX_PUSH sets pushBoostRemaining", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 999999,
      relStrength: 0.9,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "almost", nowMs: t0 + 100 });
    assert.equal(s.pushBoostRemaining, 2);
    assert.equal(s.climaxInDrop, true);
  });

  it("schedules feedback prompt after nextPromptAt", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 999999,
      nextPromptAt: t0 + 50,
      pendingPrompt: null,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.pendingPrompt);
  });
});
