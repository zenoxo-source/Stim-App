import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  reduceAutodrive,
  computeAutodriveOutput,
  resolveChannelStrengths,
  sanitiseAutodriveConfig,
  AUTODRIVE_TEMPLATES,
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

  it("has expanded template set", () => {
    assert.ok(AUTODRIVE_TEMPLATES.classic);
    assert.ok(AUTODRIVE_TEMPLATES.quick_finish);
    assert.ok(AUTODRIVE_TEMPLATES.marathon);
    assert.ok(AUTODRIVE_TEMPLATES.turbo);
    assert.ok(AUTODRIVE_TEMPLATES.deny);
  });

  it("resolveChannelStrengths respects per-channel caps and focus A", () => {
    const cfg = sanitiseAutodriveConfig({
      channelFocus: "A",
      coupledFraction: 0.3,
      sensitivity: "medium",
      maxSessionIntensityFactor: 1,
    });
    const r = resolveChannelStrengths(1, cfg, 80, 150);
    assert.ok(r.strengthA <= 80);
    assert.ok(r.strengthB <= 150);
    assert.equal(r.strengthB, Math.min(150, Math.round(r.strengthA * 0.3)));
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

  it("feedback bias persists across ticks (envelope does not wipe)", () => {
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
    const afterFb = s.feedbackBias;
    assert.ok(afterFb > 0, "too_weak should raise bias");
    // many ticks
    for (let i = 0; i < 30; i++) {
      s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 2000 + i * 100 });
    }
    assert.ok(s.feedbackBias > 0, "bias should persist");
    assert.ok(s.relStrength > 0.35, "intensity should stay elevated");
  });

  it("too_strong lowers climb rate and comfort ceiling", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 600000,
      relStrength: 0.7,
      climbRate: 1,
      comfortCeiling: 0.95,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "too_strong", nowMs: t0 + 500 });
    assert.ok(s.climbRate < 1);
    assert.ok(s.comfortCeiling < 0.95);
    assert.ok(s.relStrength < 0.7);
  });

  it("now jumps to CLIMAX_PUSH from TEASE", () => {
    let s = createInitialState(classicCfg(), t0);
    s = { ...s, phase: "TEASE", phaseDeadlineAt: t0 + 99999, relStrength: 0.5 };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "now", nowMs: t0 + 200 });
    assert.equal(s.phase, "CLIMAX_PUSH");
    assert.ok(s.relStrength >= 0.8);
  });

  it("output exposes phase labels and remaining time", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "BUILD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 60000,
      effectiveElapsedMs: 60000,
      targetDurationMs: 12 * 60 * 1000,
    };
    const out = computeAutodriveOutput(s, t0 + 1000);
    assert.equal(out.phaseLabel, getPhaseLabel("BUILD"));
    assert.ok(out.remainingMs > 0);
    assert.ok(out.tip);
    assert.ok(out.patternId);
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
});
