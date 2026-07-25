// autodrive-engine.js — Pure Autodrive state machine (no DOM / BLE).
// Transition table is authoritative (see docs/DESIGN-restructure-autodrive.md).

/** @typedef {"IDLE"|"CALIBRATING"|"WARMUP"|"BUILD"|"TEASE"|"EDGE_HOLD"|"SURGE"|"CLIMAX_PUSH"|"AFTERCARE"|"COOLDOWN"|"PAUSED"} AutodrivePhase */
/** @typedef {"direct"|"edge_then_release"|"edge_ladder"|"deny_then_release"} AutodriveGoal */
/** @typedef {"too_weak"|"good"|"too_strong"|"almost"|"now"|"climaxed"|"not_yet"} AutodriveFeedback */
/** @typedef {"gentle"|"medium"|"intense"} AutodriveSensitivity */
/** @typedef {"A"|"B"|"both"} ChannelFocus */

export const AUTODRIVE_TEMPLATES = Object.freeze({
  quick_finish: {
    id: "quick_finish",
    label: "Schnell",
    targetDurationMin: 5,
    goal: "direct",
    sensitivity: "medium",
    edgeCount: 0,
    maxSessionIntensityFactor: 0.95,
    allowClimaxPatterns: true,
  },
  classic: {
    id: "classic",
    label: "Klassisch",
    targetDurationMin: 12,
    goal: "edge_then_release",
    sensitivity: "medium",
    edgeCount: 2,
    maxSessionIntensityFactor: 0.95,
    allowClimaxPatterns: true,
  },
  long_tease: {
    id: "long_tease",
    label: "Langer Tease",
    targetDurationMin: 20,
    goal: "edge_ladder",
    sensitivity: "gentle",
    edgeCount: 4,
    maxSessionIntensityFactor: 0.9,
    allowClimaxPatterns: false,
  },
  intense: {
    id: "intense",
    label: "Intensiv",
    targetDurationMin: 10,
    goal: "direct",
    sensitivity: "intense",
    edgeCount: 1,
    maxSessionIntensityFactor: 0.85,
    allowClimaxPatterns: true,
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
});

const SENSITIVITY_SCALE = Object.freeze({
  gentle: 0.75,
  medium: 1.0,
  intense: 1.15,
});

const DROP_DEPTH = Object.freeze({
  gentle: 0.2,
  medium: 0.15,
  intense: 0.1,
});

const FEEDBACK_RATE_MS = 2000;
const PHASE_SHARES = Object.freeze({
  WARMUP: 0.12,
  BUILD: 0.3,
  TEASE: 0.22,
  EDGE_HOLD: 0.12,
  SURGE: 0.08,
  CLIMAX_PUSH: 0.16,
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

/**
 * @param {unknown} input
 * @returns {typeof AUTODRIVE_CONFIG_DEFAULTS & Record<string, unknown>}
 */
export function sanitiseAutodriveConfig(input) {
  const base = { ...AUTODRIVE_CONFIG_DEFAULTS };
  if (!input || typeof input !== "object") return base;
  const raw = /** @type {Record<string, unknown>} */ (input);

  let template = null;
  if (typeof raw.templateId === "string" && AUTODRIVE_TEMPLATES[raw.templateId]) {
    template = AUTODRIVE_TEMPLATES[raw.templateId];
    base.templateId = template.id;
    base.goal = template.goal;
    base.sensitivity = template.sensitivity;
    base.edgeCount = template.edgeCount;
    base.targetDurationMin = template.targetDurationMin;
    base.maxSessionIntensityFactor = template.maxSessionIntensityFactor;
    base.allowClimaxPatterns = template.allowClimaxPatterns;
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

  if (base.autoStopMinutes == null) {
    base.autoStopMinutes = Math.max(base.targetDurationMin + 5, 30);
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
  const phaseMs = skip ? shareMs(targetDurationMs, "WARMUP") : 20000;
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
    relStrength: skip ? 0.18 : 0.1,
    edgeCountDone: 0,
    edgeCountTarget: cfg.edgeCount || 0,
    holdCompletedThisVisit: false,
    userMarkedClimax: false,
    lastFeedbackAt: 0,
    maxDurationAt: nowMs + Math.round((cfg.autoStopMinutes || 30) * 60 * 1000),
    pausedStrengthA: 0,
    pausedStrengthB: 0,
    frozenPhaseElapsed: 0,
    softA: 150,
    softB: 150,
    loopCounter: 0,
    targetDurationMs,
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

  if (event.type === "MAX_DURATION" || (s.maxDurationAt && now >= s.maxDurationAt)) {
    if (event.type === "MAX_DURATION" || event.type === "TICK") {
      if (now >= s.maxDurationAt && s.phase !== "AFTERCARE" && s.phase !== "COOLDOWN") {
        return enterAftercare(s, now, false);
      }
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

  if (s.phase === "PAUSED") {
    return s; // clocks frozen; ignore TICK / feedback
  }

  // Global climaxed from any active phase
  if (event.type === "FEEDBACK" && event.feedback === "climaxed") {
    return enterAftercare(s, now, true);
  }
  if (event.type === "USER_CLIMAX") {
    return enterAftercare(s, now, true);
  }

  if (event.type === "TICK") {
    s = advanceTime(s, now);
    s.loopCounter = (s.loopCounter || 0) + 1;
    // Envelope crawl
    s = applyEnvelope(s, now);
    // PHASE_TIMEOUT via deadline
    if (s.phaseDeadlineAt && now >= s.phaseDeadlineAt) {
      s = applyPhaseTimeout(s, now);
    } else {
      s = applyTickGuards(s, now);
    }
    return s;
  }

  if (event.type === "PHASE_TIMEOUT") {
    s = advanceTime(s, now);
    return applyPhaseTimeout(s, now);
  }

  if (event.type === "FEEDBACK" && event.feedback && VALID_FEEDBACK.has(event.feedback)) {
    if (s.lastFeedbackAt && now - s.lastFeedbackAt < FEEDBACK_RATE_MS) {
      return s; // rate limit
    }
    s = { ...s, lastFeedbackAt: now };
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
    return {
      strengthA: 0,
      strengthB: 0,
      patternId: null,
      patternParams: { ampScale: 1, freqBias: 0 },
      phase: "IDLE",
      progress: 0,
      phaseProgress: 0,
      silenced: true,
    };
  }
  if (state.phase === "PAUSED") {
    return {
      strengthA: state.pausedStrengthA || 0,
      strengthB: state.pausedStrengthB || 0,
      patternId: null,
      patternParams: { ampScale: 1, freqBias: 0 },
      phase: "PAUSED",
      progress: progressOf(state),
      phaseProgress: 0,
      silenced: true,
    };
  }
  if (state.phase === "COOLDOWN") {
    return {
      strengthA: 0,
      strengthB: 0,
      patternId: null,
      patternParams: { ampScale: 1, freqBias: 0 },
      phase: "COOLDOWN",
      progress: 1,
      phaseProgress: phaseProgressOf(state, nowMs),
      silenced: true,
    };
  }

  const { strengthA, strengthB } = resolveChannelStrengths(
    state.relStrength,
    state.config,
    state.softA,
    state.softB
  );
  const { patternId, ampScale } = patternForPhase(state);
  const progress = progressOf(state);
  const phaseProgress = phaseProgressOf(state, nowMs);

  return {
    strengthA,
    strengthB,
    patternId,
    patternParams: { ampScale, freqBias: 0 },
    phase: state.phase,
    progress,
    phaseProgress,
    silenced: false,
    edgeCountDone: state.edgeCountDone,
    edgeCountTarget: state.edgeCountTarget,
    userMarkedClimax: state.userMarkedClimax,
    relStrength: state.relStrength,
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function shareMs(targetDurationMs, phase) {
  const share = PHASE_SHARES[phase] ?? 0.1;
  return Math.max(3000, Math.round(targetDurationMs * share));
}

function holdWindowMs(state) {
  const base = 8000 + (state.config.edgeCount || 0) * 500;
  return Math.min(25000, Math.max(5000, base));
}

function settleMs(state) {
  return 3000 + (state.config.sensitivity === "gentle" ? 4000 : 2000);
}

function teaseSliceMs(state) {
  return shareMs(state.targetDurationMs, "TEASE") * 0.5;
}

function pushDurationMs(state) {
  return Math.min(90000, Math.max(45000, Math.round(0.15 * state.targetDurationMs)));
}

function dropDepth(state) {
  return DROP_DEPTH[state.config.sensitivity] ?? 0.15;
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
    phaseDeadlineAt: now + 60000,
    relStrength: Math.min(s.relStrength, 0.4),
    settleUntil: null,
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
  return {
    ...state,
    edgeCountDone: state.edgeCountDone + 1,
    holdCompletedThisVisit: true,
    phase: "TEASE",
    relStrength: Math.min(state.relStrength, 0.35),
    settleUntil: nowMs + settleMs(state),
    phaseStartedAt: nowMs,
    phaseDeadlineAt: nowMs + teaseSliceMs(state),
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

function applyEnvelope(s, now) {
  const phase = s.phase;
  let rel = s.relStrength;
  const pp = phaseProgressOf(s, now);

  if (phase === "CALIBRATING") rel = 0.08 + 0.12 * pp;
  else if (phase === "WARMUP") rel = 0.15 + 0.15 * pp;
  else if (phase === "BUILD") rel = 0.3 + 0.25 * pp;
  else if (phase === "TEASE") {
    // oscillate slightly
    const osc = 0.5 + 0.5 * Math.sin((s.loopCounter || 0) * 0.08);
    rel = 0.4 + 0.25 * osc;
  } else if (phase === "EDGE_HOLD") rel = 0.6 + 0.15 * pp;
  else if (phase === "SURGE") rel = 0.7 + 0.2 * pp;
  else if (phase === "CLIMAX_PUSH") rel = 0.85 + 0.15 * pp;
  else if (phase === "AFTERCARE") rel = Math.max(0.1, 0.5 * (1 - pp));

  return { ...s, relStrength: clamp(rel, 0, 1) };
}

function setPhase(s, phase, now, durationMs) {
  return {
    ...s,
    phase,
    phaseStartedAt: now,
    phaseDeadlineAt: now + durationMs,
  };
}

function applyPhaseTimeout(s, now) {
  const goal = s.config.goal;
  const needsEdges = NEEDS_EDGES.has(goal);

  switch (s.phase) {
    case "CALIBRATING":
      return setPhase(s, "WARMUP", now, shareMs(s.targetDurationMs, "WARMUP"));
    case "WARMUP":
      return setPhase(s, "BUILD", now, shareMs(s.targetDurationMs, "BUILD"));
    case "BUILD":
      return setPhase(s, "TEASE", now, shareMs(s.targetDurationMs, "TEASE"));
    case "TEASE":
      if (needsEdges && s.edgeCountDone < s.edgeCountTarget) {
        return enterHold(s, now);
      }
      return setPhase(s, "SURGE", now, shareMs(s.targetDurationMs, "SURGE"));
    case "EDGE_HOLD":
      return completeEdge(s, now);
    case "SURGE":
      return setPhase(s, "CLIMAX_PUSH", now, pushDurationMs(s));
    case "CLIMAX_PUSH":
      return enterAftercare(s, now, false);
    case "AFTERCARE":
      return setPhase({ ...s, relStrength: 0 }, "COOLDOWN", now, 15000);
    case "COOLDOWN":
      return idleState(s, now);
    default:
      return s;
  }
}

function applyTickGuards(s, now) {
  // TEASE | TICK | edges done + settle → SURGE
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
      shareMs(s.targetDurationMs, "SURGE")
    );
  }
  // direct goal: TEASE timeout path already handles; also allow early surge near end
  if (s.phase === "TEASE" && s.config.goal === "direct" && progressOf(s) >= 0.75) {
    return setPhase(s, "SURGE", now, shareMs(s.targetDurationMs, "SURGE"));
  }
  return s;
}

function applyFeedback(s, feedback, now) {
  const goal = s.config.goal;
  const needsEdges = NEEDS_EDGES.has(goal);
  const drop = dropDepth(s);

  if (feedback === "too_weak") {
    let next = { ...s, relStrength: clamp(s.relStrength + 0.08, 0, 1) };
    if (s.phase === "CALIBRATING" || s.phase === "WARMUP") {
      next = setPhase(
        next,
        s.phase === "CALIBRATING" ? "WARMUP" : "BUILD",
        now,
        shareMs(s.targetDurationMs, s.phase === "CALIBRATING" ? "WARMUP" : "BUILD")
      );
    }
    return next;
  }

  if (feedback === "good") {
    let next = { ...s, relStrength: clamp(s.relStrength + 0.02, 0, 1) };
    if (s.phase === "CALIBRATING") {
      next = setPhase(next, "WARMUP", now, shareMs(s.targetDurationMs, "WARMUP"));
    } else if (s.phase === "WARMUP" && phaseProgressOf(s, now) >= 0.5) {
      next = setPhase(next, "BUILD", now, shareMs(s.targetDurationMs, "BUILD"));
    }
    return next;
  }

  if (feedback === "too_strong") {
    let next = {
      ...s,
      relStrength: clamp(s.relStrength - drop, 0, 1),
      settleUntil: now + 5000 + Math.round(Math.random() * 10000),
    };
    if (s.phase === "BUILD") {
      next = setPhase(next, "TEASE", now, shareMs(s.targetDurationMs, "TEASE"));
    }
    return next;
  }

  if (feedback === "almost") {
    if (s.phase === "EDGE_HOLD") {
      return completeEdge(s, now);
    }
    if (s.phase === "BUILD" || s.phase === "TEASE" || s.phase === "WARMUP") {
      if (needsEdges || s.phase === "TEASE") return enterHold(s, now);
    }
    return s;
  }

  if (feedback === "now") {
    if (
      s.phase === "EDGE_HOLD" ||
      s.phase === "TEASE" ||
      s.phase === "SURGE" ||
      s.phase === "BUILD"
    ) {
      return setPhase(s, "CLIMAX_PUSH", now, pushDurationMs(s));
    }
    return s;
  }

  if (feedback === "not_yet") {
    if (s.phase === "CLIMAX_PUSH") {
      if (needsEdges) {
        const next = enterHold(s, now);
        next.relStrength = clamp(s.relStrength - 0.15, 0, 1);
        return next;
      }
      return setPhase(
        { ...s, relStrength: clamp(s.relStrength - 0.15, 0, 1) },
        "TEASE",
        now,
        shareMs(s.targetDurationMs, "TEASE")
      );
    }
    return s;
  }

  return s;
}

function patternForPhase(state) {
  const allowClimax = !!state.config.allowClimaxPatterns;
  const phase = state.phase;
  /** @type {string} */
  let patternId = "gentle";
  let ampScale = 1;

  switch (phase) {
    case "CALIBRATING":
      patternId = "gentle";
      ampScale = 0.6;
      break;
    case "WARMUP":
      patternId = state.loopCounter % 40 < 20 ? "gentle" : "heartbeat";
      break;
    case "BUILD":
      patternId = state.loopCounter % 60 < 30 ? "escalate" : "rhythm";
      break;
    case "TEASE":
      patternId = state.loopCounter % 50 < 25 ? "tease" : "alternate";
      break;
    case "EDGE_HOLD":
      patternId = "flutter";
      ampScale = allowClimax ? 0.75 : 0.55;
      break;
    case "SURGE":
      patternId = allowClimax ? "climax" : "strobe";
      ampScale = allowClimax ? 1 : 0.7;
      break;
    case "CLIMAX_PUSH":
      patternId = allowClimax ? "climax" : "escalate";
      ampScale = allowClimax ? 1 : 0.85;
      break;
    case "AFTERCARE":
      patternId = "gentle";
      ampScale = 0.5;
      break;
    default:
      patternId = "gentle";
  }
  return { patternId, ampScale };
}
