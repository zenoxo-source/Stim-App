// autodrive-engine.js — Pure adaptive Autodrive state machine (no DOM / BLE).
// Design goals: high climax success via adaptation, variety, edge ladder, safety caps.

/** @typedef {"IDLE"|"CALIBRATING"|"WARMUP"|"BUILD"|"TEASE"|"EDGE_HOLD"|"SURGE"|"CLIMAX_PUSH"|"AFTERCARE"|"COOLDOWN"|"PAUSED"} AutodrivePhase */
/** @typedef {"direct"|"edge_then_release"|"edge_ladder"|"deny_then_release"} AutodriveGoal */
/** @typedef {"too_weak"|"good"|"too_strong"|"almost"|"now"|"climaxed"|"not_yet"} AutodriveFeedback */
/** @typedef {"gentle"|"medium"|"intense"} AutodriveSensitivity */
/** @typedef {"A"|"B"|"both"} ChannelFocus */

export const AUTODRIVE_TEMPLATES = Object.freeze({
  quick_finish: {
    id: "quick_finish",
    label: "Schnell",
    description: "5 Min, direkt zum Höhepunkt",
    targetDurationMin: 5,
    goal: "direct",
    sensitivity: "medium",
    edgeCount: 0,
    maxSessionIntensityFactor: 0.95,
    allowClimaxPatterns: true,
    aggression: 1.15,
  },
  classic: {
    id: "classic",
    label: "Klassisch",
    description: "12 Min, 2 Edges, dann Push",
    targetDurationMin: 12,
    goal: "edge_then_release",
    sensitivity: "medium",
    edgeCount: 2,
    maxSessionIntensityFactor: 0.95,
    allowClimaxPatterns: true,
    aggression: 1.0,
  },
  long_tease: {
    id: "long_tease",
    label: "Langer Tease",
    description: "20 Min, 4 Edges, sanft steigend",
    targetDurationMin: 20,
    goal: "edge_ladder",
    sensitivity: "gentle",
    edgeCount: 4,
    maxSessionIntensityFactor: 0.9,
    allowClimaxPatterns: false,
    aggression: 0.85,
  },
  intense: {
    id: "intense",
    label: "Intensiv",
    description: "10 Min, harter Drive, Cap 85%",
    targetDurationMin: 10,
    goal: "direct",
    sensitivity: "intense",
    edgeCount: 1,
    maxSessionIntensityFactor: 0.85,
    allowClimaxPatterns: true,
    aggression: 1.25,
  },
  marathon: {
    id: "marathon",
    label: "Marathon",
    description: "30 Min, 6 Edges, Ausdauer",
    targetDurationMin: 30,
    goal: "edge_ladder",
    sensitivity: "gentle",
    edgeCount: 6,
    maxSessionIntensityFactor: 0.88,
    allowClimaxPatterns: true,
    aggression: 0.75,
  },
  turbo: {
    id: "turbo",
    label: "Turbo",
    description: "3 Min, aggressiv, wenig Tease",
    targetDurationMin: 3,
    goal: "direct",
    sensitivity: "intense",
    edgeCount: 0,
    maxSessionIntensityFactor: 0.98,
    allowClimaxPatterns: true,
    aggression: 1.4,
  },
  deny: {
    id: "deny",
    label: "Deny & Release",
    description: "Fast abspritzen → Deny → harter Push",
    targetDurationMin: 15,
    goal: "deny_then_release",
    sensitivity: "medium",
    edgeCount: 3,
    maxSessionIntensityFactor: 0.92,
    allowClimaxPatterns: true,
    aggression: 1.1,
  },
});

export const AUTODRIVE_CONFIG_DEFAULTS = Object.freeze({
  templateId: "classic",
  goal: "edge_then_release",
  sensitivity: "medium",
  channelFocus: "both",
  coupledFraction: 0.3,
  maxSessionIntensity: null,
  allowClimaxPatterns: false,
  autoStopMinutes: null,
  skipCalibration: false,
  edgeCount: 2,
  targetDurationMin: 12,
  maxSessionIntensityFactor: 0.95,
  aggression: 1.0,
  autoClimb: true,
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

/** Base phase shares (rebalanced for longer climax pressure) */
const PHASE_SHARES = Object.freeze({
  WARMUP: 0.1,
  BUILD: 0.26,
  TEASE: 0.2,
  EDGE_HOLD: 0.1,
  SURGE: 0.1,
  CLIMAX_PUSH: 0.24,
});

const NEEDS_EDGES = new Set(["edge_then_release", "edge_ladder", "deny_then_release"]);

const VALID_GOALS = new Set(["direct", "edge_then_release", "edge_ladder", "deny_then_release"]);
const VALID_SENS = new Set(["gentle", "medium", "intense"]);
const VALID_FOCUS = new Set(["A", "B", "both"]);
const VALID_FEEDBACK = new Set([
  "too_weak",
  "good",
  "too_strong",
  "almost",
  "now",
  "climaxed",
  "not_yet",
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
  }

  if (typeof raw.goal === "string" && VALID_GOALS.has(raw.goal)) base.goal = raw.goal;
  if (typeof raw.sensitivity === "string" && VALID_SENS.has(raw.sensitivity)) {
    base.sensitivity = raw.sensitivity;
  }
  if (typeof raw.channelFocus === "string" && VALID_FOCUS.has(raw.channelFocus)) {
    base.channelFocus = raw.channelFocus;
  }
  if (raw.coupledFraction !== undefined) {
    const f = Number(raw.coupledFraction);
    if (Number.isFinite(f)) base.coupledFraction = clamp(f, 0, 1);
  }
  if (raw.maxSessionIntensity != null) {
    const m = Number(raw.maxSessionIntensity);
    if (Number.isFinite(m) && m > 0) base.maxSessionIntensity = Math.round(clamp(m, 1, 200));
  }
  if (typeof raw.allowClimaxPatterns === "boolean") {
    base.allowClimaxPatterns = raw.allowClimaxPatterns;
  }
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

  if (base.autoStopMinutes == null) {
    base.autoStopMinutes = Math.max(base.targetDurationMin + 8, 30);
  }
  return base;
}

/**
 * @param {ReturnType<typeof sanitiseAutodriveConfig>} config
 * @param {number} nowMs
 */
export function createInitialState(config, nowMs) {
  const cfg = sanitiseAutodriveConfig(config);
  const targetDurationMs = Math.round(cfg.targetDurationMin * 60 * 1000);
  const skip = !!cfg.skipCalibration;
  const phase = skip ? "WARMUP" : "CALIBRATING";
  const phaseMs = skip ? shareMs(targetDurationMs, "WARMUP", cfg) : 18000;
  const baseRel = skip ? 0.16 : 0.08;
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
    /** Target relative intensity (feedback-aware). Envelope approaches this. */
    relStrength: baseRel,
    /** Soft floor/ceiling learned from feedback (0..1). */
    comfortFloor: 0.12,
    comfortCeiling: 0.92,
    /** Persistent offset from phase baseline after feedback. */
    feedbackBias: 0,
    /** Auto-climb rate multiplier (slows after too_strong). */
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
    /** Peak rel during session for aftercare scaling */
    peakRel: baseRel,
    phaseHistory: [phase],
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
      pausedStrengthA: event.strengthA ?? s.pausedStrengthA,
      pausedStrengthB: event.strengthB ?? s.pausedStrengthB,
    };
  }

  if (event.type === "RESUME") {
    if (s.phase !== "PAUSED" || !s.resumePhase) return s;
    const resume = s.resumePhase;
    const remaining = Math.max(
      0,
      (s.phaseDeadlineAt || now) - s.phaseStartedAt - s.frozenPhaseElapsed
    );
    return {
      ...s,
      phase: resume,
      resumePhase: null,
      phaseStartedAt: now - s.frozenPhaseElapsed,
      phaseDeadlineAt: now + remaining,
      frozenPhaseElapsed: 0,
    };
  }

  if (s.phase === "PAUSED") return s;

  if (event.type === "FEEDBACK" && event.feedback === "climaxed") {
    return enterAftercare(s, now, true);
  }
  if (event.type === "USER_CLIMAX") {
    return enterAftercare(s, now, true);
  }

  if (event.type === "TICK") {
    s = advanceTime(s, now);
    s.loopCounter = (s.loopCounter || 0) + 1;
    s.microPhase = (s.microPhase || 0) + 1;
    s = applyAdaptiveEnvelope(s, now);
    s = applyMicroMod(s, now);
    if (s.phaseDeadlineAt && now >= s.phaseDeadlineAt) {
      s = applyPhaseTimeout(s, now);
    } else {
      s = applyTickGuards(s, now);
    }
    s.peakRel = Math.max(s.peakRel || 0, s.relStrength || 0);
    return s;
  }

  if (event.type === "PHASE_TIMEOUT") {
    s = advanceTime(s, now);
    return applyPhaseTimeout(s, now);
  }

  if (event.type === "FEEDBACK" && event.feedback && VALID_FEEDBACK.has(event.feedback)) {
    if (s.lastFeedbackAt && now - s.lastFeedbackAt < FEEDBACK_RATE_MS) {
      // Allow climaxed / now / not_yet through rate limit (critical)
      if (!["climaxed", "now", "not_yet", "almost"].includes(event.feedback)) {
        return s;
      }
    }
    s = { ...s, lastFeedbackAt: now, lastFeedback: event.feedback };
    return applyFeedback(s, event.feedback, now);
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

  const effectiveRel = effectiveRelStrength(state, nowMs);
  const { strengthA, strengthB } = resolveChannelStrengths(
    effectiveRel,
    state.config,
    state.softA,
    state.softB
  );
  const pat = patternForPhase(state, nowMs);
  const remainingMs = Math.max(0, (state.targetDurationMs || 0) - (state.effectiveElapsedMs || 0));
  const phaseRemainingMs = Math.max(0, (state.phaseDeadlineAt || nowMs) - nowMs);

  return {
    strengthA,
    strengthB,
    patternId: pat.patternId,
    patternParams: { ampScale: pat.ampScale, freqBias: pat.freqBias || 0 },
    phase: state.phase,
    phaseLabel: PHASE_LABELS_DE[state.phase] || state.phase,
    progress: progressOf(state),
    phaseProgress: phaseProgressOf(state, nowMs),
    silenced: false,
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
  const factor = cfg.maxSessionIntensityFactor ?? 1;
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

  if (cfg.channelFocus === "A") {
    return {
      strengthA: fullA,
      strengthB: Math.min(capB, Math.round(fullA * frac)),
    };
  }
  if (cfg.channelFocus === "B") {
    return {
      strengthA: Math.min(capA, Math.round(fullB * frac)),
      strengthB: fullB,
    };
  }
  return { strengthA: fullA, strengthB: fullB };
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

function emptyOut(phase, silenced) {
  return {
    strengthA: 0,
    strengthB: 0,
    patternId: null,
    patternParams: { ampScale: 1, freqBias: 0 },
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
  };
}

function shareMs(targetDurationMs, phase, cfg) {
  let share = PHASE_SHARES[phase] ?? 0.1;
  // turbo / quick: shorter tease/warmup
  if (cfg?.templateId === "turbo" || cfg?.templateId === "quick_finish") {
    if (phase === "WARMUP") share *= 0.6;
    if (phase === "TEASE") share *= 0.5;
    if (phase === "CLIMAX_PUSH") share *= 1.3;
  }
  if (cfg?.templateId === "marathon" || cfg?.templateId === "long_tease") {
    if (phase === "TEASE" || phase === "BUILD") share *= 1.15;
  }
  return Math.max(2500, Math.round(targetDurationMs * share));
}

function holdWindowMs(state) {
  const edge = state.edgeCountDone || 0;
  // Later edges longer
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
  const aggro = state.config.aggression ?? 1;
  const base = Math.round(0.2 * state.targetDurationMs * aggro);
  return Math.min(120000, Math.max(50000, base));
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
    // Park near high but not max
    relStrength: clamp(Math.max(state.relStrength, 0.58), 0.55, 0.78),
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

/**
 * Phase baseline targets — feedbackBias/comfort band applied on top.
 * Does NOT hard-overwrite learned intensity.
 */
function phaseBaseline(phase, pp, state) {
  const aggro = state.config.aggression ?? 1;
  switch (phase) {
    case "CALIBRATING":
      return 0.06 + 0.14 * pp;
    case "WARMUP":
      return 0.12 + 0.18 * pp * aggro;
    case "BUILD":
      return 0.28 + 0.32 * smoothstep(pp) * aggro;
    case "TEASE": {
      // Deep valleys + high peaks (tease rhythm)
      const wave = 0.5 + 0.5 * Math.sin((state.loopCounter || 0) * 0.11);
      const drop = Math.sin((state.loopCounter || 0) * 0.03) > 0.7 ? 0.22 : 0;
      return clamp(0.38 + 0.28 * wave - drop, 0.2, 0.75) * (0.9 + 0.1 * aggro);
    }
    case "EDGE_HOLD": {
      // Plateau with gentle breathing
      const breath = 0.04 * Math.sin((state.loopCounter || 0) * 0.2);
      return clamp(0.62 + 0.1 * pp + breath, 0.55, 0.82);
    }
    case "SURGE": {
      // Rising waves
      const beat = ((state.loopCounter || 0) % 25) / 25;
      const crest = beat < 0.7 ? beat / 0.7 : 1 - (beat - 0.7) / 0.3;
      return 0.68 + 0.22 * crest * aggro;
    }
    case "CLIMAX_PUSH": {
      // Aggressive multi-wave crescendo
      const t = state.loopCounter || 0;
      const wave = Math.pow(0.55 + 0.45 * Math.sin(t * 0.15), 1.2);
      const escalate = 0.82 + 0.18 * pp;
      return clamp(escalate * (0.85 + 0.2 * wave) * aggro, 0.75, 1);
    }
    case "AFTERCARE":
      return Math.max(0.06, 0.35 * (1 - pp));
    default:
      return state.relStrength || 0.2;
  }
}

function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Blend toward baseline + bias; auto-climb when quiet; respect comfort band.
 */
function applyAdaptiveEnvelope(s, now) {
  const pp = phaseProgressOf(s, now);
  const baseline = phaseBaseline(s.phase, pp, s);
  const bias = s.feedbackBias || 0;
  let target = clamp(baseline + bias, s.comfortFloor || 0.08, s.comfortCeiling || 0.95);

  // Auto-climb when no negative feedback recently and autoClimb on
  const quietMs = now - (s.lastFeedbackAt || s.startedAt || now);
  const recentTooStrong = s.lastTooStrongAt && now - s.lastTooStrongAt < 12000;
  if (
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

  // During EDGE_HOLD after almost, hold high
  if (s.phase === "EDGE_HOLD" && s.lastAlmostAt && now - s.lastAlmostAt < 3000) {
    target = Math.max(target, 0.68);
  }

  // Smooth approach (don't yank intensity)
  const cur = s.relStrength || baseline;
  const alpha = s.phase === "CLIMAX_PUSH" ? 0.18 : s.phase === "TEASE" ? 0.22 : 0.12;
  const next = cur + (target - cur) * alpha;

  return {
    ...s,
    relStrength: clamp(next, 0, 1),
  };
}

/**
 * Extra micro drops during tease/push for sensation variety.
 */
function applyMicroMod(s, now) {
  if (s.phase === "TEASE") {
    const t = s.loopCounter || 0;
    // Occasional hard drop 0 for 4 ticks
    if (t % 80 > 72) {
      return { ...s, relStrength: Math.min(s.relStrength, 0.15) };
    }
  }
  if (s.phase === "CLIMAX_PUSH") {
    const t = s.loopCounter || 0;
    // Stutter: brief dips then slam back (helps push over edge)
    if (t % 18 === 0) {
      return { ...s, relStrength: Math.max(0.55, s.relStrength * 0.7) };
    }
  }
  if (s.phase === "EDGE_HOLD") {
    // Very slow climb within hold to keep edge exciting
    return {
      ...s,
      relStrength: clamp(s.relStrength + 0.0004 * (s.climbRate || 1), 0.55, 0.8),
    };
  }
  return s;
}

/** Instantaneous effective rel including micro pattern amp (for display/output). */
function effectiveRelStrength(state, nowMs) {
  let r = state.relStrength || 0;
  // Soft micro-oscillation for non-hold phases
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
    phaseHistory: [...(s.phaseHistory || []), phase].slice(-12),
  };
}

function applyPhaseTimeout(s, now) {
  const goal = s.config.goal;
  const needsEdges = NEEDS_EDGES.has(goal);

  switch (s.phase) {
    case "CALIBRATING":
      return setPhase(s, "WARMUP", now, shareMs(s.targetDurationMs, "WARMUP", s.config));
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
      return setPhase(s, "CLIMAX_PUSH", now, pushDurationMs(s));
    case "CLIMAX_PUSH":
      // Deny once if deny template and not yet denied
      if (
        s.config.goal === "deny_then_release" &&
        (s.denyCount || 0) < (s.maxDenies || 1) &&
        !s.userMarkedClimax
      ) {
        return {
          ...enterHold(
            {
              ...s,
              denyCount: (s.denyCount || 0) + 1,
              relStrength: clamp(s.relStrength - 0.35, 0.2, 0.5),
              feedbackBias: -0.1,
            },
            now
          ),
        };
      }
      return enterAftercare(s, now, false);
    case "AFTERCARE":
      return setPhase({ ...s, relStrength: 0 }, "COOLDOWN", now, 12000);
    case "COOLDOWN":
      return idleState(s, now);
    default:
      return s;
  }
}

function applyTickGuards(s, now) {
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
  // direct: enter surge earlier
  if (s.phase === "TEASE" && s.config.goal === "direct" && progressOf(s) >= 0.55) {
    return setPhase(s, "SURGE", now, shareMs(s.targetDurationMs, "SURGE", s.config));
  }
  // turbo: skip long tease
  if (s.phase === "BUILD" && s.config.templateId === "turbo" && progressOf(s) >= 0.35) {
    return setPhase(s, "SURGE", now, shareMs(s.targetDurationMs, "SURGE", s.config));
  }
  // Auto almost: if stuck high long enough in tease without edges done → enter hold
  if (
    s.phase === "TEASE" &&
    NEEDS_EDGES.has(s.config.goal) &&
    s.edgeCountDone < s.edgeCountTarget &&
    s.relStrength >= 0.7 &&
    phaseProgressOf(s, now) > 0.85
  ) {
    return enterHold(s, now);
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
    };
    if (s.phase === "CALIBRATING" || s.phase === "WARMUP") {
      next = setPhase(
        next,
        s.phase === "CALIBRATING" ? "WARMUP" : "BUILD",
        now,
        shareMs(s.targetDurationMs, s.phase === "CALIBRATING" ? "WARMUP" : "BUILD", s.config)
      );
    }
    // In climax push, too_weak = more aggression
    if (s.phase === "CLIMAX_PUSH") {
      next.relStrength = clamp(next.relStrength + 0.08, 0, 1);
    }
    return next;
  }

  if (feedback === "good") {
    let next = {
      ...s,
      relStrength: clamp(s.relStrength + 0.025, 0, 1),
      feedbackBias: clamp((s.feedbackBias || 0) + 0.015, -0.3, 0.3),
      consecutiveGood: (s.consecutiveGood || 0) + 1,
      climbRate: Math.min(1.3, (s.climbRate || 1) * 1.05),
    };
    if (s.phase === "CALIBRATING") {
      next = setPhase(next, "WARMUP", now, shareMs(s.targetDurationMs, "WARMUP", s.config));
    } else if (s.phase === "WARMUP" && phaseProgressOf(s, now) >= 0.4) {
      next = setPhase(next, "BUILD", now, shareMs(s.targetDurationMs, "BUILD", s.config));
    }
    // Several goods in build → accelerate to tease
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
    };
    if (s.phase === "BUILD" || s.phase === "CLIMAX_PUSH") {
      // Back off into safer tease
      next = setPhase(next, "TEASE", now, shareMs(s.targetDurationMs, "TEASE", s.config));
    }
    return next;
  }

  if (feedback === "almost") {
    if (s.phase === "EDGE_HOLD") {
      // User is right at edge during hold → complete edge sooner (reward)
      return completeEdge(
        {
          ...s,
          lastAlmostAt: now,
          consecutiveAlmost: (s.consecutiveAlmost || 0) + 1,
        },
        now
      );
    }
    if (s.phase === "BUILD" || s.phase === "TEASE" || s.phase === "WARMUP" || s.phase === "SURGE") {
      return enterHold(
        {
          ...s,
          lastAlmostAt: now,
          consecutiveAlmost: (s.consecutiveAlmost || 0) + 1,
          // Don't spike further when almost
          feedbackBias: Math.min(s.feedbackBias || 0, 0.05),
          climbRate: Math.max(0.5, (s.climbRate || 1) * 0.8),
        },
        now
      );
    }
    if (s.phase === "CLIMAX_PUSH") {
      // almost during push = perfect, ramp higher
      return {
        ...s,
        relStrength: clamp(s.relStrength + 0.06, 0.8, 1),
        lastAlmostAt: now,
        climbRate: Math.min(1.5, (s.climbRate || 1) * 1.1),
      };
    }
    return s;
  }

  if (feedback === "now") {
    if (
      s.phase === "EDGE_HOLD" ||
      s.phase === "TEASE" ||
      s.phase === "SURGE" ||
      s.phase === "BUILD" ||
      s.phase === "WARMUP"
    ) {
      return setPhase(
        {
          ...s,
          relStrength: clamp(Math.max(s.relStrength, 0.8), 0.8, 1),
          feedbackBias: 0.1,
          climbRate: 1.3,
        },
        "CLIMAX_PUSH",
        now,
        pushDurationMs(s)
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
        next.denyCount = (s.denyCount || 0) + (s.config.goal === "deny_then_release" ? 1 : 0);
        return next;
      }
      return setPhase(
        {
          ...s,
          relStrength: clamp(s.relStrength - 0.18, 0.2, 0.55),
          feedbackBias: -0.08,
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
  const t = state.loopCounter || 0;
  const pp = phaseProgressOf(state, nowMs);
  /** @type {string} */
  let patternId = "gentle";
  let ampScale = 1;
  let freqBias = 0;

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
      if (pp < 0.33) patternId = "escalate";
      else if (pp < 0.66) patternId = "rhythm";
      else patternId = "drift";
      ampScale = 0.85 + 0.15 * pp;
      break;
    case "TEASE": {
      const seg = Math.floor(t / 40) % 4;
      patternId = ["tease", "alternate", "sawtooth", "flutter"][seg];
      ampScale = 0.75 + 0.2 * Math.abs(Math.sin(t * 0.05));
      break;
    }
    case "EDGE_HOLD":
      // Steady flutter / heartbeat for edge
      patternId = t % 50 < 30 ? "flutter" : "heartbeat";
      ampScale = allowClimax ? 0.72 + 0.08 * pp : 0.55 + 0.1 * pp;
      freqBias = 5;
      break;
    case "SURGE": {
      const seg = Math.floor(t / 20) % 3;
      patternId = allowClimax
        ? ["climax", "strobe", "duet"][seg]
        : ["strobe", "escalate", "rhythm"][seg];
      ampScale = allowClimax ? 0.95 : 0.72;
      break;
    }
    case "CLIMAX_PUSH": {
      // Heavy rotation of climax patterns
      const seg = Math.floor(t / 12) % 4;
      if (allowClimax) {
        patternId = ["climax", "strobe", "flutter", "climax"][seg];
        ampScale = 0.95 + 0.05 * pp;
      } else {
        patternId = ["escalate", "strobe", "rhythm", "duet"][seg];
        ampScale = 0.88;
      }
      freqBias = 10 * pp;
      break;
    }
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
  switch (state.phase) {
    case "CALIBRATING":
      return "Spürst du etwas? Feedback: Zu schwach / Gut / Zu stark";
    case "WARMUP":
      return "Körper ankommen lassen — Intensität steigt sanft";
    case "BUILD":
      return "Aufbau — „Fast“ wenn du nah bist";
    case "TEASE":
      return "Tease mit Wellen — „Jetzt“ springt zum Push";
    case "EDGE_HOLD":
      return "Am Limit halten — nicht abspritzen. „Fast“ bestätigt Edge";
    case "SURGE":
      return "Starke Wellen — gleich kommt der Push";
    case "CLIMAX_PUSH":
      return "Jetzt drüber — „Fertig ✓“ wenn du kommst, „Noch nicht“ zum Zurück";
    case "AFTERCARE":
      return state.userMarkedClimax
        ? "Höhepunkt markiert — weiches Ausklingen"
        : "Session endet — weiches Ausklingen";
    case "PAUSED":
      return "Pausiert — Weiter zum Fortsetzen";
    default:
      return "";
  }
}
