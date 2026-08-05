// autodrive-engine.js — Adaptive Autodrive with sensation plane (freq/duty/channel),
// edge-score, calibration baseline, multi-wave climax, placement profiles.

// v5.1: climax curve model (accelerating freq ramp + amplitude staircase).
import { CLIMAX_CURVES, climaxCurveStep } from "./wire-shaping.js";
// v6.1: multi-wave climax tables + push-retry budget extracted for testability.
import {
  CLIMAX_WAVES,
  CLIMAX_WAVES_FINISH,
  PUSH_RETRY,
  climaxWaveTable,
  pushRetryBudget,
  pushBoostForRetry,
  pushFloorRel,
} from "./climax-protocol.js";

// Re-exported for modules/tests that import them from the engine (kept in sync
// with climax-protocol.js).
export { CLIMAX_WAVES, CLIMAX_WAVES_FINISH };

/** @typedef {"IDLE"|"CALIBRATING"|"WARMUP"|"BUILD"|"TEASE"|"EDGE_HOLD"|"SURGE"|"CLIMAX_PUSH"|"AFTERCARE"|"COOLDOWN"|"PAUSED"} AutodrivePhase */
/** @typedef {"direct"|"edge_then_release"|"edge_ladder"|"deny_then_release"|"hfo"} AutodriveGoal */
/** @typedef {"too_weak"|"good"|"too_strong"|"almost"|"now"|"climaxed"|"not_yet"} AutodriveFeedback */
/** @typedef {"gentle"|"medium"|"intense"} AutodriveSensitivity */
/** @typedef {"A"|"B"|"both"} ChannelFocus */
/**
 * Body / electrode application profile for Autodrive tuning.
 * Strength/freq/duty are soft-relative; labels guide real-world ESTIM setups.
 * @typedef {"soft_external"|"deep_pressure"|"dual"|"perineum_combo"|"insertable"|"loops_ab_penis"|"loops_ab_glans_hot"} PlacementProfile
 */
/** @typedef {"both"|"alt"|"aLead"|"bLead"} ChannelMode */

import { PLACEMENT_PROFILES, AUTODRIVE_TEMPLATES } from "./autodrive-data.js";
import { encodeWaveFreqLogical } from "./protocol-utils.js";

// Re-exported for modules that historically imported them from the engine.
export { PLACEMENT_PROFILES, AUTODRIVE_TEMPLATES };

/** Absolute safety rules shown in Autodrive UI (not medical advice). */
export const ESTIM_SAFETY_RULES = Object.freeze([
  "Stromwege nur unterhalb der Taille — nie über Brust/Herz, nie Kopf/Hals",
  "Nicht während Schwangerschaft; kein ESTIM bei Herzschrittmacher/ICD ohne ärztliche Freigabe",
  "Nur intakte Haut; keine frischen Wunden, Entzündungen oder Taubheitsgefühl",
  "Immer geschlossener Kreis (zwei Kontakte pro Kanal); Körper-sichere ESTIM-Elektroden",
  "Immer niedrig starten; Soft-Limits setzen; Panic/STOP erreichbar halten",
  "Bei Schwindel, Herzrasen, starken Schmerzen: sofort Soft-Stop / Gerät aus",
]);

export const AUTODRIVE_CONFIG_DEFAULTS = Object.freeze({
  templateId: "finish_loops",
  goal: "edge_then_release",
  sensitivity: "medium",
  channelFocus: "both",
  coupledFraction: 0.3,
  maxSessionIntensity: null,
  allowClimaxPatterns: true,
  autoStopMinutes: null,
  skipCalibration: false,
  edgeCount: 1,
  targetDurationMin: 14,
  maxSessionIntensityFactor: 0.94,
  aggression: 1.2,
  autoClimb: true,
  placement: "loops_ab_penis",
  /** @type {"sync"|"aRhythm_bSteady"|"aSteady_bRhythm"} */
  abRole: "sync",
  fullscreenPreferred: true,
  hybridAudio: false,
  storyId: null,
  electrodeKind: "loops",
  wiringMode: "independent_4",
  siteA1: "base",
  siteA2: "mid",
  siteB1: "corona",
  siteB2: "glans",
  balanceB: 88,
  setupPresetId: "loops_ab_finish",
  /** Longer push, stay in CLIMAX_PUSH on too_strong drop, both channels */
  climaxPriority: true,
  // F1 (Climax-Fabrik): full 10–1000 Hz logical band instead of wire 10–240.
  freqFullBand: false,
  /** Programmed edging loops in EDGE_HOLD (rise/hold/drop accumulation cycles). */
  edgeLoops: false,
  /** Number of edging-loop cycles before auto-completing the edge (0 = feedback-only). */
  edgeCycleTarget: 0,
  /** Number of climaxes to reach (1–3). >1 enables refractory multi-climax cycles. */
  climaxTarget: 1,
  /** Heart-rate biofeedback: HR rise → auto "almost", HR drop → "good". */
  hrAdaptive: false,
  /** v5.1 climax curve model: "none"|"kurz"|"standard"|"verzoegert". */
  climaxCurve: "none",
  /** v6.1 finish-path: after an unmarked CLIMAX_PUSH timeout, re-arm a short
   *  TEASE slice and push again with more boost instead of ending (bounded). */
  pushRetry: false,
});

const SENSITIVITY_SCALE = Object.freeze({
  gentle: 0.78,
  medium: 1.0,
  intense: 1.18,
});

const DROP_DEPTH = Object.freeze({
  gentle: 0.18,
  medium: 0.14,
  intense: 0.1,
});

const FEEDBACK_RATE_MS = 1200;
const HABITUATION_MS_MIN = 12000;
const HABITUATION_MS_MAX = 25000;
const SOFT_RESET_MS = 60000;

const PHASE_SHARES = Object.freeze({
  WARMUP: 0.1,
  BUILD: 0.26,
  TEASE: 0.2,
  EDGE_HOLD: 0.1,
  SURGE: 0.1,
  CLIMAX_PUSH: 0.24,
});

/** Wire freq targets per phase (Coyote 10–240, not literal Hz). */
const PHASE_FREQ = Object.freeze({
  CALIBRATING: { lo: 25, hi: 40 },
  WARMUP: { lo: 30, hi: 50 },
  BUILD: { lo: 40, hi: 70 },
  // F22: deeper lows for contrast, more dynamic range than before (35–90).
  TEASE: { lo: 25, hi: 70 },
  EDGE_HOLD: { lo: 40, hi: 70 },
  SURGE: { lo: 55, hi: 100 },
  CLIMAX_PUSH: { lo: 60, hi: 120 },
  AFTERCARE: { lo: 20, hi: 40 },
});

/**
 * Full logical 10–1000 Hz roadmap per phase (official Coyote 3 range).
 * Low = deep "throb", mid = "buzz", high = "sharp". Used when
 * config.freqFullBand is enabled; encodeWaveFreqLogical maps to wire.
 */
const PHASE_FREQ_FULL = Object.freeze({
  CALIBRATING: { lo: 15, hi: 35 },
  WARMUP: { lo: 15, hi: 45 },
  BUILD: { lo: 30, hi: 80 },
  TEASE: { lo: 18, hi: 60 },
  // F22: long holds stay in the deep/buzz zone (habituation + comfort),
  // surge climbs into "high", only the push ramps into "sharp".
  EDGE_HOLD: { lo: 40, hi: 90 },
  SURGE: { lo: 60, hi: 150 },
  CLIMAX_PUSH: { lo: 70, hi: 400 },
  AFTERCARE: { lo: 12, hi: 30 },
});

/** Duty cycle (on-fraction) targets per phase. */
const PHASE_DUTY = Object.freeze({
  CALIBRATING: 0.55,
  WARMUP: 0.65,
  BUILD: 0.75,
  TEASE: 0.55,
  EDGE_HOLD: 0.88,
  SURGE: 0.7,
  CLIMAX_PUSH: 0.82,
  AFTERCARE: 0.5,
});

const NEEDS_EDGES = new Set(["edge_then_release", "edge_ladder", "deny_then_release", "hfo"]);
const VALID_GOALS = new Set([
  "direct",
  "edge_then_release",
  "edge_ladder",
  "deny_then_release",
  "hfo",
]);
const VALID_SENS = new Set(["gentle", "medium", "intense"]);
const VALID_FOCUS = new Set(["A", "B", "both"]);
const VALID_PLACEMENT = new Set([
  "soft_external",
  "deep_pressure",
  "dual",
  "perineum_combo",
  "insertable",
  "loops_ab_penis",
  "loops_ab_glans_hot",
]);

/** @param {string} placementId */
export function placementPrefersAlternate(placementId) {
  const p = PLACEMENT_PROFILES[placementId];
  if (!p) return false;
  return p.preferredChannelMode === "alt" || p.preferredChannelMode === "aLead";
}

/**
 * @param {string} [placementId]
 * @param {ChannelMode} [fallback]
 * @returns {ChannelMode}
 */
export function resolvePlacementChannelMode(placementId, fallback = "both") {
  const p = PLACEMENT_PROFILES[placementId];
  const mode = p?.preferredChannelMode;
  if (mode === "alt" || mode === "aLead" || mode === "bLead" || mode === "both") return mode;
  if (placementId === "dual") return "alt";
  return fallback;
}

/**
 * @returns {Array<typeof PLACEMENT_PROFILES[keyof typeof PLACEMENT_PROFILES]>}
 */
export function listPlacementProfiles() {
  return Object.values(PLACEMENT_PROFILES);
}

/**
 * @param {string} id
 * @returns {typeof PLACEMENT_PROFILES[keyof typeof PLACEMENT_PROFILES]}
 */
export function getPlacementProfile(id) {
  return PLACEMENT_PROFILES[id] || PLACEMENT_PROFILES.soft_external;
}

/**
 * Session wire-freq envelope for UI (Coyote wire 10–240, not literal Hz).
 * Includes placement bias + modest headroom for push/feedback boosts.
 * @param {object} [config]
 * @returns {{ lo: number, hi: number, bias: number, peakPhase: string }}
 */
export function estimateWireFreqEnvelope(config) {
  const place = getPlacementProfile(config?.placement);
  const bias = place.freqBias || 0;
  /** Feedback / almost boosts can raise target by ~15–25 wire units. */
  const BOOST_HEADROOM = 22;
  let lo = 240;
  let hi = 10;
  for (const band of Object.values(PHASE_FREQ)) {
    lo = Math.min(lo, band.lo + bias);
    hi = Math.max(hi, band.hi + bias);
  }
  lo = Math.max(10, Math.min(240, Math.round(lo)));
  hi = Math.max(10, Math.min(240, Math.round(hi + BOOST_HEADROOM)));
  if (hi < lo) hi = lo;
  return { lo, hi, bias, peakPhase: "CLIMAX_PUSH" };
}

/**
 * Phase-local band (current phase only), for optional compact display.
 * @param {string} phase
 * @param {object} [config]
 */
export function estimatePhaseWireFreqBand(phase, config) {
  const place = getPlacementProfile(config?.placement);
  const bias = place.freqBias || 0;
  const band = PHASE_FREQ[phase] || { lo: 40, hi: 60 };
  return {
    lo: Math.max(10, Math.min(240, Math.round(band.lo + bias))),
    hi: Math.max(10, Math.min(240, Math.round(band.hi + bias))),
  };
}
const VALID_FEEDBACK = new Set([
  "too_weak",
  "good",
  "too_strong",
  "almost",
  "now",
  "climaxed",
  "not_yet",
  "nudge_up",
  "nudge_down",
]);

const PHASE_LABELS_DE = Object.freeze({
  IDLE: "Bereit",
  CALIBRATING: "Kalibrierung",
  WARMUP: "Aufwärmen",
  BUILD: "Aufbau",
  TEASE: "Tease",
  EDGE_HOLD: "Edge halten",
  SURGE: "Welle",
  CLIMAX_PUSH: "Höhepunkt",
  AFTERCARE: "Aftercare",
  COOLDOWN: "Cooldown",
  PAUSED: "Pausiert",
});

/**
 * Multi-wave climax protocol segments — moved to lib/climax-protocol.js (v6.1).
 * Re-exported at the top of this file so existing imports keep working.
 */

/**
 * @param {unknown} input
 */
export function sanitiseAutodriveConfig(input) {
  const base = { ...AUTODRIVE_CONFIG_DEFAULTS };
  if (!input || typeof input !== "object") return base;
  const raw = /** @type {Record<string, unknown>} */ (input);

  if (typeof raw.templateId === "string" && AUTODRIVE_TEMPLATES[raw.templateId]) {
    const template = AUTODRIVE_TEMPLATES[raw.templateId];
    base.templateId = template.id;
    base.goal = template.goal;
    base.sensitivity = template.sensitivity;
    base.edgeCount = template.edgeCount;
    base.targetDurationMin = template.targetDurationMin;
    base.maxSessionIntensityFactor = template.maxSessionIntensityFactor;
    base.allowClimaxPatterns = template.allowClimaxPatterns;
    base.aggression = template.aggression ?? 1;
    // Loop / body presets can pin placement + A/B role
    if (template.placement && VALID_PLACEMENT.has(template.placement)) {
      base.placement = template.placement;
    }
    if (
      template.abRole &&
      ["sync", "aRhythm_bSteady", "aSteady_bRhythm"].includes(template.abRole)
    ) {
      base.abRole = template.abRole;
    }
    if (template.channelFocus && VALID_FOCUS.has(template.channelFocus)) {
      base.channelFocus = template.channelFocus;
    }
    if (typeof template.climaxPriority === "boolean") {
      base.climaxPriority = template.climaxPriority;
    }
    if (
      template.wiringMode === "single_channel_2" ||
      template.wiringMode === "independent_4" ||
      template.wiringMode === "common_3"
    ) {
      base.wiringMode = template.wiringMode;
    }
    if (
      template.electrodeKind === "loops" ||
      template.electrodeKind === "pads" ||
      template.electrodeKind === "mixed" ||
      template.electrodeKind === "insertable"
    ) {
      base.electrodeKind = template.electrodeKind;
    }
  }

  if (typeof raw.goal === "string" && VALID_GOALS.has(raw.goal)) base.goal = raw.goal;
  if (typeof raw.sensitivity === "string" && VALID_SENS.has(raw.sensitivity)) {
    base.sensitivity = raw.sensitivity;
  }
  if (typeof raw.channelFocus === "string" && VALID_FOCUS.has(raw.channelFocus)) {
    base.channelFocus = raw.channelFocus;
  }
  if (typeof raw.placement === "string" && VALID_PLACEMENT.has(raw.placement)) {
    base.placement = raw.placement;
  }
  if (raw.coupledFraction !== undefined) {
    const f = Number(raw.coupledFraction);
    if (Number.isFinite(f)) base.coupledFraction = clamp(f, 0, 1);
  }
  if (raw.maxSessionIntensity != null) {
    const m = Number(raw.maxSessionIntensity);
    if (Number.isFinite(m) && m > 0) base.maxSessionIntensity = Math.round(clamp(m, 1, 200));
  }
  if (typeof raw.allowClimaxPatterns === "boolean")
    base.allowClimaxPatterns = raw.allowClimaxPatterns;
  if (raw.autoStopMinutes != null) {
    const a = Number(raw.autoStopMinutes);
    if (Number.isFinite(a) && a > 0) base.autoStopMinutes = Math.round(clamp(a, 1, 180));
  }
  if (typeof raw.skipCalibration === "boolean") base.skipCalibration = raw.skipCalibration;
  if (typeof raw.autoClimb === "boolean") base.autoClimb = raw.autoClimb;
  if (raw.edgeCount !== undefined) {
    const e = Number(raw.edgeCount);
    if (Number.isFinite(e)) base.edgeCount = Math.round(clamp(e, 0, 20));
  }
  if (raw.targetDurationMin !== undefined) {
    const t = Number(raw.targetDurationMin);
    if (Number.isFinite(t)) base.targetDurationMin = clamp(t, 1, 120);
  }
  if (raw.maxSessionIntensityFactor !== undefined) {
    const f = Number(raw.maxSessionIntensityFactor);
    if (Number.isFinite(f)) base.maxSessionIntensityFactor = clamp(f, 0.2, 1);
  }
  if (raw.aggression !== undefined) {
    const a = Number(raw.aggression);
    if (Number.isFinite(a)) base.aggression = clamp(a, 0.5, 1.6);
  }
  if (
    typeof raw.abRole === "string" &&
    ["sync", "aRhythm_bSteady", "aSteady_bRhythm"].includes(raw.abRole)
  ) {
    base.abRole = raw.abRole;
  }
  if (typeof raw.fullscreenPreferred === "boolean") {
    base.fullscreenPreferred = raw.fullscreenPreferred;
  }
  if (typeof raw.hybridAudio === "boolean") base.hybridAudio = raw.hybridAudio;
  if (typeof raw.storyId === "string") base.storyId = raw.storyId.slice(0, 64);
  if (typeof raw.climaxPriority === "boolean") base.climaxPriority = raw.climaxPriority;
  // Template can pin climaxPriority
  if (
    typeof raw.templateId === "string" &&
    AUTODRIVE_TEMPLATES[raw.templateId]?.climaxPriority != null
  ) {
    base.climaxPriority = !!AUTODRIVE_TEMPLATES[raw.templateId].climaxPriority;
  }

  // F1 (Climax-Fabrik): fullband / edging loops / multi-climax.
  if (typeof raw.freqFullBand === "boolean") base.freqFullBand = raw.freqFullBand;
  if (typeof raw.edgeLoops === "boolean") base.edgeLoops = raw.edgeLoops;
  if (raw.edgeCycleTarget !== undefined) {
    const n = Number(raw.edgeCycleTarget);
    if (Number.isFinite(n)) base.edgeCycleTarget = Math.round(clamp(n, 0, 12));
  }
  if (raw.climaxTarget !== undefined) {
    const n = Number(raw.climaxTarget);
    if (Number.isFinite(n)) base.climaxTarget = Math.round(clamp(n, 1, 3));
  }
  if (typeof raw.hrAdaptive === "boolean") base.hrAdaptive = raw.hrAdaptive;
  if (
    typeof raw.climaxCurve === "string" &&
    ["none", "kurz", "standard", "verzoegert"].includes(raw.climaxCurve)
  ) {
    base.climaxCurve = raw.climaxCurve;
  }
  if (typeof raw.pushRetry === "boolean") base.pushRetry = raw.pushRetry;
  if (typeof raw.templateId === "string" && AUTODRIVE_TEMPLATES[raw.templateId]) {
    const tpl = AUTODRIVE_TEMPLATES[raw.templateId];
    if (typeof tpl.freqFullBand === "boolean") base.freqFullBand = tpl.freqFullBand;
    if (typeof tpl.edgeLoops === "boolean") base.edgeLoops = tpl.edgeLoops;
    if (typeof tpl.edgeCycleTarget === "number") base.edgeCycleTarget = tpl.edgeCycleTarget;
    if (typeof tpl.climaxTarget === "number") base.climaxTarget = tpl.climaxTarget;
    if (
      typeof tpl.climaxCurve === "string" &&
      ["none", "kurz", "standard", "verzoegert"].includes(tpl.climaxCurve)
    ) {
      base.climaxCurve = tpl.climaxCurve;
    }
    if (typeof tpl.pushRetry === "boolean") base.pushRetry = tpl.pushRetry;
  }

  const kinds = new Set(["loops", "pads", "mixed", "insertable"]);
  const wirings = new Set(["independent_4", "common_3", "single_channel_2"]);
  const sites = new Set([
    "base",
    "mid",
    "corona",
    "glans",
    "perineum",
    "pubis",
    "labia",
    "insertable",
  ]);
  if (typeof raw.electrodeKind === "string" && kinds.has(raw.electrodeKind)) {
    base.electrodeKind = raw.electrodeKind;
  }
  if (typeof raw.wiringMode === "string" && wirings.has(raw.wiringMode)) {
    base.wiringMode = raw.wiringMode;
  }
  if (typeof raw.siteA1 === "string" && sites.has(raw.siteA1)) base.siteA1 = raw.siteA1;
  if (typeof raw.siteA2 === "string" && sites.has(raw.siteA2)) base.siteA2 = raw.siteA2;
  if (typeof raw.siteB1 === "string" && sites.has(raw.siteB1)) base.siteB1 = raw.siteB1;
  if (typeof raw.siteB2 === "string" && sites.has(raw.siteB2)) base.siteB2 = raw.siteB2;
  if (raw.balanceB !== undefined) {
    const b = Number(raw.balanceB);
    if (Number.isFinite(b)) base.balanceB = Math.round(clamp(b, 40, 100));
  }
  if (typeof raw.setupPresetId === "string") {
    base.setupPresetId = raw.setupPresetId.slice(0, 48);
  }

  // Single-channel (2 contacts): one active Coyote channel, no A/B dual roles.
  if (base.wiringMode === "single_channel_2") {
    base.abRole = "sync";
    base.coupledFraction = 0;
    if (base.channelFocus !== "A" && base.channelFocus !== "B") {
      base.channelFocus = "A";
    }
    if (base.placement === "loops_ab_penis" || base.placement === "loops_ab_glans_hot") {
      base.placement = "deep_pressure";
    }
  }

  if (base.autoStopMinutes == null) {
    base.autoStopMinutes = Math.max(base.targetDurationMin + 8, 30);
  }
  return base;
}

/**
 * @param {ReturnType<typeof sanitiseAutodriveConfig>} config
 * @param {number} nowMs
 * @param {{ preferredBias?: number, lastPeakRel?: number, preferredPlacement?: string }=} learning
 */
export function createInitialState(config, nowMs, learning = {}) {
  const cfg = sanitiseAutodriveConfig(config);
  if (learning.preferredPlacement && VALID_PLACEMENT.has(learning.preferredPlacement)) {
    cfg.placement = learning.preferredPlacement;
  }
  const targetDurationMs = Math.round(cfg.targetDurationMin * 60 * 1000);
  const skip = !!cfg.skipCalibration;
  const phase = skip ? "WARMUP" : "CALIBRATING";
  const phaseMs = skip ? shareMs(targetDurationMs, "WARMUP", cfg) : 16000;
  const peakHint = clamp(Number(learning.lastPeakRel) || 0.55, 0.35, 0.85);
  const baseRel = skip ? Math.max(0.14, peakHint * 0.35) : 0.08;
  const place = PLACEMENT_PROFILES[cfg.placement] || PLACEMENT_PROFILES.soft_external;

  return {
    phase: /** @type {AutodrivePhase} */ (phase),
    resumePhase: null,
    config: cfg,
    startedAt: nowMs,
    effectiveElapsedMs: 0,
    lastTickAt: nowMs,
    phaseStartedAt: nowMs,
    phaseDeadlineAt: nowMs + phaseMs,
    settleUntil: null,
    relStrength: baseRel,
    /** Discovered during calibration; scales all phase baselines. */
    sessionBaseline: skip ? baseRel : 0.12,
    calibrated: skip,
    comfortFloor: 0.1,
    comfortCeiling: 0.92,
    feedbackBias: clamp(Number(learning.preferredBias) || 0, -0.15, 0.2),
    climbRate: 1,
    lastTooStrongAt: 0,
    lastTooWeakAt: 0,
    lastAlmostAt: 0,
    consecutiveAlmost: 0,
    consecutiveGood: 0,
    denyCount: 0,
    maxDenies: cfg.goal === "deny_then_release" ? 1 : 0,
    edgeCountDone: 0,
    edgeCountTarget: cfg.edgeCount || 0,
    holdCompletedThisVisit: false,
    userMarkedClimax: false,
    lastFeedbackAt: 0,
    lastFeedback: null,
    maxDurationAt: nowMs + Math.round((cfg.autoStopMinutes || 30) * 60 * 1000),
    pausedStrengthA: 0,
    pausedStrengthB: 0,
    frozenPhaseElapsed: 0,
    softA: 150,
    softB: 150,
    loopCounter: 0,
    targetDurationMs,
    patternSegment: 0,
    microPhase: 0,
    peakRel: baseRel,
    phaseHistory: [phase],
    // Edge score 0–100
    edgeScore: 0,
    // Sensation plane
    wireFreq: 40 + (place.freqBias || 0),
    wireFreqTarget: 40 + (place.freqBias || 0),
    dutyCycle: 0.6,
    channelMode: resolvePlacementChannelMode(cfg.placement, "both"),
    burstMs: 0,
    softResetUntil: 0,
    nextHabituationAt: nowMs + randRange(HABITUATION_MS_MIN, HABITUATION_MS_MAX),
    lastPatternId: "gentle",
    preferredPatternFamily: learning.preferredPatternFamily || null,
    // Climax multi-wave
    climaxWaveIndex: 0,
    climaxWaveStartedAt: 0,
    climaxInDrop: false,
    // F1: multi-climax + edging-loop cadence
    climaxCount: 0,
    holdCycleIdx: 0,
    holdCyclePhase: "rise",
    holdCycleT0: nowMs,
    placeFreqBias: place.freqBias || 0,
    placeDutyScale: place.dutyScale || 1,
    // Peak-lock: hold a "good" intensity zone
    peakLockRel: null,
    peakLockUntil: 0,
    peakLockHits: 0,
    // After almost in push: extra boosted crests
    pushBoostRemaining: 0,
    // v6.1 push-retry: how many extra push attempts have been spent after an
    // unmarked CLIMAX_PUSH timeout (0 = first push). Total = retry budget.
    pushRetriesUsed: 0,
    pushRetryTotal: pushRetryBudget(cfg).maxRetries,
    // Session quality counters (for coach / debrief)
    sessionTooWeakCount: 0,
    sessionTooStrongCount: 0,
    sessionAlmostCount: 0,
    sessionGoodCount: 0,
    // Feedback prompt scheduling
    nextPromptAt: nowMs + 20000,
    lastPromptAt: 0,
    pendingPrompt: null,
    /** Consecutive almost without climax — quality loop */
    almostWithoutClimax: 0,
    qualityBoost: 0,
  };
}

/**
 * @param {object} state
 * @param {{ type: string, feedback?: AutodriveFeedback, nowMs?: number, softA?: number, softB?: number, strengthA?: number, strengthB?: number }} event
 */
export function reduceAutodrive(state, event) {
  if (!state || !event) return state;
  const now = event.nowMs ?? Date.now();
  let s = { ...state };

  if (event.softA != null) s.softA = event.softA;
  if (event.softB != null) s.softB = event.softB;

  if (
    event.type === "STOP" ||
    event.type === "PANIC" ||
    event.type === "DISCONNECT" ||
    event.type === "SIGNAL_LOSS"
  ) {
    return idleState(s, now);
  }

  if (s.phase === "IDLE") {
    if (event.type === "START") {
      return createInitialState(
        { ...s.config, softA: event.softA ?? s.softA, softB: event.softB ?? s.softB },
        now
      );
    }
    return s;
  }

  if (s.maxDurationAt && now >= s.maxDurationAt) {
    if (
      (event.type === "MAX_DURATION" || event.type === "TICK") &&
      s.phase !== "AFTERCARE" &&
      s.phase !== "COOLDOWN" &&
      s.phase !== "PAUSED"
    ) {
      return enterAftercare(s, now, false);
    }
  }

  if (event.type === "PAUSE") {
    if (s.phase === "IDLE" || s.phase === "PAUSED" || s.phase === "COOLDOWN") return s;
    return {
      ...s,
      resumePhase: s.phase,
      phase: "PAUSED",
      frozenPhaseElapsed: now - s.phaseStartedAt,
      pausedAt: now,
      pausedStrengthA: event.strengthA ?? s.pausedStrengthA,
      pausedStrengthB: event.strengthB ?? s.pausedStrengthB,
    };
  }

  if (event.type === "RESUME") {
    if (s.phase !== "PAUSED" || !s.resumePhase) return s;
    const remaining = Math.max(
      0,
      (s.phaseDeadlineAt || now) - s.phaseStartedAt - s.frozenPhaseElapsed
    );
    const pauseDur = Math.max(0, now - (s.pausedAt || now));
    return {
      ...s,
      phase: s.resumePhase,
      resumePhase: null,
      phaseStartedAt: now - s.frozenPhaseElapsed,
      phaseDeadlineAt: now + remaining,
      // F22: pause hygiene — the session clock and the auto-stop clock must
      // not run during a pause.
      maxDurationAt: (s.maxDurationAt || now) + pauseDur,
      lastTickAt: now,
      pausedAt: null,
      frozenPhaseElapsed: 0,
    };
  }

  if (s.phase === "PAUSED") return s;

  if (event.type === "FEEDBACK" && event.feedback === "climaxed") {
    return enterAftercare(
      { ...s, almostWithoutClimax: 0, qualityBoost: 0, climaxCount: (s.climaxCount || 0) + 1 },
      now,
      true
    );
  }
  if (event.type === "USER_CLIMAX") {
    return enterAftercare({ ...s, climaxCount: (s.climaxCount || 0) + 1 }, now, true);
  }

  if (event.type === "TICK") {
    s = advanceTime(s, now);
    s.loopCounter = (s.loopCounter || 0) + 1;
    s.microPhase = (s.microPhase || 0) + 1;
    s = applyEdgeCadence(s, now);
    s = applyAdaptiveEnvelope(s, now);
    s = applyEdgeScoreTick(s, now);
    s = applySensationPlane(s, now);
    s = applyHabituation(s, now);
    s = applyClimaxWave(s, now);
    s = applyMicroMod(s, now);
    s = applyTimePressure(s, now);
    s = applyFeedbackPrompts(s, now);
    if (s.phaseDeadlineAt && now >= s.phaseDeadlineAt) {
      s = applyPhaseTimeout(s, now);
    } else {
      s = applyTickGuards(s, now);
    }
    s.peakRel = Math.max(s.peakRel || 0, s.relStrength || 0);
    // Smooth freq toward target (logical 10–1000 → encoded wire for fullband).
    if (s.config?.freqFullBand && s.logicalFreqTarget != null) {
      const cur = s.logicalFreq || s.logicalFreqTarget;
      s.logicalFreq = cur + (s.logicalFreqTarget - cur) * 0.12;
      s.wireFreq = encodeWaveFreqLogical(s.logicalFreq);
    } else {
      s.wireFreq = lerp(s.wireFreq || s.wireFreqTarget, s.wireFreqTarget, 0.12);
    }
    return s;
  }

  if (event.type === "PHASE_TIMEOUT") {
    s = advanceTime(s, now);
    return applyPhaseTimeout(s, now);
  }

  if (event.type === "FEEDBACK" && event.feedback && VALID_FEEDBACK.has(event.feedback)) {
    // F22: rate-limit only the SAME feedback type (double-click protection).
    // Different feedback right after another must not be swallowed — a quick
    // "Zu schwach" → "Gut" sequence has to land.
    const sameType = s.lastFeedbackType === event.feedback;
    const exempt =
      event.feedback === "climaxed" || event.feedback === "now" || event.feedback === "not_yet";
    if (sameType && !exempt && s.lastFeedbackAt && now - s.lastFeedbackAt < FEEDBACK_RATE_MS) {
      return s;
    }
    s = {
      ...s,
      lastFeedbackAt: now,
      lastFeedback: event.feedback,
      lastFeedbackType: event.feedback,
    };
    return applyFeedback(s, event.feedback, now);
  }

  // F16: biofeedback ended the refractory rest early (HR settled) → next cycle.
  if (event.type === "REFRACTORY_DONE") {
    if (
      s.phase === "COOLDOWN" &&
      (s.config.climaxTarget || 1) > 1 &&
      (s.climaxCount || 0) >= 1 &&
      (s.climaxCount || 0) < (s.config.climaxTarget || 1)
    ) {
      return setPhase(s, "BUILD", now, shareMs(s.targetDurationMs, "BUILD", s.config));
    }
    return s;
  }

  return s;
}

/**
 * @param {object} state
 * @param {number} nowMs
 */
export function computeAutodriveOutput(state, nowMs) {
  if (!state || state.phase === "IDLE") {
    return emptyOut("IDLE", true);
  }
  if (state.phase === "PAUSED") {
    return {
      ...emptyOut("PAUSED", true),
      strengthA: state.pausedStrengthA || 0,
      strengthB: state.pausedStrengthB || 0,
      progress: progressOf(state),
      phaseLabel: PHASE_LABELS_DE.PAUSED,
      edgeScore: state.edgeScore || 0,
    };
  }
  if (state.phase === "COOLDOWN") {
    return {
      ...emptyOut("COOLDOWN", true),
      progress: 1,
      phaseProgress: phaseProgressOf(state, nowMs),
      phaseLabel: PHASE_LABELS_DE.COOLDOWN,
    };
  }

  // Soft reset: wave off, keep strength logical low-mid
  if (state.softResetUntil && nowMs < state.softResetUntil) {
    const { strengthA, strengthB } = resolveChannelStrengths(
      Math.min(state.relStrength, 0.45),
      state.config,
      state.softA,
      state.softB
    );
    return {
      ...emptyOut(state.phase, false),
      strengthA,
      strengthB,
      patternId: null,
      patternParams: { ampScale: 0, freqBias: 0, dutyCycle: 0 },
      phase: state.phase,
      phaseLabel: PHASE_LABELS_DE[state.phase] || state.phase,
      progress: progressOf(state),
      phaseProgress: phaseProgressOf(state, nowMs),
      silenced: false,
      waveSilenced: true,
      edgeCountDone: state.edgeCountDone,
      edgeCountTarget: state.edgeCountTarget,
      userMarkedClimax: state.userMarkedClimax,
      relStrength: state.relStrength,
      remainingMs: Math.max(0, (state.targetDurationMs || 0) - (state.effectiveElapsedMs || 0)),
      phaseRemainingMs: Math.max(0, (state.phaseDeadlineAt || nowMs) - nowMs),
      edgeScore: state.edgeScore || 0,
      tip: "Anti-Habituation Pause — Sensation reset",
      wireFreq: state.wireFreq,
      dutyCycle: 0,
      channelMode: state.channelMode,
    };
  }

  const effectiveRel = effectiveRelStrength(state);
  const { strengthA, strengthB } = resolveChannelStrengths(
    effectiveRel,
    state.config,
    state.softA,
    state.softB
  );
  const pat = patternForPhase(state, nowMs);
  const remainingMs = Math.max(0, (state.targetDurationMs || 0) - (state.effectiveElapsedMs || 0));
  const phaseRemainingMs = Math.max(0, (state.phaseDeadlineAt || nowMs) - nowMs);
  const duty = clamp((state.dutyCycle || 0.7) * (state.placeDutyScale || 1), 0.15, 1);

  // Duty gate: force amp 0 during off portion of cycle
  const cycleMs = 800;
  const onMs = duty * cycleMs;
  const inCycle = (state.loopCounter * 100) % cycleMs; // ~100ms ticks
  const dutyGate = inCycle < onMs ? 1 : 0;
  const ampScale = (pat.ampScale || 1) * (dutyGate || (duty >= 0.95 ? 1 : dutyGate));

  // Channel mode gating for A/B amps (applied in façade)
  return {
    strengthA,
    strengthB,
    patternId: pat.patternId,
    patternParams: {
      ampScale: ampScale || pat.ampScale,
      freqBias: pat.freqBias || 0,
      dutyCycle: duty,
      dutyGate,
      channelMode: state.channelMode || "both",
    },
    phase: state.phase,
    phaseLabel: PHASE_LABELS_DE[state.phase] || state.phase,
    progress: progressOf(state),
    phaseProgress: phaseProgressOf(state, nowMs),
    silenced: false,
    waveSilenced: false,
    edgeCountDone: state.edgeCountDone,
    edgeCountTarget: state.edgeCountTarget,
    userMarkedClimax: state.userMarkedClimax,
    relStrength: effectiveRel,
    remainingMs,
    phaseRemainingMs,
    comfortFloor: state.comfortFloor,
    comfortCeiling: state.comfortCeiling,
    lastFeedback: state.lastFeedback,
    tip: phaseTip(state),
    patternHint: pat.patternId,
    edgeScore: Math.round(state.edgeScore || 0),
    sessionBaseline: state.sessionBaseline,
    calibrated: state.calibrated,
    wireFreq: Math.round(state.wireFreq || 45),
    wireFreqTarget: Math.round(state.wireFreqTarget || 45),
    wireFreqEnvelope: estimateWireFreqEnvelope(state.config),
    wireFreqPhaseBand: estimatePhaseWireFreqBand(state.phase, state.config),
    dutyCycle: duty,
    channelMode: state.channelMode,
    climaxWaveIndex: state.climaxWaveIndex || 0,
    placement: state.config.placement,
    peakLockActive: !!(
      state.peakLockRel != null &&
      state.peakLockUntil &&
      nowMs < state.peakLockUntil
    ),
    peakLockRel: state.peakLockRel,
    pendingPrompt: state.pendingPrompt,
    holdRemainingMs:
      state.phase === "EDGE_HOLD" ? Math.max(0, (state.phaseDeadlineAt || nowMs) - nowMs) : 0,
    nextStepHint: nextStepHint(state),
    sessionTooWeakCount: state.sessionTooWeakCount || 0,
    sessionTooStrongCount: state.sessionTooStrongCount || 0,
    abRole: state.config.abRole || "sync",
    pushRetriesUsed: state.pushRetriesUsed || 0,
    pushRetryTotal: state.pushRetryTotal || 0,
  };
}

/**
 * @param {number} rel
 * @param {object} cfg
 * @param {number} softA
 * @param {number} softB
 */
export function resolveChannelStrengths(rel, cfg, softA, softB) {
  const sens = SENSITIVITY_SCALE[cfg.sensitivity] ?? 1;
  const place = PLACEMENT_PROFILES[cfg.placement] || PLACEMENT_PROFILES.soft_external;
  const factor = (cfg.maxSessionIntensityFactor ?? 1) * (place.strengthCap ?? 1);
  const sessionCap =
    cfg.maxSessionIntensity != null && Number.isFinite(cfg.maxSessionIntensity)
      ? cfg.maxSessionIntensity
      : null;
  const capA = Math.min(softA, sessionCap ?? Math.round(softA * factor));
  const capB = Math.min(softB, sessionCap ?? Math.round(softB * factor));
  const r = clamp(rel, 0, 1);
  const fullA = Math.round(clamp(r * capA * sens, 0, capA));
  const fullB = Math.round(clamp(r * capB * sens, 0, capB));
  const frac = cfg.coupledFraction ?? 0.3;

  // Glans / hot site often on B — scale B after focus coupling
  const balB = clamp((cfg.balanceB ?? 100) / 100, 0.4, 1);

  // True single-channel wiring (2 contacts / 2 loops on one Coyote channel):
  // unused channel must stay at 0 — no coupled bleed.
  if (cfg.wiringMode === "single_channel_2") {
    if (cfg.channelFocus === "B") {
      return { strengthA: 0, strengthB: Math.round(fullB * balB) };
    }
    return { strengthA: fullA, strengthB: 0 };
  }

  if (cfg.channelFocus === "A") {
    return {
      strengthA: fullA,
      strengthB: Math.min(capB, Math.round(fullA * frac * balB)),
    };
  }
  if (cfg.channelFocus === "B") {
    return {
      strengthA: Math.min(capA, Math.round(fullB * frac)),
      strengthB: Math.round(fullB * balB),
    };
  }
  return { strengthA: fullA, strengthB: Math.round(fullB * balB) };
}

export function getPhaseLabel(phase) {
  return PHASE_LABELS_DE[phase] || phase;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randRange(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

function emptyOut(phase, silenced) {
  return {
    strengthA: 0,
    strengthB: 0,
    patternId: null,
    patternParams: { ampScale: 1, freqBias: 0, dutyCycle: 0, dutyGate: 0, channelMode: "both" },
    phase,
    phaseLabel: PHASE_LABELS_DE[phase] || phase,
    progress: 0,
    phaseProgress: 0,
    silenced,
    edgeCountDone: 0,
    edgeCountTarget: 0,
    userMarkedClimax: false,
    relStrength: 0,
    remainingMs: 0,
    phaseRemainingMs: 0,
    tip: "",
    patternHint: null,
    edgeScore: 0,
    wireFreq: 0,
    dutyCycle: 0,
    channelMode: "both",
  };
}

function shareMs(targetDurationMs, phase, cfg) {
  let share = PHASE_SHARES[phase] ?? 0.1;
  if (cfg?.templateId === "turbo" || cfg?.templateId === "quick_finish") {
    if (phase === "WARMUP") share *= 0.6;
    if (phase === "TEASE") share *= 0.5;
    if (phase === "CLIMAX_PUSH") share *= 1.3;
  }
  if (cfg?.templateId === "marathon" || cfg?.templateId === "long_tease") {
    if (phase === "TEASE" || phase === "BUILD") share *= 1.15;
  }
  // Climax-first sessions: more time in SURGE/PUSH, less endless tease
  if (cfg?.climaxPriority) {
    if (phase === "TEASE") share *= 0.75;
    if (phase === "BUILD") share *= 0.9;
    if (phase === "SURGE") share *= 1.15;
    if (phase === "CLIMAX_PUSH") share *= 1.45;
  }
  return Math.max(2500, Math.round(targetDurationMs * share));
}

function holdWindowMs(state) {
  const edge = state.edgeCountDone || 0;
  const base = 7000 + edge * 1800 + (state.config.edgeCount || 0) * 400;
  const sens = state.config.sensitivity === "gentle" ? 1.25 : 1;
  return Math.min(28000, Math.max(4500, Math.round(base * sens)));
}

function settleMs(state) {
  return 2500 + (state.config.sensitivity === "gentle" ? 4500 : 2000);
}

function teaseSliceMs(state) {
  return Math.max(4000, shareMs(state.targetDurationMs, "TEASE", state.config) * 0.45);
}

function pushDurationMs(state) {
  // Sum of multi-wave protocol + buffer; climaxPriority = longer final hold
  const table = climaxWaveTable(state.config);
  const waves = table.reduce((acc, w) => acc + w.crestMs + w.dropMs, 0);
  const aggro = state.config.aggression ?? 1;
  const priority = state.config.climaxPriority ? 1.4 : 1;
  const minPush = waves + (state.config.climaxPriority ? 28000 : 8000);
  return Math.min(
    180000,
    Math.max(minPush, Math.round(0.22 * state.targetDurationMs * aggro * priority))
  );
}

function dropDepth(state) {
  return DROP_DEPTH[state.config.sensitivity] ?? 0.14;
}

function idleState(s, now) {
  return {
    ...s,
    phase: "IDLE",
    resumePhase: null,
    settleUntil: null,
    holdCompletedThisVisit: false,
    lastTickAt: now,
    softResetUntil: 0,
  };
}

function enterAftercare(s, now, marked) {
  return {
    ...s,
    phase: "AFTERCARE",
    userMarkedClimax: !!marked,
    phaseStartedAt: now,
    phaseDeadlineAt: now + (marked ? 75000 : 50000),
    relStrength: Math.min(s.relStrength, Math.max(0.12, (s.peakRel || 0.4) * 0.35)),
    feedbackBias: 0,
    settleUntil: null,
    edgeScore: 0,
    wireFreqTarget: 28 + (s.placeFreqBias || 0),
    dutyCycle: 0.45,
    climaxWaveIndex: 0,
    phaseHistory: [...(s.phaseHistory || []), "AFTERCARE"].slice(-12),
  };
}

function enterHold(state, nowMs) {
  return {
    ...state,
    phase: "EDGE_HOLD",
    phaseStartedAt: nowMs,
    phaseDeadlineAt: nowMs + holdWindowMs(state),
    holdCompletedThisVisit: false,
    settleUntil: null,
    relStrength: clamp(Math.max(state.relStrength, 0.58), 0.55, 0.78),
    edgeScore: Math.max(state.edgeScore || 0, 55),
    wireFreqTarget: 55 + (state.placeFreqBias || 0),
    dutyCycle: 0.88,
    channelMode: resolvePlacementChannelMode(state.config.placement, state.channelMode || "both"),
    phaseHistory: [...(state.phaseHistory || []), "EDGE_HOLD"].slice(-12),
  };
}

function completeEdge(state, nowMs) {
  if (state.holdCompletedThisVisit) {
    return {
      ...state,
      phase: "TEASE",
      phaseStartedAt: nowMs,
      phaseDeadlineAt: nowMs + teaseSliceMs(state),
    };
  }
  const dropTo = clamp(0.28 + (state.edgeCountDone || 0) * 0.03, 0.25, 0.42);
  return {
    ...state,
    edgeCountDone: state.edgeCountDone + 1,
    holdCompletedThisVisit: true,
    phase: "TEASE",
    relStrength: Math.min(state.relStrength, dropTo),
    feedbackBias: Math.min(state.feedbackBias || 0, 0),
    settleUntil: nowMs + settleMs(state),
    phaseStartedAt: nowMs,
    phaseDeadlineAt: nowMs + teaseSliceMs(state),
    consecutiveAlmost: 0,
    edgeScore: Math.max(0, (state.edgeScore || 0) * 0.35),
    phaseHistory: [...(state.phaseHistory || []), "TEASE"].slice(-12),
  };
}

function advanceTime(s, now) {
  const dt = Math.max(0, now - (s.lastTickAt || now));
  return {
    ...s,
    lastTickAt: now,
    effectiveElapsedMs: (s.effectiveElapsedMs || 0) + dt,
  };
}

function progressOf(state) {
  const t = state.targetDurationMs || 1;
  return clamp((state.effectiveElapsedMs || 0) / t, 0, 1);
}

function phaseProgressOf(state, nowMs) {
  const start = state.phaseStartedAt || nowMs;
  const end = state.phaseDeadlineAt || nowMs + 1;
  const span = Math.max(1, end - start);
  return clamp((nowMs - start) / span, 0, 1);
}

function phaseBaseline(phase, pp, state, nowMs) {
  const aggro = state.config.aggression ?? 1;
  const base = state.sessionBaseline || 0.12;
  // Scale classic envelopes around session baseline
  const scale = clamp(base / 0.16, 0.7, 1.4);

  switch (phase) {
    case "CALIBRATING":
      return 0.06 + 0.16 * pp; // discovery ramp
    case "WARMUP":
      return (0.12 + 0.18 * pp * aggro) * scale;
    case "BUILD":
      return (0.28 + 0.32 * smoothstep(pp) * aggro) * scale;
    case "TEASE": {
      const wave = 0.5 + 0.5 * Math.sin((state.loopCounter || 0) * 0.11);
      const drop = Math.sin((state.loopCounter || 0) * 0.03) > 0.7 ? 0.22 : 0;
      return clamp(0.38 + 0.28 * wave - drop, 0.2, 0.75) * (0.9 + 0.1 * aggro) * scale;
    }
    case "EDGE_HOLD": {
      const breath = 0.04 * Math.sin((state.loopCounter || 0) * 0.2);
      return clamp(0.62 + 0.1 * pp + breath, 0.55, 0.82) * Math.min(1.1, scale);
    }
    case "SURGE": {
      const beat = ((state.loopCounter || 0) % 25) / 25;
      const crest = beat < 0.7 ? beat / 0.7 : 1 - (beat - 0.7) / 0.3;
      return (0.68 + 0.22 * crest * aggro) * scale;
    }
    case "CLIMAX_PUSH": {
      // v5.1 climax curve model: accelerating freq ramp + amplitude staircase.
      if (state.config?.climaxCurve && state.config.climaxCurve !== "none") {
        const curve = CLIMAX_CURVES[state.config.climaxCurve];
        if (curve) {
          const elapsed = Math.max(0, (nowMs || Date.now()) - (state.phaseStartedAt || 0));
          const c = climaxCurveStep(curve, elapsed);
          return clamp(c.amp * (0.9 + 0.1 * pp) * aggro * scale, 0.72, 1);
        }
      }
      const t = state.loopCounter || 0;
      const wave = Math.pow(0.55 + 0.45 * Math.sin(t * 0.15), 1.2);
      const escalate = 0.82 + 0.18 * pp;
      return clamp(escalate * (0.85 + 0.2 * wave) * aggro * scale, 0.72, 1);
    }
    case "AFTERCARE":
      return Math.max(0.06, 0.35 * (1 - pp) * scale);
    default:
      return state.relStrength || 0.2;
  }
}

function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * F1 (Climax-Fabrik): programmed edging loops while in EDGE_HOLD.
 * Time-driven rise → hold → drop cycles accumulate arousal without
 * requiring the user to do anything; after edgeCycleTarget cycles the
 * edge auto-completes (applyTickGuards). Only active with config.edgeLoops.
 */
function applyEdgeCadence(s, now) {
  if (!s.config?.edgeLoops || s.phase !== "EDGE_HOLD") return s;
  const RISE_MS = 12000;
  const HOLD_MS = 20000;
  const DROP_MS = 8000;

  let idx = s.holdCycleIdx || 0;
  let phase = s.holdCyclePhase || "rise";
  let t0 = s.holdCycleT0 || s.phaseStartedAt || now;
  let rel = s.relStrength;

  const elapsed = now - t0;
  if (phase === "rise") {
    const p = clamp(elapsed / RISE_MS, 0, 1);
    rel = lerp(0.55, 0.75, p);
    if (elapsed >= RISE_MS) {
      phase = "hold";
      t0 = now;
    }
  } else if (phase === "hold") {
    rel = 0.75 + 0.04 * Math.sin((s.loopCounter || 0) * 0.13);
    if (elapsed >= HOLD_MS) {
      phase = "drop";
      t0 = now;
    }
  } else {
    const p = clamp(elapsed / DROP_MS, 0, 1);
    rel = lerp(0.75, 0.5, p);
    if (elapsed >= DROP_MS) {
      idx += 1;
      phase = "rise";
      t0 = now;
    }
  }

  return {
    ...s,
    relStrength: clamp(rel, 0.4, 0.82),
    holdCycleIdx: idx,
    holdCyclePhase: phase,
    holdCycleT0: t0,
  };
}

function applyAdaptiveEnvelope(s, now) {
  const pp = phaseProgressOf(s, now);
  const baseline = phaseBaseline(s.phase, pp, s, now);
  const bias = s.feedbackBias || 0;
  let target = clamp(baseline + bias, s.comfortFloor || 0.08, s.comfortCeiling || 0.95);

  const quietMs = now - (s.lastFeedbackAt || s.startedAt || now);
  const recentTooStrong = s.lastTooStrongAt && now - s.lastTooStrongAt < 12000;
  // Peak-lock: after repeated "good", linger near that intensity
  const lockActive = s.peakLockRel != null && s.peakLockUntil && now < s.peakLockUntil;
  if (lockActive && (s.phase === "BUILD" || s.phase === "TEASE" || s.phase === "WARMUP")) {
    const lock = s.peakLockRel;
    target = clamp(lock + 0.03 * Math.sin((s.loopCounter || 0) * 0.08), lock - 0.04, lock + 0.06);
  } else if (
    s.config.autoClimb !== false &&
    !recentTooStrong &&
    quietMs > 4000 &&
    s.phase !== "AFTERCARE" &&
    s.phase !== "CALIBRATING" &&
    s.phase !== "EDGE_HOLD"
  ) {
    const climb =
      0.0009 * (s.climbRate || 1) * (s.config.aggression || 1) * (quietMs > 15000 ? 1.4 : 1);
    target = clamp(target + climb, s.comfortFloor || 0.08, s.comfortCeiling || 0.95);
  }

  if (s.phase === "EDGE_HOLD" && s.lastAlmostAt && now - s.lastAlmostAt < 3000) {
    target = Math.max(target, 0.68);
  }

  // Push boost waves after almost-during-push
  if (s.phase === "CLIMAX_PUSH" && (s.pushBoostRemaining || 0) > 0 && !s.climaxInDrop) {
    target = clamp(Math.max(target, 0.9 + 0.04 * s.pushBoostRemaining), 0.85, 1);
  }

  // Calibration: forced slow ramp for threshold discovery — until the user
  // responds once ("calibrated"), then the user's level is held.
  if (s.phase === "CALIBRATING") {
    target = s.calibrated ? cur : 0.07 + 0.18 * pp;
  }

  // F22: fresh feedback must be VISIBLE — within 2 s of a user response the
  // envelope stays out of the way so the adjustment lands on the skin.
  const cur = s.relStrength || baseline;
  const freshFeedback = s.lastFeedbackAt != null && now - s.lastFeedbackAt < 2000;
  const alpha = freshFeedback
    ? 0.02
    : s.phase === "CLIMAX_PUSH"
      ? 0.2
      : s.phase === "TEASE"
        ? 0.22
        : 0.12;
  const next = cur + (target - cur) * alpha;

  return { ...s, relStrength: clamp(next, 0, 1) };
}

function applyEdgeScoreTick(s, now) {
  if (s.phase === "AFTERCARE" || s.phase === "COOLDOWN" || s.phase === "CALIBRATING") {
    return s;
  }
  let score = s.edgeScore || 0;
  // Drift up when high intensity without too_strong
  if (s.relStrength >= 0.62 && !(s.lastTooStrongAt && now - s.lastTooStrongAt < 8000)) {
    score += 0.35 * (s.climbRate || 1);
  }
  // Decay slowly when low
  if (s.relStrength < 0.4) score -= 0.25;
  // Near end of hold, boost
  if (s.phase === "EDGE_HOLD") score += 0.15;
  return { ...s, edgeScore: clamp(score, 0, 100) };
}

function applySensationPlane(s, now) {
  const pp = phaseProgressOf(s, now);
  const band = PHASE_FREQ[s.phase] || { lo: 40, hi: 60 };
  const placeBias = s.placeFreqBias || 0;
  let freqTarget = band.lo + (band.hi - band.lo) * pp + placeBias;

  // F1 fullband: work in the official logical 10–1000 Hz range (deep throb →
  // buzz → sharp), encoded to wire at output time.
  const full = !!s.config.freqFullBand;
  const fb = full ? PHASE_FREQ_FULL[s.phase] || { lo: 15, hi: 80 } : null;

  // Tease: oscillate freq
  if (s.phase === "TEASE") {
    if (full) {
      freqTarget = fb.lo + (fb.hi - fb.lo) * (0.5 + 0.5 * Math.sin((s.loopCounter || 0) * 0.09));
      freqTarget += placeBias * 2;
    } else {
      freqTarget =
        band.lo + (band.hi - band.lo) * (0.5 + 0.5 * Math.sin((s.loopCounter || 0) * 0.09));
      freqTarget += placeBias;
    }
  }
  // Push: climb toward high
  if (s.phase === "CLIMAX_PUSH") {
    if (
      s.config.climaxCurve &&
      s.config.climaxCurve !== "none" &&
      CLIMAX_CURVES[s.config.climaxCurve]
    ) {
      // v5.1 climax curve model: accelerating frequency ramp.
      const curve = CLIMAX_CURVES[s.config.climaxCurve];
      const elapsed = Math.max(0, (now || Date.now()) - (s.phaseStartedAt || 0));
      freqTarget = climaxCurveStep(curve, elapsed).f + placeBias * (full ? 2 : 1);
    } else {
      freqTarget =
        (full ? fb.lo : band.lo) +
        ((full ? fb.hi : band.hi) - (full ? fb.lo : band.lo)) * Math.min(1, pp * 1.2) +
        placeBias * (full ? 2 : 1);
    }
  }

  let duty = PHASE_DUTY[s.phase] ?? 0.7;
  if (s.phase === "TEASE") {
    duty = 0.45 + 0.25 * Math.abs(Math.sin((s.loopCounter || 0) * 0.07));
  }
  if (s.phase === "EDGE_HOLD") duty = 0.85 + 0.08 * Math.sin((s.loopCounter || 0) * 0.15);

  let channelMode = s.channelMode || "both";
  const placeId = s.config.placement;
  // Single-channel setups only drive one Coyote output — never alt/lead.
  if (s.config.wiringMode === "single_channel_2") {
    channelMode = "both";
  } else {
    const placeAlt =
      placeId === "dual" ||
      placeId === "loops_ab_penis" ||
      placeId === "loops_ab_glans_hot" ||
      placementPrefersAlternate(placeId);
    if (placeAlt) {
      // Dual-loop / stereo: alternate on tease & edge, fuller both on push
      if (s.phase === "EDGE_HOLD" || s.phase === "TEASE") channelMode = "alt";
      else if (s.phase === "CLIMAX_PUSH" || s.phase === "SURGE") channelMode = "both";
      else channelMode = resolvePlacementChannelMode(placeId, channelMode);
    } else if (s.phase === "TEASE") {
      channelMode = (s.loopCounter || 0) % 60 < 30 ? "alt" : "both";
    } else if (s.phase === "CLIMAX_PUSH") {
      channelMode = "both";
    }
    // Climax priority: never leave one channel cold during push
    if (s.phase === "CLIMAX_PUSH" && s.config.climaxPriority) {
      channelMode = "both";
    }
  }

  return {
    ...s,
    wireFreqTarget: full ? clamp(freqTarget, 10, 1000) : clamp(freqTarget, 10, 240),
    logicalFreqTarget: full ? clamp(freqTarget, 10, 1000) : null,
    dutyCycle: clamp(duty * (s.placeDutyScale || 1), 0.2, 1),
    channelMode,
  };
}

function applyHabituation(s, now) {
  if (s.phase === "AFTERCARE" || s.phase === "COOLDOWN" || s.phase === "CALIBRATING") return s;

  const next = { ...s };
  const progress = progressOf(s);
  const allowSoftReset =
    s.phase !== "CLIMAX_PUSH" &&
    s.phase !== "EDGE_HOLD" &&
    s.phase !== "SURGE" &&
    progress < 0.75 &&
    (s.effectiveElapsedMs || 0) > 45000;

  if (
    allowSoftReset &&
    !s.softResetUntil &&
    (s.effectiveElapsedMs || 0) > 0 &&
    (s.effectiveElapsedMs || 0) % SOFT_RESET_MS < 120
  ) {
    next.softResetUntil = now + randRange(2000, 4500);
  }
  if (s.softResetUntil && now >= s.softResetUntil) {
    next.softResetUntil = 0;
  }

  if (now >= (s.nextHabituationAt || 0)) {
    next.patternSegment = (s.patternSegment || 0) + 1;
    next.nextHabituationAt = now + randRange(HABITUATION_MS_MIN, HABITUATION_MS_MAX);
  }
  return next;
}

/** Late-session pressure: accelerate toward push when time runs out. */
function applyTimePressure(s, now) {
  const p = progressOf(s);
  if (p < 0.72) return s;
  if (
    s.phase === "CLIMAX_PUSH" ||
    s.phase === "AFTERCARE" ||
    s.phase === "COOLDOWN" ||
    s.phase === "SURGE"
  ) {
    return s;
  }
  const remain = (s.phaseDeadlineAt || now) - now;
  let next = s;
  if (remain > 8000) {
    next = {
      ...s,
      phaseDeadlineAt: now + Math.max(4000, Math.round(remain * 0.55)),
      climbRate: Math.min(1.8, (s.climbRate || 1) * 1.15),
      feedbackBias: clamp((s.feedbackBias || 0) + 0.02, -0.2, 0.35),
    };
  }
  if (
    next.phase === "TEASE" &&
    (next.edgeCountDone || 0) >= (next.edgeCountTarget || 0) &&
    p >= 0.8
  ) {
    return setPhase(next, "SURGE", now, shareMs(next.targetDurationMs, "SURGE", next.config));
  }
  return next;
}

/**
 * Multi-wave climax protocol: crest/drop cycles.
 */
function applyClimaxWave(s, now) {
  if (s.phase !== "CLIMAX_PUSH") {
    return { ...s, climaxWaveIndex: 0, climaxWaveStartedAt: 0, climaxInDrop: false };
  }

  const table = climaxWaveTable(s.config);
  let idx = s.climaxWaveIndex || 0;
  let started = s.climaxWaveStartedAt || s.phaseStartedAt || now;
  let inDrop = !!s.climaxInDrop;
  const wave = table[Math.min(idx, table.length - 1)];
  const elapsed = now - started;
  const finish = !!s.config?.climaxPriority;
  // Finish path: less deep valleys so orgasm doesn't fall off
  const dropFloor = finish ? 0.68 : 0.55;
  const reenterFloor = finish ? 0.8 : 0.72;

  let rel = s.relStrength;
  if (!inDrop) {
    // Crest: climb
    const crestP = clamp(elapsed / wave.crestMs, 0, 1);
    const peak = clamp(0.82 + wave.peakBoost + (s.feedbackBias || 0), 0.75, 1);
    rel = lerp(Math.max(0.7, s.relStrength), peak, 0.15 + 0.1 * crestP);
    if (elapsed >= wave.crestMs) {
      if (wave.dropMs > 0 && idx < table.length - 1) {
        inDrop = true;
        started = now;
      } else if (idx < table.length - 1) {
        idx += 1;
        started = now;
      }
    }
  } else {
    // Drop: brief relief then next wave
    rel = lerp(s.relStrength, dropFloor, finish ? 0.18 : 0.25);
    if (elapsed >= wave.dropMs) {
      inDrop = false;
      idx = Math.min(idx + 1, table.length - 1);
      started = now;
      rel = Math.max(rel, reenterFloor);
      // Consume one push-boost after a drop cycle
      if ((s.pushBoostRemaining || 0) > 0) {
        return {
          ...s,
          climaxWaveIndex: idx,
          climaxWaveStartedAt: started,
          climaxInDrop: false,
          relStrength: clamp(Math.max(rel, finish ? 0.9 : 0.88), 0, 1),
          pushBoostRemaining: s.pushBoostRemaining - 1,
          wireFreqTarget: clamp((s.wireFreqTarget || 90) + 8, 10, 240),
        };
      }
    }
  }

  return {
    ...s,
    climaxWaveIndex: idx,
    climaxWaveStartedAt: started,
    climaxInDrop: inDrop,
    relStrength: clamp(rel, 0, 1),
  };
}

function applyMicroMod(s, now) {
  if (s.softResetUntil && now < s.softResetUntil) return s;
  if (s.phase === "TEASE") {
    const t = s.loopCounter || 0;
    if (t % 80 > 72) {
      return { ...s, relStrength: Math.min(s.relStrength, 0.15) };
    }
  }
  // Micro-stutters help tease; they kill orgasm on finish path — skip when climaxPriority
  if (s.phase === "CLIMAX_PUSH" && !s.climaxInDrop && !s.config?.climaxPriority) {
    const t = s.loopCounter || 0;
    if (t % 18 === 0) {
      return { ...s, relStrength: Math.max(0.55, s.relStrength * 0.75) };
    }
  }
  if (s.phase === "EDGE_HOLD") {
    return {
      ...s,
      relStrength: clamp(s.relStrength + 0.0004 * (s.climbRate || 1), 0.55, 0.8),
    };
  }
  return s;
}

function effectiveRelStrength(state) {
  let r = state.relStrength || 0;
  if (state.phase === "BUILD" || state.phase === "WARMUP") {
    r += 0.02 * Math.sin((state.loopCounter || 0) * 0.25);
  }
  return clamp(r, 0, 1);
}

function setPhase(s, phase, now, durationMs) {
  return {
    ...s,
    phase,
    phaseStartedAt: now,
    phaseDeadlineAt: now + durationMs,
    patternSegment: 0,
    microPhase: 0,
    climaxWaveIndex: 0,
    climaxWaveStartedAt: now,
    climaxInDrop: false,
    phaseHistory: [...(s.phaseHistory || []), phase].slice(-12),
  };
}

/**
 * Enter CLIMAX_PUSH. On a retry (pushRetriesUsed > 0) grants extra boost
 * waves so the re-attempt is stronger than the one before.
 */
function enterPush(s, now) {
  const next = setPhase(s, "CLIMAX_PUSH", now, pushDurationMs(s));
  const retries = next.pushRetriesUsed || 0;
  if (retries > 0) {
    next.pushBoostRemaining = (next.pushBoostRemaining || 0) + pushBoostForRetry(retries);
  }
  return next;
}

function applyPhaseTimeout(s, now) {
  const goal = s.config.goal;
  const needsEdges = NEEDS_EDGES.has(goal);

  switch (s.phase) {
    case "CALIBRATING": {
      // Lock session baseline from current intensity
      const baseline = clamp(s.relStrength || 0.12, 0.08, 0.35);
      return setPhase(
        {
          ...s,
          sessionBaseline: baseline,
          calibrated: true,
          comfortFloor: Math.max(0.08, baseline * 0.7),
        },
        "WARMUP",
        now,
        shareMs(s.targetDurationMs, "WARMUP", s.config)
      );
    }
    case "WARMUP":
      return setPhase(s, "BUILD", now, shareMs(s.targetDurationMs, "BUILD", s.config));
    case "BUILD":
      return setPhase(s, "TEASE", now, shareMs(s.targetDurationMs, "TEASE", s.config));
    case "TEASE":
      if (needsEdges && s.edgeCountDone < s.edgeCountTarget) {
        return enterHold(s, now);
      }
      return setPhase(s, "SURGE", now, shareMs(s.targetDurationMs, "SURGE", s.config));
    case "EDGE_HOLD":
      return completeEdge(s, now);
    case "SURGE":
      return enterPush(s, now);
    case "CLIMAX_PUSH":
      if (
        s.config.goal === "deny_then_release" &&
        (s.denyCount || 0) < (s.maxDenies || 1) &&
        !s.userMarkedClimax
      ) {
        return enterHold(
          {
            ...s,
            denyCount: (s.denyCount || 0) + 1,
            relStrength: clamp(s.relStrength - 0.35, 0.2, 0.5),
            feedbackBias: -0.1,
            edgeScore: 40,
          },
          now
        );
      }
      // F1 multi-climax: after a marked climax, rest in COOLDOWN and try
      // again until climaxTarget is reached.
      if (s.userMarkedClimax) {
        const count = (s.climaxCount || 0) + 1;
        if ((s.config.climaxTarget || 1) > 1 && count < (s.config.climaxTarget || 1)) {
          return setPhase(
            {
              ...s,
              climaxCount: count,
              relStrength: 0.05,
              feedbackBias: clamp((s.feedbackBias || 0) + 0.05, -0.2, 0.35),
              aggression: clamp((s.config.aggression || 1) + 0.1 * count, 0.5, 1.6),
            },
            "COOLDOWN",
            now,
            180000
          );
        }
        return enterAftercare({ ...s, climaxCount: count }, now, true);
      }
      // v6.1 push-retry ("Abspritzgarantie"): an unmarked push timeout does not
      // end the session — re-arm a short TEASE slice and push again, stronger.
      // Bounded by pushRetryBudget; user can always stop/panic.
      if (
        (s.config.pushRetry === true || pushRetryBudget(s.config).enabled) &&
        (s.pushRetriesUsed || 0) < pushRetryBudget(s.config).maxRetries
      ) {
        const retries = (s.pushRetriesUsed || 0) + 1;
        return {
          ...setPhase(s, "TEASE", now, PUSH_RETRY.reArmMs),
          pushRetriesUsed: retries,
          relStrength: 0.4,
          edgeScore: Math.max(45, (s.edgeScore || 0) * 0.6),
          feedbackBias: clamp((s.feedbackBias || 0) + 0.04, -0.2, 0.35),
          lastFeedbackAt: now,
          lastFeedback: "not_yet",
        };
      }
      return enterAftercare(s, now, false);
    case "AFTERCARE":
      return setPhase({ ...s, relStrength: 0 }, "COOLDOWN", now, 12000);
    case "COOLDOWN":
      // F1: refractory over → next climax attempt (multi-climax sessions).
      if (
        (s.config.climaxTarget || 1) > 1 &&
        (s.climaxCount || 0) >= 1 &&
        (s.climaxCount || 0) < (s.config.climaxTarget || 1)
      ) {
        return setPhase(s, "BUILD", now, shareMs(s.targetDurationMs, "BUILD", s.config));
      }
      return idleState(s, now);
    default:
      return s;
  }
}

function applyTickGuards(s, now) {
  // F1: programmed edging loops — auto-complete the edge after N cycles.
  if (
    s.phase === "EDGE_HOLD" &&
    s.config?.edgeLoops &&
    (s.config.edgeCycleTarget || 0) > 0 &&
    !s.holdCompletedThisVisit &&
    (s.holdCycleIdx || 0) >= s.config.edgeCycleTarget
  ) {
    return completeEdge(s, now);
  }

  // Edge score → enter hold
  if (
    (s.phase === "TEASE" || s.phase === "BUILD") &&
    NEEDS_EDGES.has(s.config.goal) &&
    s.edgeCountDone < s.edgeCountTarget &&
    (s.edgeScore || 0) >= 72
  ) {
    return enterHold(s, now);
  }

  if (
    s.phase === "TEASE" &&
    s.edgeCountDone >= s.edgeCountTarget &&
    s.edgeCountTarget > 0 &&
    s.settleUntil != null &&
    now >= s.settleUntil
  ) {
    return setPhase(
      { ...s, settleUntil: null },
      "SURGE",
      now,
      shareMs(s.targetDurationMs, "SURGE", s.config)
    );
  }
  if (s.phase === "TEASE" && s.config.goal === "direct" && progressOf(s) >= 0.55) {
    return setPhase(s, "SURGE", now, shareMs(s.targetDurationMs, "SURGE", s.config));
  }
  if (s.phase === "BUILD" && s.config.templateId === "turbo" && progressOf(s) >= 0.35) {
    return setPhase(s, "SURGE", now, shareMs(s.targetDurationMs, "SURGE", s.config));
  }
  if (
    s.phase === "TEASE" &&
    NEEDS_EDGES.has(s.config.goal) &&
    s.edgeCountDone < s.edgeCountTarget &&
    s.relStrength >= 0.7 &&
    phaseProgressOf(s, now) > 0.85
  ) {
    return enterHold(s, now);
  }
  // High edge score during surge → push early
  if (s.phase === "SURGE" && (s.edgeScore || 0) >= 80) {
    return enterPush(s, now);
  }
  return s;
}

function applyFeedback(s, feedback, now) {
  const goal = s.config.goal;
  const needsEdges = NEEDS_EDGES.has(goal);
  const drop = dropDepth(s);

  if (feedback === "too_weak") {
    let next = {
      ...s,
      relStrength: clamp(s.relStrength + 0.1, 0, 1),
      feedbackBias: clamp((s.feedbackBias || 0) + 0.06, -0.3, 0.35),
      comfortFloor: clamp(Math.max(s.comfortFloor || 0.1, s.relStrength + 0.05), 0.08, 0.7),
      climbRate: Math.min(1.6, (s.climbRate || 1) * 1.15),
      lastTooWeakAt: now,
      consecutiveGood: 0,
      edgeScore: Math.max(0, (s.edgeScore || 0) - 5),
      sessionTooWeakCount: (s.sessionTooWeakCount || 0) + 1,
      peakLockRel: null,
      peakLockUntil: 0,
      pendingPrompt: null,
      nextPromptAt: now + 25000,
    };
    if (s.phase === "CALIBRATING") {
      next.sessionBaseline = clamp(Math.max(s.sessionBaseline || 0.1, next.relStrength), 0.08, 0.4);
      next.relStrength = clamp(next.relStrength + 0.05, 0, 0.4);
    }
    if (s.phase === "CALIBRATING" || s.phase === "WARMUP") {
      if (s.phase === "WARMUP" || (s.phase === "CALIBRATING" && next.relStrength > 0.22)) {
        next = setPhase(
          {
            ...next,
            calibrated: true,
            sessionBaseline: next.sessionBaseline || next.relStrength,
          },
          s.phase === "CALIBRATING" ? "WARMUP" : "BUILD",
          now,
          shareMs(s.targetDurationMs, s.phase === "CALIBRATING" ? "WARMUP" : "BUILD", s.config)
        );
      }
    }
    if (s.phase === "CLIMAX_PUSH") {
      next.relStrength = clamp(next.relStrength + 0.08, 0, 1);
    }
    return next;
  }

  if (feedback === "good") {
    const hits = (s.consecutiveGood || 0) + 1;
    let next = {
      ...s,
      relStrength: clamp(s.relStrength + 0.025, 0, 1),
      feedbackBias: clamp((s.feedbackBias || 0) + 0.015, -0.3, 0.3),
      consecutiveGood: hits,
      climbRate: Math.min(1.3, (s.climbRate || 1) * 1.05),
      sessionGoodCount: (s.sessionGoodCount || 0) + 1,
      pendingPrompt: null,
      nextPromptAt: now + 35000,
    };
    // Peak-lock after 2+ goods: hold this zone ~25–40s
    if (hits >= 2 && s.phase !== "CALIBRATING" && s.phase !== "CLIMAX_PUSH") {
      next.peakLockRel = clamp(s.relStrength, 0.2, 0.85);
      next.peakLockUntil = now + 25000 + Math.min(15000, hits * 4000);
      next.peakLockHits = (s.peakLockHits || 0) + 1;
    }
    if (s.phase === "CALIBRATING") {
      next.sessionBaseline = clamp(s.relStrength, 0.08, 0.35);
      next.calibrated = true;
      next = setPhase(next, "WARMUP", now, shareMs(s.targetDurationMs, "WARMUP", s.config));
    } else if (s.phase === "WARMUP" && phaseProgressOf(s, now) >= 0.4) {
      next = setPhase(next, "BUILD", now, shareMs(s.targetDurationMs, "BUILD", s.config));
    }
    if (s.phase === "BUILD" && next.consecutiveGood >= 3 && phaseProgressOf(s, now) >= 0.35) {
      next = setPhase(next, "TEASE", now, shareMs(s.targetDurationMs, "TEASE", s.config));
    }
    return next;
  }

  if (feedback === "too_strong") {
    let next = {
      ...s,
      relStrength: clamp(s.relStrength - drop, 0, 1),
      feedbackBias: clamp((s.feedbackBias || 0) - drop * 0.8, -0.35, 0.25),
      comfortCeiling: clamp(Math.min(s.comfortCeiling || 0.95, s.relStrength - 0.02), 0.35, 0.98),
      climbRate: Math.max(0.35, (s.climbRate || 1) * 0.55),
      lastTooStrongAt: now,
      settleUntil: now + 6000 + Math.round(Math.random() * 8000),
      consecutiveGood: 0,
      consecutiveAlmost: 0,
      edgeScore: Math.max(0, (s.edgeScore || 0) - 20),
      sessionTooStrongCount: (s.sessionTooStrongCount || 0) + 1,
      peakLockRel: null,
      peakLockUntil: 0,
      pendingPrompt: null,
      nextPromptAt: now + 20000,
    };
    if (s.phase === "CALIBRATING") {
      next.sessionBaseline = clamp(next.relStrength * 0.9, 0.06, 0.3);
      next.calibrated = true;
    }
    // Finish-focused sessions: stay in multi-wave push, only drop intensity
    if (s.phase === "BUILD") {
      next = setPhase(next, "TEASE", now, shareMs(s.targetDurationMs, "TEASE", s.config));
    } else if (s.phase === "CLIMAX_PUSH" && !s.config.climaxPriority) {
      next = setPhase(next, "TEASE", now, shareMs(s.targetDurationMs, "TEASE", s.config));
    }
    // v6.1 finish-push floor: a "too strong" drop may reduce but never falls
    // below the floor during a climaxPriority push — otherwise the orgasm that
    // is building gets killed by a large intensity step ("Abspritzgarantie").
    if (s.phase === "CLIMAX_PUSH" && s.config.climaxPriority) {
      next.relStrength = clamp(next.relStrength, pushFloorRel(s.config, s.pushRetriesUsed || 0), 1);
    }
    return next;
  }

  if (feedback === "almost") {
    const scoreUp = {
      ...s,
      lastAlmostAt: now,
      consecutiveAlmost: (s.consecutiveAlmost || 0) + 1,
      almostWithoutClimax: (s.almostWithoutClimax || 0) + 1,
      edgeScore: clamp((s.edgeScore || 0) + 20, 0, 100),
      feedbackBias: Math.min(s.feedbackBias || 0, 0.05),
      climbRate: Math.max(0.5, (s.climbRate || 1) * 0.8),
      sessionAlmostCount: (s.sessionAlmostCount || 0) + 1,
      pendingPrompt: null,
      nextPromptAt: now + 30000,
    };
    if (s.phase === "EDGE_HOLD") {
      return completeEdge(scoreUp, now);
    }
    if (s.phase === "BUILD" || s.phase === "TEASE" || s.phase === "WARMUP" || s.phase === "SURGE") {
      return enterHold(scoreUp, now);
    }
    if (s.phase === "CLIMAX_PUSH") {
      const almostN = (s.almostWithoutClimax || 0) + 1;
      // Quality loop: 3+ almost without climax → longer push + more boost
      const boost = almostN >= 3 ? 3 : 2;
      const extend = almostN >= 3 ? 35000 : 20000;
      return {
        ...scoreUp,
        almostWithoutClimax: almostN,
        qualityBoost: almostN >= 3 ? 1 : s.qualityBoost || 0,
        relStrength: clamp(s.relStrength * 0.72, 0.48, 0.82),
        climaxInDrop: true,
        climaxWaveStartedAt: now,
        pushBoostRemaining: boost,
        wireFreqTarget: clamp((s.wireFreqTarget || 80) + 15 + (almostN >= 3 ? 10 : 0), 10, 240),
        dutyCycle: 0.9,
        phaseDeadlineAt: Math.max(s.phaseDeadlineAt || now, now) + extend,
        pendingPrompt:
          almostN >= 3
            ? "Mehrere × Fast — Push verlängert. Soft-Limits ok? Placement prüfen?"
            : scoreUp.pendingPrompt,
      };
    }
    return scoreUp;
  }

  // Manual intensity nudge from UI (±)
  if (feedback === "nudge_up" || feedback === "nudge_down") {
    const delta = feedback === "nudge_up" ? 0.06 : -0.07;
    return {
      ...s,
      relStrength: clamp(s.relStrength + delta, 0.05, 1),
      feedbackBias: clamp((s.feedbackBias || 0) + delta * 0.5, -0.35, 0.35),
      peakLockRel: null,
      peakLockUntil: 0,
      lastFeedbackAt: now,
      lastFeedback: feedback,
      sessionTooWeakCount:
        feedback === "nudge_up" ? (s.sessionTooWeakCount || 0) + 1 : s.sessionTooWeakCount || 0,
      sessionTooStrongCount:
        feedback === "nudge_down"
          ? (s.sessionTooStrongCount || 0) + 1
          : s.sessionTooStrongCount || 0,
    };
  }

  if (feedback === "now") {
    if (
      s.phase === "EDGE_HOLD" ||
      s.phase === "TEASE" ||
      s.phase === "SURGE" ||
      s.phase === "BUILD" ||
      s.phase === "WARMUP"
    ) {
      return enterPush(
        {
          ...s,
          relStrength: clamp(Math.max(s.relStrength, 0.8), 0.8, 1),
          feedbackBias: 0.1,
          climbRate: 1.3,
          edgeScore: 90,
        },
        now
      );
    }
    return s;
  }

  if (feedback === "not_yet") {
    if (s.phase === "CLIMAX_PUSH") {
      if (needsEdges) {
        const next = enterHold(s, now);
        next.relStrength = clamp(s.relStrength - 0.18, 0.2, 0.55);
        next.feedbackBias = -0.08;
        next.edgeScore = 50;
        next.denyCount = (s.denyCount || 0) + (s.config.goal === "deny_then_release" ? 1 : 0);
        return next;
      }
      return setPhase(
        {
          ...s,
          relStrength: clamp(s.relStrength - 0.18, 0.2, 0.55),
          feedbackBias: -0.08,
          edgeScore: Math.max(30, (s.edgeScore || 0) * 0.5),
        },
        "TEASE",
        now,
        shareMs(s.targetDurationMs, "TEASE", s.config)
      );
    }
    return s;
  }

  return s;
}

function patternForPhase(state, nowMs) {
  const allowClimax = !!state.config.allowClimaxPatterns;
  const phase = state.phase;
  const t = (state.loopCounter || 0) + (state.patternSegment || 0) * 17;
  const pp = phaseProgressOf(state, nowMs);
  /** @type {string} */
  let patternId = "gentle";
  let ampScale = 1;
  let freqBias = 0;

  // Avoid repeating last pattern when segment changes
  const pick = (options) => {
    const filtered = options.filter((p) => p !== state.lastPatternId);
    const list = filtered.length ? filtered : options;
    return list[Math.floor(t / 20) % list.length];
  };

  switch (phase) {
    case "CALIBRATING":
      patternId = t % 30 < 18 ? "gentle" : "heartbeat";
      ampScale = 0.55;
      break;
    case "WARMUP":
      if (pp < 0.4) patternId = "gentle";
      else if (pp < 0.75) patternId = "wave";
      else patternId = "heartbeat";
      ampScale = 0.7 + 0.2 * pp;
      break;
    case "BUILD":
      patternId = pick(["escalate", "rhythm", "drift"]);
      ampScale = 0.85 + 0.15 * pp;
      break;
    case "TEASE":
      patternId = pick(["tease", "alternate", "sawtooth", "flutter"]);
      ampScale = 0.75 + 0.2 * Math.abs(Math.sin(t * 0.05));
      break;
    case "EDGE_HOLD":
      patternId = t % 50 < 30 ? "flutter" : "heartbeat";
      ampScale = allowClimax ? 0.72 + 0.08 * pp : 0.55 + 0.1 * pp;
      freqBias = 5;
      break;
    case "SURGE":
      patternId = allowClimax
        ? pick(["climax", "strobe", "duet"])
        : pick(["strobe", "escalate", "rhythm"]);
      ampScale = allowClimax ? 0.95 : 0.72;
      break;
    case "CLIMAX_PUSH":
      if (allowClimax) {
        patternId = pick(["climax", "strobe", "flutter", "duet"]);
        ampScale = 0.95 + 0.05 * pp;
      } else {
        patternId = pick(["escalate", "strobe", "rhythm", "duet"]);
        ampScale = 0.88;
      }
      freqBias = 10 * pp;
      break;
    case "AFTERCARE":
      patternId = t % 40 < 25 ? "gentle" : "heartbeat";
      ampScale = 0.45 * (1 - pp * 0.5);
      break;
    default:
      patternId = "gentle";
  }
  return { patternId, ampScale, freqBias };
}

function phaseTip(state) {
  if (state.pendingPrompt) return state.pendingPrompt;
  if (state.peakLockRel != null && state.peakLockUntil) {
    // tip only if still locked — checked by caller via peakLockActive mostly
  }
  const place = getPlacementProfile(state.config?.placement);
  switch (state.phase) {
    case "CALIBRATING":
      return `Kalibrierung (${place.label}): Zu schwach / Gut / Zu stark — Baseline speichern`;
    case "WARMUP":
      return `Aufwärmen · ${place.sensation || place.description}`;
    case "BUILD":
      return `Aufbau · Edge-Score ${Math.round(state.edgeScore || 0)} — „Fast“ wenn nah`;
    case "TEASE":
      return "Tease — „Jetzt“ = Push, „Fast“ = Edge";
    case "EDGE_HOLD": {
      const sec = Math.ceil(
        Math.max(0, (state.phaseDeadlineAt || 0) - (state.lastTickAt || 0)) / 1000
      );
      return `Edge halten — noch ~${sec}s · „Fast“ bestätigt`;
    }
    case "SURGE":
      return "Starke Wellen — gleich Multi-Wave-Push";
    case "CLIMAX_PUSH": {
      const w = (state.climaxWaveIndex || 0) + 1;
      const n = climaxWaveTable(state.config).length;
      const boost = (state.pushBoostRemaining || 0) > 0 ? " · Boost aktiv" : "";
      const retries = state.pushRetriesUsed || 0;
      const retryNote =
        retries > 0 ? ` · Push-Versuch ${retries + 1}/${(state.pushRetryTotal || 1) + 1}` : "";
      return `Push-Welle ${w}/${n}${boost}${retryNote} — „Fertig ✓“ wenn du kommst`;
    }
    case "AFTERCARE":
      return state.userMarkedClimax
        ? "Höhepunkt markiert — weiches Ausklingen"
        : "Session endet — weiches Ausklingen";
    case "PAUSED":
      return "Pausiert — Weiter zum Fortsetzen";
    case "COOLDOWN": {
      const tgt = state.config?.climaxTarget || 1;
      if (tgt > 1 && (state.climaxCount || 0) >= 1 && (state.climaxCount || 0) < tgt) {
        const sec = Math.ceil(
          Math.max(0, (state.phaseDeadlineAt || 0) - (state.lastTickAt || 0)) / 1000
        );
        return `Refraktär-Pause — Versuch ${(state.climaxCount || 0) + 1}/${tgt} in ~${sec}s`;
      }
      return "Cooldown — Output aus, Session endet gleich";
    }
    default:
      return place.tips?.[0] || "";
  }
}

function nextStepHint(state) {
  const need = state.edgeCountTarget || 0;
  const done = state.edgeCountDone || 0;
  if (state.phase === "CALIBRATING") return "Baseline finden";
  if (state.phase === "WARMUP" || state.phase === "BUILD") {
    if (need > 0) return `Danach: Edge ${done + 1}/${need}`;
    return "Danach: Surge → Push";
  }
  if (state.phase === "TEASE") {
    if (need > done) return `Noch ${need - done} Edge(s)`;
    return "Als Nächstes: Surge → Push";
  }
  if (state.phase === "EDGE_HOLD") return `Edge ${done + 1}/${Math.max(need, done + 1)}`;
  if (state.phase === "SURGE") return "Gleich: Climax-Push";
  if (state.phase === "CLIMAX_PUSH") return "Drüber kommen · Fertig tippen";
  if (state.phase === "AFTERCARE") return "Gleich fertig";
  return "";
}

function applyFeedbackPrompts(s, now) {
  if (s.phase === "AFTERCARE" || s.phase === "COOLDOWN" || s.phase === "CALIBRATING") {
    return { ...s, pendingPrompt: null };
  }
  // Clear prompt after feedback
  if (s.lastFeedbackAt && s.lastFeedbackAt > (s.lastPromptAt || 0)) {
    // keep scheduling
  }
  if (s.nextPromptAt && now >= s.nextPromptAt && !s.pendingPrompt) {
    const prompts = {
      WARMUP: "Noch ok? Tippe Gut / Zu schwach / Zu stark",
      BUILD: "Wie fühlt sich das an? Gut · Fast · Zu stark",
      TEASE: "Nah dran? → Fast · Jetzt zum Push",
      EDGE_HOLD: "Am Limit? Fast = Edge zählen",
      SURGE: "Bereit zum Push? Jetzt / Fast",
      CLIMAX_PUSH: "Kommst du? Fertig ✓ · Fast · Noch nicht",
    };
    const text = prompts[s.phase] || "Kurzes Feedback? Gut / Fast / Zu stark";
    return {
      ...s,
      pendingPrompt: text,
      lastPromptAt: now,
      nextPromptAt: now + 45000 + Math.round(Math.random() * 30000),
    };
  }
  // Auto-dismiss prompt after 12s without acting (still re-prompt later)
  if (s.pendingPrompt && s.lastPromptAt && now - s.lastPromptAt > 12000) {
    return { ...s, pendingPrompt: null };
  }
  return s;
}
