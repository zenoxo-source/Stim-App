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
  estimateWireFreqEnvelope,
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
    assert.ok(PLACEMENT_PROFILES.perineum_combo);
    assert.ok(PLACEMENT_PROFILES.insertable);
    assert.ok(PLACEMENT_PROFILES.loops_ab_penis);
    assert.ok(PLACEMENT_PROFILES.loops_ab_glans_hot);
    assert.ok(AUTODRIVE_TEMPLATES.loops_classic);
    assert.ok(AUTODRIVE_TEMPLATES.loops_glans);
    assert.ok(CLIMAX_WAVES.length >= 3);
    for (const p of Object.values(PLACEMENT_PROFILES)) {
      assert.ok(p.setupMale && p.setupFemale, `${p.id} needs body setup text`);
      assert.ok(p.strengthCap > 0 && p.strengthCap <= 1, `${p.id} cap`);
      assert.ok(Array.isArray(p.tips) && p.tips.length >= 1, `${p.id} tips`);
    }
  });

  it("loops A+B penis template pins placement and abRole", () => {
    const c = sanitiseAutodriveConfig({ templateId: "loops_classic" });
    assert.equal(c.placement, "loops_ab_penis");
    assert.equal(c.abRole, "aRhythm_bSteady");
    assert.equal(c.channelFocus, "both");
    assert.ok(c.maxSessionIntensityFactor <= 0.92);
  });

  it("estimateWireFreqEnvelope reflects placement bias and stays in wire range", () => {
    const soft = estimateWireFreqEnvelope({ placement: "soft_external" });
    const loops = estimateWireFreqEnvelope({ placement: "loops_ab_glans_hot" });
    assert.ok(soft.lo >= 10 && soft.hi <= 240);
    assert.ok(loops.hi >= soft.hi, "higher freqBias placement peaks higher");
    assert.ok(loops.hi > 120);
  });

  it("finish_loops template enables climaxPriority and single edge", () => {
    const c = sanitiseAutodriveConfig({ templateId: "finish_loops" });
    assert.equal(c.climaxPriority, true);
    assert.equal(c.edgeCount, 1);
    assert.equal(c.allowClimaxPatterns, true);
    assert.equal(c.placement, "loops_ab_penis");
    assert.ok(AUTODRIVE_TEMPLATES.finish_glans);
    assert.ok(AUTODRIVE_TEMPLATES.finish_pads);
  });

  it("climaxPriority keeps too_strong in CLIMAX_PUSH", () => {
    let s = createInitialState(
      sanitiseAutodriveConfig({ templateId: "finish_loops", skipCalibration: true }),
      t0
    );
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 60000,
      relStrength: 0.9,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "too_strong", nowMs: t0 + 1000 });
    assert.equal(s.phase, "CLIMAX_PUSH");
    assert.ok(s.relStrength < 0.9);
  });

  it("climaxPriority push lasts longer than classic push", () => {
    // Short sessions so neither path hits the hard duration cap.
    let finish = createInitialState(
      sanitiseAutodriveConfig({
        templateId: "finish_loops",
        skipCalibration: true,
        targetDurationMin: 5,
      }),
      t0
    );
    finish = {
      ...finish,
      phase: "TEASE",
      phaseDeadlineAt: t0 + 99999,
      relStrength: 0.5,
    };
    finish = reduceAutodrive(finish, { type: "FEEDBACK", feedback: "now", nowMs: t0 + 500 });
    assert.equal(finish.phase, "CLIMAX_PUSH");
    const finishLen = (finish.phaseDeadlineAt || 0) - (finish.phaseStartedAt || 0);

    let classic = createInitialState(classicCfg({ targetDurationMin: 5 }), t0);
    classic = {
      ...classic,
      phase: "TEASE",
      phaseDeadlineAt: t0 + 99999,
      relStrength: 0.5,
    };
    classic = reduceAutodrive(classic, { type: "FEEDBACK", feedback: "now", nowMs: t0 + 500 });
    assert.equal(classic.phase, "CLIMAX_PUSH");
    const classicLen = (classic.phaseDeadlineAt || 0) - (classic.phaseStartedAt || 0);
    assert.ok(finishLen > classicLen, `finish ${finishLen} vs classic ${classicLen}`);
  });

  it("insertable placement is the most conservative strength cap", () => {
    const soft = sanitiseAutodriveConfig({
      placement: "soft_external",
      maxSessionIntensityFactor: 1,
      sensitivity: "medium",
    });
    const ins = sanitiseAutodriveConfig({
      placement: "insertable",
      maxSessionIntensityFactor: 1,
      sensitivity: "medium",
    });
    const rSoft = resolveChannelStrengths(1, soft, 100, 100);
    const rIns = resolveChannelStrengths(1, ins, 100, 100);
    assert.ok(rIns.strengthA < rSoft.strengthA);
    assert.ok(rIns.strengthA <= 78);
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

  it("single_channel_2 zeros unused channel (focus A)", () => {
    const cfg = sanitiseAutodriveConfig({
      wiringMode: "single_channel_2",
      channelFocus: "A",
      placement: "deep_pressure",
      abRole: "aRhythm_bSteady",
      sensitivity: "medium",
      maxSessionIntensityFactor: 1,
    });
    assert.equal(cfg.abRole, "sync");
    assert.equal(cfg.coupledFraction, 0);
    assert.equal(cfg.channelFocus, "A");
    const r = resolveChannelStrengths(1, cfg, 100, 100);
    assert.ok(r.strengthA > 0);
    assert.equal(r.strengthB, 0);
  });

  it("single_channel_2 focus B zeros channel A", () => {
    const cfg = sanitiseAutodriveConfig({
      wiringMode: "single_channel_2",
      channelFocus: "B",
      placement: "deep_pressure",
      sensitivity: "medium",
      maxSessionIntensityFactor: 1,
    });
    const r = resolveChannelStrengths(1, cfg, 100, 100);
    assert.equal(r.strengthA, 0);
    assert.ok(r.strengthB > 0);
  });

  it("single_channel_2 forces both channelMode (no alt)", () => {
    let s = createInitialState(
      sanitiseAutodriveConfig({
        templateId: "loops_single",
        wiringMode: "single_channel_2",
        channelFocus: "A",
        skipCalibration: true,
      }),
      t0
    );
    s = { ...s, phase: "TEASE", phaseDeadlineAt: t0 + 60000, loopCounter: 10 };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.channelMode, "both");
  });

  it("finish_loops_single / loops_single templates exist", () => {
    assert.ok(AUTODRIVE_TEMPLATES.loops_single);
    assert.ok(AUTODRIVE_TEMPLATES.finish_loops_single);
    const c = sanitiseAutodriveConfig({ templateId: "finish_loops_single" });
    assert.equal(c.placement, "deep_pressure");
    assert.equal(c.channelFocus, "A");
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

  it("nudge_up raises intensity", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "BUILD",
      phaseDeadlineAt: t0 + 999999,
      relStrength: 0.4,
    };
    s = reduceAutodrive(s, { type: "FEEDBACK", feedback: "nudge_up", nowMs: t0 + 100 });
    assert.ok(s.relStrength > 0.4);
  });

  it("time pressure shortens long tease near end of session", () => {
    let s = createInitialState(classicCfg(), t0);
    s = {
      ...s,
      phase: "TEASE",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 120000,
      effectiveElapsedMs: 0.85 * s.targetDurationMs,
      targetDurationMs: s.targetDurationMs,
      edgeCountDone: 2,
      edgeCountTarget: 2,
      lastTickAt: t0,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    // either surged or deadline shortened
    assert.ok(s.phase === "SURGE" || s.phaseDeadlineAt < t0 + 120000);
  });
});

describe("autodrive-engine — Climax-Fabrik (F1)", () => {
  it("hfo + climax_factory templates exist and wire the new config", () => {
    assert.ok(AUTODRIVE_TEMPLATES.hfo);
    assert.ok(AUTODRIVE_TEMPLATES.climax_factory);
    const hfo = sanitiseAutodriveConfig({ templateId: "hfo" });
    assert.equal(hfo.goal, "hfo");
    assert.equal(hfo.freqFullBand, true);
    assert.equal(hfo.edgeLoops, true);
    assert.equal(hfo.edgeCycleTarget, 3);
    assert.equal(hfo.climaxTarget, 1);
    const cf = sanitiseAutodriveConfig({ templateId: "climax_factory" });
    assert.equal(cf.climaxTarget, 2);
    assert.equal(cf.edgeCycleTarget, 2);
  });

  it("sanitise clamps climaxTarget and edgeCycleTarget", () => {
    const c = sanitiseAutodriveConfig({ climaxTarget: 9, edgeCycleTarget: -3, freqFullBand: true });
    assert.equal(c.climaxTarget, 3);
    assert.equal(c.edgeCycleTarget, 0);
    assert.equal(c.freqFullBand, true);
  });

  it("raw values win unless the template pins them (template-first convention)", () => {
    // classic template pins none of the new fields → raw values apply.
    const c = sanitiseAutodriveConfig({
      templateId: "classic",
      edgeLoops: true,
      edgeCycleTarget: 2,
      climaxTarget: 2,
    });
    assert.equal(c.edgeLoops, true);
    assert.equal(c.edgeCycleTarget, 2);
    assert.equal(c.climaxTarget, 2);
  });

  it("fullband keeps wireFreq in wire range while logical target is 10–1000", () => {
    let s = createInitialState(
      sanitiseAutodriveConfig({ templateId: "hfo", skipCalibration: true }),
      t0
    );
    s = { ...s, phase: "CLIMAX_PUSH", phaseDeadlineAt: t0 + 999999, loopCounter: 5 };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.ok(s.logicalFreqTarget >= 10 && s.logicalFreqTarget <= 1000);
    assert.ok(s.wireFreq >= 10 && s.wireFreq <= 240);
  });

  it("edgeLoops runs rise/hold/drop cadence and advances cycles", () => {
    const cfg = sanitiseAutodriveConfig({
      templateId: "hfo",
      skipCalibration: true,
      edgeLoops: true,
    });
    let s = createInitialState(cfg, t0);
    s = {
      ...s,
      phase: "EDGE_HOLD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 999999,
      holdCycleIdx: 0,
      holdCyclePhase: "rise",
      holdCycleT0: t0,
      relStrength: 0.55,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 2000 });
    assert.equal(s.holdCyclePhase, "rise");
    assert.ok(s.relStrength > 0.55 && s.relStrength <= 0.75);
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 14000 });
    assert.equal(s.holdCyclePhase, "hold");
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 40000 });
    assert.equal(s.holdCyclePhase, "drop");
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 50000 });
    assert.equal(s.holdCycleIdx, 1);
    assert.equal(s.holdCyclePhase, "rise");
  });

  it("edgeLoops auto-completes the edge after edgeCycleTarget cycles", () => {
    const cfg = classicCfg({
      edgeLoops: true,
      edgeCycleTarget: 2,
    });
    let s = createInitialState(cfg, t0);
    s = {
      ...s,
      phase: "EDGE_HOLD",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 999999,
      holdCycleIdx: 2,
      holdCyclePhase: "rise",
      holdCycleT0: t0,
      edgeCountDone: 0,
      edgeCountTarget: 1,
      holdCompletedThisVisit: false,
    };
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 100 });
    assert.equal(s.edgeCountDone, 1);
    assert.notEqual(s.phase, "EDGE_HOLD");
  });

  it("multi-climax: marked push → COOLDOWN → next BUILD, then final AFTERCARE", () => {
    const cfg = sanitiseAutodriveConfig({
      templateId: "climax_factory",
      skipCalibration: true,
    });
    let s = createInitialState(cfg, t0);
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: t0,
      phaseDeadlineAt: t0 + 999999,
      userMarkedClimax: true,
      climaxCount: 0,
      relStrength: 0.9,
    };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 200000 });
    assert.equal(s.phase, "COOLDOWN");
    assert.equal(s.climaxCount, 1);
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: s.phaseDeadlineAt });
    assert.equal(s.phase, "BUILD");
    s = {
      ...s,
      phase: "CLIMAX_PUSH",
      phaseStartedAt: t0 + 400000,
      phaseDeadlineAt: t0 + 999999,
      userMarkedClimax: true,
      climaxCount: 1,
      relStrength: 0.9,
    };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: t0 + 500000 });
    assert.equal(s.phase, "AFTERCARE");
    assert.equal(s.climaxCount, 2);
  });

  it("single-climax sessions keep old behavior (COOLDOWN → idle)", () => {
    const cfg = classicCfg();
    let s = createInitialState(cfg, t0);
    s = { ...s, phase: "COOLDOWN", phaseDeadlineAt: t0 + 12000 };
    s = reduceAutodrive(s, { type: "PHASE_TIMEOUT", nowMs: s.phaseDeadlineAt });
    assert.equal(s.phase, "IDLE");
  });

  // -----------------------------------------------------------------------
  // F22: pause hygiene — session clock and auto-stop clock must not run
  // while paused.
  // -----------------------------------------------------------------------

  it("pause/resume does not inflate the session clock", () => {
    let s = createInitialState(classicCfg({ skipCalibration: true }), t0);
    for (let i = 1; i <= 5; i++) {
      s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + i * 100, softA: 150, softB: 150 });
    }
    const before = s.effectiveElapsedMs;
    s = reduceAutodrive(s, { type: "PAUSE", nowMs: t0 + 1000, strengthA: 0, strengthB: 0 });
    // 10 s pause without ticks.
    s = reduceAutodrive(s, { type: "RESUME", nowMs: t0 + 11000 });
    s = reduceAutodrive(s, { type: "TICK", nowMs: t0 + 11100, softA: 150, softB: 150 });
    assert.ok(
      s.effectiveElapsedMs - before < 1000,
      `session clock must not jump by the pause duration (was ${before}, now ${s.effectiveElapsedMs})`
    );
  });

  it("pause shifts the auto-stop clock", () => {
    let s = createInitialState(classicCfg({ skipCalibration: true, autoStopMinutes: 30 }), t0);
    const before = s.maxDurationAt;
    s = reduceAutodrive(s, { type: "PAUSE", nowMs: t0 + 500 });
    // 60 s pause.
    s = reduceAutodrive(s, { type: "RESUME", nowMs: t0 + 60500 });
    assert.ok(
      s.maxDurationAt - before >= 55000,
      `maxDurationAt must shift by the pause (shifted ${s.maxDurationAt - before})`
    );
  });

  it("session does not auto-stop right after a long pause", () => {
    let s = createInitialState(
      classicCfg({ skipCalibration: true, autoStopMinutes: 30 }),
      t0
    );
    // Pause for longer than the remaining max duration would be.
    s = reduceAutodrive(s, { type: "PAUSE", nowMs: t0 + 5000 });
    s = reduceAutodrive(s, { type: "RESUME", nowMs: t0 + 31 * 60 * 1000 });
    s = reduceAutodrive(s, {
      type: "TICK",
      nowMs: t0 + 31 * 60 * 1000 + 100,
      softA: 150,
      softB: 150,
    });
    assert.notEqual(s.phase, "AFTERCARE");
    assert.notEqual(s.phase, "COOLDOWN");
  });

  // -----------------------------------------------------------------------
  // F22: feedback — per-type rate limit + fresh feedback sticks.
  // -----------------------------------------------------------------------

  it("rate limit only blocks the same feedback type", () => {
    let s = createInitialState(classicCfg({ skipCalibration: true }), t0);
    const first = reduceAutodrive(s, {
      type: "FEEDBACK",
      feedback: "too_weak",
      nowMs: t0 + 100,
      softA: 150,
      softB: 150,
    });
    assert.equal(first.lastFeedback, "too_weak");
    // Different type within the rate window must land.
    const second = reduceAutodrive(first, {
      type: "FEEDBACK",
      feedback: "good",
      nowMs: t0 + 200,
      softA: 150,
      softB: 150,
    });
    assert.equal(second.lastFeedback, "good");
    // Same type within the window is dropped.
    const third = reduceAutodrive(second, {
      type: "FEEDBACK",
      feedback: "good",
      nowMs: t0 + 300,
      softA: 150,
      softB: 150,
    });
    assert.equal(third.lastFeedback, "good");
  });

  it("envelope stays out of the way right after feedback", () => {
    let s = createInitialState(classicCfg({ skipCalibration: true }), t0);
    const fb = reduceAutodrive(s, {
      type: "FEEDBACK",
      feedback: "too_weak",
      nowMs: t0 + 100,
      softA: 150,
      softB: 150,
    });
    const boosted = fb.relStrength;
    const ticked = reduceAutodrive(fb, {
      type: "TICK",
      nowMs: t0 + 200,
      softA: 150,
      softB: 150,
    });
    assert.ok(
      ticked.relStrength >= boosted - 0.02,
      `fresh feedback must stick (boosted ${boosted}, after tick ${ticked.relStrength})`
    );
  });
});
