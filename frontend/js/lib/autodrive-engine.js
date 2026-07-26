// autodrive-engine.js — Adaptive Autodrive with sensation plane (freq/duty/channel),
// edge-score, calibration baseline, multi-wave climax, placement profiles.

/** @typedef {"IDLE"|"CALIBRATING"|"WARMUP"|"BUILD"|"TEASE"|"EDGE_HOLD"|"SURGE"|"CLIMAX_PUSH"|"AFTERCARE"|"COOLDOWN"|"PAUSED"} AutodrivePhase */
/** @typedef {"direct"|"edge_then_release"|"edge_ladder"|"deny_then_release"} AutodriveGoal */
/** @typedef {"too_weak"|"good"|"too_strong"|"almost"|"now"|"climaxed"|"not_yet"} AutodriveFeedback */
/** @typedef {"gentle"|"medium"|"intense"} AutodriveSensitivity */
/** @typedef {"A"|"B"|"both"} ChannelFocus */
/**
 * Body / electrode application profile for Autodrive tuning.
 * Strength/freq/duty are soft-relative; labels guide real-world ESTIM setups.
 * @typedef {"soft_external"|"deep_pressure"|"dual"|"perineum_combo"|"insertable"} PlacementProfile
 */
/** @typedef {"both"|"alt"|"aLead"|"bLead"} ChannelMode */

/**
 * Placement profiles map common ESTIM body applications → sensation plane + caps.
 * Research-aligned (below-waist only; pads softer; loops/glans hotter; insertables careful).
 */
export const PLACEMENT_PROFILES = Object.freeze({
  soft_external: {
    id: "soft_external",
    label: "Pads extern",
    freqBias: -15,
    dutyScale: 1.08,
    strengthCap: 0.92,
    description: "Flächige Pads — weich, Einsteiger-freundlich",
    bodySites: "Haftpads auf intakter Haut unterhalb der Taille",
    setupMale:
      "z. B. Pad Perineum + Pad Schaftbasis, oder zwei Pads seitlich am Schaft (nicht über dem Herzen)",
    setupFemale:
      "z. B. Pads beidseits der Labien / innere Oberschenkel nahe dem Schritt — nicht direkt auf die Klitoris-Glans",
    sensation: "Weich, flächig, eher „throb“ bei niedriger Wire-Freq",
    recommendedAbRole: "sync",
    recommendedFocus: "both",
    tips: [
      "Große Pad-Fläche = weicher; kleine Pads = punktuell schärfer",
      "Guter Kontakt / leitfähiges Gel bei schlechter Haftung",
      "Soft-Limits erst nach Kalibrierung anheben",
    ],
  },
  deep_pressure: {
    id: "deep_pressure",
    label: "Loops Schaft",
    freqBias: 12,
    dutyScale: 0.9,
    strengthCap: 0.82,
    description: "Leitfähige Ringe Basis↔Glans — fokussiert, intensiver",
    bodySites: "Conductive Loops / Cockrings",
    setupMale: "Loop an der Basis + Loop unterhalb der Eichel (Strom entlang des Schafts)",
    setupFemale:
      "Weniger typisch — eher Pads/Insertables; optional Ringe an Oberschenkel-Falten nur mit Vorsicht",
    sensation: "Fokussiert, oft „schneidender“ bei höherer Wire-Freq — Cap bewusst niedriger",
    recommendedAbRole: "sync",
    recommendedFocus: "both",
    tips: [
      "Eichel-nah = empfindlich: Kalibrierung und „Zu stark“ nutzen",
      "Loops nicht zu eng; Haut nicht abschnüren",
      "Template „Sanft/Klassisch“ vor „Turbo/Intensiv“",
    ],
  },
  dual: {
    id: "dual",
    label: "Dual A/B Stereo",
    freqBias: 0,
    dutyScale: 1,
    strengthCap: 0.93,
    description: "Zwei unabhängige Kreise auf A und B — Alternate-Wellen",
    bodySites:
      "Kanal A und B an unterschiedlichen Stellen (kein gemeinsamer Elektroden-Pfad über die Brust)",
    setupMale:
      "z. B. A: Perineum↔Basis · B: Basis↔Glans — oder A Schaft, B bipolarer Plug (getrennte Kreise)",
    setupFemale: "z. B. A: Labien-Seiten · B: bipolarer Vaginal-Probe — Kreise nicht kreuzen",
    sensation: "Räumlich / abwechselnd; gut mit A/B-Rollen „Rhythmus + Steady“",
    recommendedAbRole: "aRhythm_bSteady",
    recommendedFocus: "both",
    tips: [
      "Jeden Kanal als eigenen Stromkreis behandeln",
      "A/B-Rollen: Rhythmus auf dem „spielerischen“ Kanal",
      "Fokus A/B im UI, wenn ein Kanal deutlich empfindlicher ist",
    ],
  },
  perineum_combo: {
    id: "perineum_combo",
    label: "Perineum + Basis",
    freqBias: 4,
    dutyScale: 0.95,
    strengthCap: 0.88,
    description: "Pad Perineum + Loop/Pad Basis — tiefer, beckenboden-nah",
    bodySites: "Perineum (zwischen Anus und Genitalien) + Schaftbasis / Pubis",
    setupMale:
      "Pad mittig auf dem Perineum + Loop/Pad an der Penisbasis — Strom durch den Beckenboden",
    setupFemale: "Pad Perineum + zweites Pad unterer Schamhügel / innere Oberschenkel-Nähe",
    sensation: "Tiefer, „innerer“ Druck; oft prostate-/beckenboden-nah ohne Insertable",
    recommendedAbRole: "sync",
    recommendedFocus: "both",
    tips: [
      "Haare kürzen / Gel für gleichmäßigen Kontakt am Perineum",
      "Nicht zu nah am Anus bei frischen Wunden/Hämorrhoiden",
      "Mittlere Templates (Klassisch, Deny) passen gut",
    ],
  },
  insertable: {
    id: "insertable",
    label: "Insertable bipolar",
    freqBias: -8,
    dutyScale: 0.88,
    strengthCap: 0.78,
    description: "Bipolarer Plug/Probe — lokal, konservatives Cap",
    bodySites: "Körpergerechte ESTIM-Insertables (anal/vaginal), bipolar = Strom im Toy",
    setupMale: "Bipolarer Anal-Plug (± im Toy); optional zweiter Kanal separat mit Loop am Schaft",
    setupFemale: "Bipolarer Vaginal-Probe oder Anal-Plug — nur ESTIM-geeignetes Material",
    sensation: "Sehr lokal; kann schnell intensiv wirken → niedriges Cap + sanfte Freq",
    recommendedAbRole: "sync",
    recommendedFocus: "A",
    tips: [
      "Nur toys die für Elektro-Play gebaut sind; reichlich leitfähiges Gleitgel",
      "Nie mit Strom ein-/ausstecken — Strength 0 / Soft-Stop zuerst",
      "Kalibrierung nicht überspringen; „Zu stark“ früh tippen",
    ],
  },
});

/** Absolute safety rules shown in Autodrive UI (not medical advice). */
export const ESTIM_SAFETY_RULES = Object.freeze([
  "Stromwege nur unterhalb der Taille — nie über Brust/Herz, nie Kopf/Hals",
  "Nicht während Schwangerschaft; kein ESTIM bei Herzschrittmacher/ICD ohne ärztliche Freigabe",
  "Nur intakte Haut; keine frischen Wunden, Entzündungen oder Taubheitsgefühl",
  "Immer geschlossener Kreis (zwei Kontakte pro Kanal); Körper-sichere ESTIM-Elektroden",
  "Immer niedrig starten; Soft-Limits setzen; Panic/STOP erreichbar halten",
  "Bei Schwindel, Herzrasen, starken Schmerzen: sofort Soft-Stop / Gerät aus",
]);

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
  placement: "soft_external",
  /** @type {"sync"|"aRhythm_bSteady"|"aSteady_bRhythm"} */
  abRole: "sync",
  fullscreenPreferred: true,
  /** When true and STIM audio plays, wave/freq from audio, strength from Autodrive */
  hybridAudio: false,
  /** Story id if started from story template */
  storyId: null,
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
  TEASE: { lo: 35, hi: 90 },
  EDGE_HOLD: { lo: 45, hi: 65 },
  SURGE: { lo: 55, hi: 100 },
  CLIMAX_PUSH: { lo: 60, hi: 120 },
  AFTERCARE: { lo: 20, hi: 40 },
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

const NEEDS_EDGES = new Set(["edge_then_release", "edge_ladder", "deny_then_release"]);
const VALID_GOALS = new Set(["direct", "edge_then_release", "edge_ladder", "deny_then_release"]);
const VALID_SENS = new Set(["gentle", "medium", "intense"]);
const VALID_FOCUS = new Set(["A", "B", "both"]);
const VALID_PLACEMENT = new Set([
  "soft_external",
  "deep_pressure",
  "dual",
  "perineum_combo",
  "insertable",
]);

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
 * Multi-wave climax protocol segments (ms relative to phase start).
 * Each: { crestMs, dropMs, peakBoost }
 */
export const CLIMAX_WAVES = Object.freeze([
  { crestMs: 4000, dropMs: 1500, peakBoost: 0.0 },
  { crestMs: 5000, dropMs: 1000, peakBoost: 0.04 },
  { crestMs: 6000, dropMs: 800, peakBoost: 0.08 },
  { crestMs: 12000, dropMs: 0, peakBoost: 0.12 }, // final hold
]);

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
    channelMode: /** @type {ChannelMode} */ (cfg.placement === "dual" ? "alt" : "both"),
    burstMs: 0,
    softResetUntil: 0,
    nextHabituationAt: nowMs + randRange(HABITUATION_MS_MIN, HABITUATION_MS_MAX),
    lastPatternId: "gentle",
    preferredPatternFamily: learning.preferredPatternFamily || null,
    // Climax multi-wave
    climaxWaveIndex: 0,
    climaxWaveStartedAt: 0,
    climaxInDrop: false,
    placeFreqBias: place.freqBias || 0,
    placeDutyScale: place.dutyScale || 1,
    // Peak-lock: hold a "good" intensity zone
    peakLockRel: null,
    peakLockUntil: 0,
    peakLockHits: 0,
    // After almost in push: extra boosted crests
    pushBoostRemaining: 0,
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
    return {
      ...s,
      phase: s.resumePhase,
      resumePhase: null,
      phaseStartedAt: now - s.frozenPhaseElapsed,
      phaseDeadlineAt: now + remaining,
      frozenPhaseElapsed: 0,
    };
  }

  if (s.phase === "PAUSED") return s;

  if (event.type === "FEEDBACK" && event.feedback === "climaxed") {
    return enterAftercare({ ...s, almostWithoutClimax: 0, qualityBoost: 0 }, now, true);
  }
  if (event.type === "USER_CLIMAX") {
    return enterAftercare(s, now, true);
  }

  if (event.type === "TICK") {
    s = advanceTime(s, now);
    s.loopCounter = (s.loopCounter || 0) + 1;
    s.microPhase = (s.microPhase || 0) + 1;
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
    // Smooth freq toward target
    s.wireFreq = lerp(s.wireFreq || s.wireFreqTarget, s.wireFreqTarget, 0.12);
    return s;
  }

  if (event.type === "PHASE_TIMEOUT") {
    s = advanceTime(s, now);
    return applyPhaseTimeout(s, now);
  }

  if (event.type === "FEEDBACK" && event.feedback && VALID_FEEDBACK.has(event.feedback)) {
    if (s.lastFeedbackAt && now - s.lastFeedbackAt < FEEDBACK_RATE_MS) {
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
  // Sum of multi-wave protocol + buffer
  const waves = CLIMAX_WAVES.reduce((acc, w) => acc + w.crestMs + w.dropMs, 0);
  const aggro = state.config.aggression ?? 1;
  return Math.min(
    130000,
    Math.max(waves + 8000, Math.round(0.22 * state.targetDurationMs * aggro))
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
    channelMode: state.config.placement === "dual" ? "alt" : state.channelMode || "both",
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

function phaseBaseline(phase, pp, state) {
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

function applyAdaptiveEnvelope(s, now) {
  const pp = phaseProgressOf(s, now);
  const baseline = phaseBaseline(s.phase, pp, s);
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

  // Calibration: forced slow ramp for threshold discovery
  if (s.phase === "CALIBRATING") {
    target = 0.07 + 0.18 * pp;
  }

  const cur = s.relStrength || baseline;
  const alpha = s.phase === "CLIMAX_PUSH" ? 0.2 : s.phase === "TEASE" ? 0.22 : 0.12;
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

  // Tease: oscillate freq
  if (s.phase === "TEASE") {
    freqTarget =
      band.lo + (band.hi - band.lo) * (0.5 + 0.5 * Math.sin((s.loopCounter || 0) * 0.09));
    freqTarget += placeBias;
  }
  // Push: climb toward high
  if (s.phase === "CLIMAX_PUSH") {
    freqTarget = band.lo + (band.hi - band.lo) * Math.min(1, pp * 1.2) + placeBias;
  }

  let duty = PHASE_DUTY[s.phase] ?? 0.7;
  if (s.phase === "TEASE") {
    duty = 0.45 + 0.25 * Math.abs(Math.sin((s.loopCounter || 0) * 0.07));
  }
  if (s.phase === "EDGE_HOLD") duty = 0.85 + 0.08 * Math.sin((s.loopCounter || 0) * 0.15);

  let channelMode = s.channelMode || "both";
  if (s.config.placement === "dual") {
    channelMode = s.phase === "EDGE_HOLD" || s.phase === "TEASE" ? "alt" : "both";
  } else if (s.phase === "TEASE") {
    channelMode = (s.loopCounter || 0) % 60 < 30 ? "alt" : "both";
  } else if (s.phase === "CLIMAX_PUSH") {
    channelMode = "both";
  }

  return {
    ...s,
    wireFreqTarget: clamp(freqTarget, 10, 240),
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

  let idx = s.climaxWaveIndex || 0;
  let started = s.climaxWaveStartedAt || s.phaseStartedAt || now;
  let inDrop = !!s.climaxInDrop;
  const wave = CLIMAX_WAVES[Math.min(idx, CLIMAX_WAVES.length - 1)];
  const elapsed = now - started;

  let rel = s.relStrength;
  if (!inDrop) {
    // Crest: climb
    const crestP = clamp(elapsed / wave.crestMs, 0, 1);
    const peak = clamp(0.82 + wave.peakBoost + (s.feedbackBias || 0), 0.75, 1);
    rel = lerp(Math.max(0.7, s.relStrength), peak, 0.15 + 0.1 * crestP);
    if (elapsed >= wave.crestMs) {
      if (wave.dropMs > 0 && idx < CLIMAX_WAVES.length - 1) {
        inDrop = true;
        started = now;
      } else if (idx < CLIMAX_WAVES.length - 1) {
        idx += 1;
        started = now;
      }
    }
  } else {
    // Drop: brief relief then next wave
    rel = lerp(s.relStrength, 0.55, 0.25);
    if (elapsed >= wave.dropMs) {
      inDrop = false;
      idx = Math.min(idx + 1, CLIMAX_WAVES.length - 1);
      started = now;
      rel = Math.max(rel, 0.72);
      // Consume one push-boost after a drop cycle
      if ((s.pushBoostRemaining || 0) > 0) {
        return {
          ...s,
          climaxWaveIndex: idx,
          climaxWaveStartedAt: started,
          climaxInDrop: false,
          relStrength: clamp(Math.max(rel, 0.88), 0, 1),
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
  if (s.phase === "CLIMAX_PUSH" && !s.climaxInDrop) {
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
      return setPhase(s, "CLIMAX_PUSH", now, pushDurationMs(s));
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
    return setPhase(s, "CLIMAX_PUSH", now, pushDurationMs(s));
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
    if (s.phase === "BUILD" || s.phase === "CLIMAX_PUSH") {
      next = setPhase(next, "TEASE", now, shareMs(s.targetDurationMs, "TEASE", s.config));
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
      return setPhase(
        {
          ...s,
          relStrength: clamp(Math.max(s.relStrength, 0.8), 0.8, 1),
          feedbackBias: 0.1,
          climbRate: 1.3,
          edgeScore: 90,
          climaxWaveIndex: 0,
          climaxWaveStartedAt: now,
          climaxInDrop: false,
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
      const boost = (state.pushBoostRemaining || 0) > 0 ? " · Boost aktiv" : "";
      return `Push-Welle ${w}/${CLIMAX_WAVES.length}${boost} — „Fertig ✓“ wenn du kommst`;
    }
    case "AFTERCARE":
      return state.userMarkedClimax
        ? "Höhepunkt markiert — weiches Ausklingen"
        : "Session endet — weiches Ausklingen";
    case "PAUSED":
      return "Pausiert — Weiter zum Fortsetzen";
    case "COOLDOWN":
      return "Cooldown — Output aus, Session endet gleich";
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
