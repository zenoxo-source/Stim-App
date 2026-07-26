// estim-setup.js — Body / electrode setup catalog for Autodrive.
// Pure data + helpers (browser + Node tests). Maps UI choices → engine placement.

/** @typedef {"loops"|"pads"|"mixed"|"insertable"} ElectrodeKind */
/** @typedef {"independent_4"|"common_3"|"single_channel_2"} WiringMode */
/** @typedef {"penis"|"pelvic"|"general"} AnatomyFocus */

/**
 * How contacts are wired to Coyote A/B.
 * independent_4: each channel has its own 2 contacts (correct dual)
 * common_3: one shared electrode + one unique per channel (triphase-like)
 * single_channel_2: only one channel used (2 contacts)
 */
export const WIRING_MODES = Object.freeze({
  independent_4: {
    id: "independent_4",
    label: "4 Kontakte · A und B getrennt",
    short: "A+B getrennt",
    contacts: 4,
    description:
      "Pro Kanal zwei Adern an zwei Elektroden. A und B sind unabhängige Kreise — ideal für Dual-Loops am Penis.",
    diagram: "A1—A2  ·  B1—B2",
    warn: null,
  },
  common_3: {
    id: "common_3",
    label: "3 Kontakte · Common-Return",
    short: "Common",
    contacts: 3,
    description:
      "Eine gemeinsame Elektrode (z. B. Basis-Loop) teilt sich A und B; je ein freier Pol an Mitte und Glans. Kanäle beeinflussen sich.",
    diagram: "Common ⇄ A  ·  Common ⇄ B",
    warn: "Intensität A/B weniger unabhängig — Soft-Limits und Balance nutzen.",
  },
  single_channel_2: {
    id: "single_channel_2",
    label: "2 Kontakte · nur ein Kanal",
    short: "1 Kanal",
    contacts: 2,
    description:
      "Nur Kanal A (oder B): zwei Loops/Pads als ein Kreis. Fokus-Kanal im Autodrive setzen.",
    diagram: "A1—A2  (B ungenutzt)",
    warn: null,
  },
});

export const ELECTRODE_KINDS = Object.freeze({
  loops: {
    id: "loops",
    label: "Loops / Ringe",
    icon: "○",
    blurb: "Leitfähige Cockrings am Schaft — fokussiert, oft intensiver an der Eichel.",
  },
  pads: {
    id: "pads",
    label: "Haftpads",
    icon: "▭",
    blurb: "Flächige Pads — weicher, gut zum Einstieg und Perineum.",
  },
  mixed: {
    id: "mixed",
    label: "Gemischt",
    icon: "◎",
    blurb: "z. B. Loop am Schaft + Pad Perineum oder Loop + Insertable.",
  },
  insertable: {
    id: "insertable",
    label: "Insertable",
    icon: "●",
    blurb: "Bipolarer Plug/Probe — lokal, konservatives Cap.",
  },
});

/** Contact sites for channel mapping (penis-first, plus pelvic). */
export const BODY_SITES = Object.freeze({
  base: {
    id: "base",
    label: "Basis (Wurzel)",
    region: "penis",
    heat: 1,
    hint: "Oft der weichere Pol; guter Common.",
  },
  mid: {
    id: "mid",
    label: "Mitte Schaft",
    region: "penis",
    heat: 2,
    hint: "Zwischen Basis und Corona — guter zweiter Kontakt für Kanal A.",
  },
  corona: {
    id: "corona",
    label: "Corona / Kranz",
    region: "penis",
    heat: 3,
    hint: "Empfindlicher; oft Start von Kanal B.",
  },
  glans: {
    id: "glans",
    label: "Unter Eichel",
    region: "penis",
    heat: 4,
    hint: "Heißester Bereich — niedriges Soft-Limit B empfohlen.",
  },
  perineum: {
    id: "perineum",
    label: "Perineum",
    region: "pelvic",
    heat: 2,
    hint: "Zwischen Anus und Genitalien — tiefer Throb.",
  },
  pubis: {
    id: "pubis",
    label: "Schamhügel / Pubis",
    region: "pelvic",
    heat: 1,
    hint: "Äußerer Kontakt für Beckenkreis.",
  },
  labia: {
    id: "labia",
    label: "Labien-Seiten",
    region: "pelvic",
    heat: 3,
    hint: "Nicht direkt auf die Klitoris-Glans.",
  },
  insertable: {
    id: "insertable",
    label: "Insertable (bipolar)",
    region: "internal",
    heat: 3,
    hint: "Beide Pole im Toy — nur ESTIM-geeignet.",
  },
});

/**
 * Setup presets with climax-oriented recommendations.
 * finishScore 1–5 = how hard the preset prioritizes orgasm path.
 * softRatioB = empfohlene Soft-Limit-B / Soft-Limit-A (0.7–1.0).
 * settingsLines = concrete dials shown in the advice card.
 */
export const SETUP_PRESETS = Object.freeze({
  loops_ab_finish: {
    id: "loops_ab_finish",
    label: "★ Abspritzen A+B",
    tag: "Finish",
    finishScore: 5,
    electrodeKind: "loops",
    wiringMode: "independent_4",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "corona",
    siteB2: "glans",
    templateId: "finish_loops",
    placement: "loops_ab_penis",
    abRole: "sync",
    channelFocus: "both",
    balanceB: 88,
    softRatioB: 0.88,
    climaxPriority: true,
    description: "Bestes Loop-Setup zum Abspritzen",
    climaxAdvice:
      "1 Edge → langer Multi-Wave-Push · A+B Sync · „Fast“ im Push verlängert · kein Abbruch bei „zu stark“",
    settingsLines: [
      "Soft-Limit A: so hoch, dass du noch steuern kannst (oft 80–140)",
      "Soft-Limit B: ≈ 85–90 % von A (Glans etwas unter Basis)",
      "Balance B: 88 % · A/B-Rolle: Sync · Fokus: beide",
      "Dauer ~14 Min · 1 Edge · Finish-Template · Kalibrierung an",
    ],
    tips: [
      "Kalibrierung nicht skippen — Baseline bestimmt Push-Höhe",
      "Bei „Fast“ im Push tippen, nicht stoppen",
      "Master nicht zu niedrig — sonst erstickt der Drive",
    ],
  },
  loops_ab_rush: {
    id: "loops_ab_rush",
    label: "★ Abspritzen schnell",
    tag: "Finish",
    finishScore: 5,
    electrodeKind: "loops",
    wiringMode: "independent_4",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "corona",
    siteB2: "glans",
    templateId: "loops_rush",
    placement: "loops_ab_penis",
    abRole: "sync",
    channelFocus: "both",
    balanceB: 90,
    softRatioB: 0.9,
    climaxPriority: true,
    description: "6 Min · wenig Tease · direkter Push",
    climaxAdvice: "Nur wenn du schon „warm“ bist · Sync · höhere Balance B · „Jetzt“ = sofort Push",
    settingsLines: [
      "Soft-Limit B ≈ 90 % von A · Balance B: 90 %",
      "Dauer 6 Min · 0 Edges · Sync · Probe A/B vorher",
      "Sensitivität medium · Master eher hoch",
    ],
    tips: ["Limits vorher mit Probe A/B checken", "„Jetzt“ springt in den Push"],
  },
  loops_ab_glans_finish: {
    id: "loops_ab_glans_finish",
    label: "★ Abspritzen Glans",
    tag: "Finish",
    finishScore: 4,
    electrodeKind: "loops",
    wiringMode: "independent_4",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "corona",
    siteB2: "glans",
    templateId: "finish_glans",
    placement: "loops_ab_glans_hot",
    abRole: "aSteady_bRhythm",
    channelFocus: "both",
    balanceB: 78,
    softRatioB: 0.75,
    climaxPriority: true,
    description: "Spitze führend · schonende Balance",
    climaxAdvice: "B-Limit klar unter A · sanfte Sensitivität · Push bleibt bei „zu stark“",
    settingsLines: [
      "Soft-Limit B ≈ 70–80 % von A (Spitze schonen)",
      "Balance B: 78 % · A steady / B Rhythmus",
      "Dauer ~12 Min · 1 Edge · gentle",
    ],
    tips: ["Soft-Limit B klar unter A", "Zu stark drosselt nur, bricht Finish nicht ab"],
  },
  loops_ab_classic: {
    id: "loops_ab_classic",
    label: "Loops Klassisch",
    tag: "Penis",
    finishScore: 3,
    electrodeKind: "loops",
    wiringMode: "independent_4",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "corona",
    siteB2: "glans",
    templateId: "loops_classic",
    placement: "loops_ab_penis",
    abRole: "aRhythm_bSteady",
    channelFocus: "both",
    balanceB: 85,
    softRatioB: 0.85,
    climaxPriority: false,
    description: "2 Edges · ausgewogen · oft Abspritzen",
    climaxAdvice: "Nach 2 Edges kommt Push — „Fast“ im Edge / Push nutzen",
    settingsLines: [
      "Soft-Limit B ≈ 85 % von A · Balance B: 85 %",
      "2 Edges · A Rhythmus / B Steady · ~15 Min",
    ],
    tips: ["A Rhythmus Basis, B Steady Glans", "Gute Allround-Wahl"],
  },
  loops_ab_tease: {
    id: "loops_ab_tease",
    label: "Loops Tease",
    tag: "Penis",
    finishScore: 2,
    electrodeKind: "loops",
    wiringMode: "independent_4",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "corona",
    siteB2: "glans",
    templateId: "loops_tease",
    placement: "loops_ab_penis",
    abRole: "aRhythm_bSteady",
    channelFocus: "both",
    balanceB: 80,
    softRatioB: 0.82,
    climaxPriority: false,
    description: "Langer Edge — weniger Finish-Fokus",
    climaxAdvice: "Zum Abspritzen eher „★ Abspritzen A+B“ wählen",
    settingsLines: ["4 Edges · Balance B: 80 % · Tease-Template", "Soft B etwas unter A"],
    tips: ["4 Edges vor Push", "Climax-Patterns aus — reines Tease"],
  },
  loops_ab_edge: {
    id: "loops_ab_edge",
    label: "Loops Edge/Deny",
    tag: "Penis",
    finishScore: 3,
    electrodeKind: "loops",
    wiringMode: "independent_4",
    siteA1: "base",
    siteA2: "corona",
    siteB1: "corona",
    siteB2: "glans",
    templateId: "loops_edge",
    placement: "loops_ab_penis",
    abRole: "aSteady_bRhythm",
    channelFocus: "both",
    balanceB: 78,
    softRatioB: 0.78,
    climaxPriority: false,
    description: "Deny dann harter Push",
    climaxAdvice: "Nach Deny kommt Push — „Jetzt“ erzwingt Push früher",
    settingsLines: [
      "Soft-Limit B ≈ 75–80 % von A · Balance B: 78 %",
      "3 Edges Deny · B rhythmisch an der Spitze",
    ],
    tips: ["B/Spitze rhythmisch", "Nicht zu viele Denies vor dem Finish"],
  },
  loops_common3: {
    id: "loops_common3",
    label: "3 Loops Common",
    tag: "Penis",
    finishScore: 4,
    electrodeKind: "loops",
    wiringMode: "common_3",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "base",
    siteB2: "glans",
    templateId: "finish_loops",
    placement: "loops_ab_penis",
    abRole: "sync",
    channelFocus: "both",
    balanceB: 82,
    softRatioB: 0.82,
    climaxPriority: true,
    description: "Basis geteilt · Finish-Pfad",
    climaxAdvice: "Common-Basis · Sync · Balance B ~80 · ★ Finish-Engine",
    settingsLines: [
      "Common = Basis-Loop (A+B teilen sich Rückleiter)",
      "Soft-Limit B ≈ 80–85 % von A · Balance B: 82 %",
      "Sync · 1 Edge · Finish-Template",
    ],
    tips: ["Basis-Loop = Common für A und B", "Kanäle koppeln — Soft-Limits vorsichtig"],
  },
  pads_finish: {
    id: "pads_finish",
    label: "★ Abspritzen Pads",
    tag: "Finish",
    finishScore: 4,
    electrodeKind: "pads",
    wiringMode: "independent_4",
    siteA1: "perineum",
    siteA2: "base",
    siteB1: "pubis",
    siteB2: "mid",
    templateId: "finish_pads",
    placement: "soft_external",
    abRole: "sync",
    channelFocus: "both",
    balanceB: 100,
    softRatioB: 1.0,
    climaxPriority: true,
    description: "Flächig · höheres Cap · Push",
    climaxAdvice: "Pads vertragen mehr Cap · Soft A≈B · 1 Edge · Sync · „Fast“ im Push",
    settingsLines: [
      "Soft-Limit A ≈ B (gleiche Fläche) · oft 100–160",
      "Balance B: 100 % · Sync · Finish-Pads-Template",
      "Dauer ~12 Min · 1 Edge",
    ],
    tips: ["Große Pads = weicher Drive", "Gute Wahl wenn Loops zu scharf sind"],
  },
  pads_soft: {
    id: "pads_soft",
    label: "Pads weich",
    tag: "Pads",
    finishScore: 2,
    electrodeKind: "pads",
    wiringMode: "independent_4",
    siteA1: "perineum",
    siteA2: "base",
    siteB1: "pubis",
    siteB2: "mid",
    templateId: "classic",
    placement: "soft_external",
    abRole: "sync",
    channelFocus: "both",
    balanceB: 100,
    softRatioB: 1.0,
    climaxPriority: false,
    description: "Weiche Pads · klassischer Verlauf",
    climaxAdvice: "Zum Abspritzen „★ Abspritzen Pads“ nutzen",
    settingsLines: ["Soft A≈B · Balance 100 % · klassisches Template"],
    tips: ["Einsteiger-freundlich"],
  },
  perineum_base: {
    id: "perineum_base",
    label: "Perineum + Basis",
    tag: "Pelvic",
    finishScore: 3,
    electrodeKind: "mixed",
    wiringMode: "single_channel_2",
    siteA1: "perineum",
    siteA2: "base",
    siteB1: "perineum",
    siteB2: "base",
    templateId: "finish_pads",
    placement: "perineum_combo",
    abRole: "sync",
    channelFocus: "A",
    balanceB: 100,
    softRatioB: 1.0,
    climaxPriority: true,
    description: "Tiefer Kreis · Fokus A · Finish",
    climaxAdvice: "Ein Kanal · Fokus A · Finish-Template · langsam kalibrieren",
    settingsLines: [
      "Nur Kanal A belegt · Soft-Limit A konservativ starten",
      "Fokus: A · Finish-Pads-Template · 1 Edge",
    ],
    tips: ["Nur ein voller Kreis (2 Kontakte)", "Tiefer Throb, oft weniger „scharf“"],
  },
  /** Two loops on one Coyote channel — most common simple penis setup */
  loops_single_a: {
    id: "loops_single_a",
    label: "2 Loops · Kanal A",
    tag: "1 Kanal",
    finishScore: 4,
    electrodeKind: "loops",
    wiringMode: "single_channel_2",
    siteA1: "base",
    siteA2: "glans",
    siteB1: "base",
    siteB2: "glans",
    templateId: "finish_loops_single",
    placement: "deep_pressure",
    abRole: "sync",
    channelFocus: "A",
    balanceB: 100,
    softRatioB: 1.0,
    climaxPriority: true,
    description: "Basis + unter Eichel · nur A",
    climaxAdvice:
      "Beide Loops an Kanal A stecken · Soft-Limit A setzen · Kalibrierung · „Fast“ im Push",
    settingsLines: [
      "Coyote A+: Basis-Loop · A−: Loop unter Eichel (oder umgekehrt)",
      "Kanal B bleibt frei · Soft-Limit A bewusst wählen",
      "Dauer ~12 Min · 1 Edge · Finish 1-Kanal · Cap etwas strenger",
    ],
    tips: [
      "Einfachstes Loop-Setup — gut zum Einstieg",
      "Eichel-nah = intensiver: bei „zu stark“ tippen, nicht abbrechen",
      "Für Stereo später „Loops Klassisch“ (A+B) wählen",
    ],
  },
  loops_single_b: {
    id: "loops_single_b",
    label: "2 Loops · Kanal B",
    tag: "1 Kanal",
    finishScore: 4,
    electrodeKind: "loops",
    wiringMode: "single_channel_2",
    siteA1: "base",
    siteA2: "glans",
    siteB1: "base",
    siteB2: "glans",
    templateId: "finish_loops_single",
    placement: "deep_pressure",
    abRole: "sync",
    channelFocus: "B",
    balanceB: 100,
    softRatioB: 1.0,
    climaxPriority: true,
    description: "Basis + unter Eichel · nur B",
    climaxAdvice:
      "Beide Loops an Kanal B stecken · Soft-Limit B setzen · Kalibrierung · „Fast“ im Push",
    settingsLines: [
      "Coyote B+: Basis-Loop · B−: Loop unter Eichel (oder umgekehrt)",
      "Kanal A bleibt frei · Soft-Limit B bewusst wählen",
      "Dauer ~12 Min · 1 Edge · Finish 1-Kanal",
    ],
    tips: [
      "Gleich wie Kanal A, falls du B am Gerät nutzt",
      "Soft-Limit des genutzten Kanals zählt",
    ],
  },
  loops_single_classic: {
    id: "loops_single_classic",
    label: "2 Loops · 1 Kanal (Edges)",
    tag: "1 Kanal",
    finishScore: 3,
    electrodeKind: "loops",
    wiringMode: "single_channel_2",
    siteA1: "base",
    siteA2: "glans",
    siteB1: "base",
    siteB2: "glans",
    templateId: "loops_single",
    placement: "deep_pressure",
    abRole: "sync",
    channelFocus: "A",
    balanceB: 100,
    softRatioB: 1.0,
    climaxPriority: false,
    description: "2 Edges · nur ein Kanal",
    climaxAdvice: "Nach 2 Edges kommt Push — „Fast“ nutzen",
    settingsLines: [
      "2 Loops am gewählten Kanal (A standard) · Basis ↔ unter Eichel",
      "2 Edges · ~12 Min · Klassisch 1-Kanal",
    ],
    tips: ["Kanal im Wizard A oder B umschalten"],
  },
});

/**
 * Map setup choices → engine placement id.
 * @param {{ electrodeKind?: string, wiringMode?: string, siteB2?: string, siteB1?: string }} s
 */
export function derivePlacementFromSetup(s) {
  const kind = s?.electrodeKind || "loops";
  const wiring = s?.wiringMode || "independent_4";
  const bHot = s?.siteB2 === "glans" || s?.siteB1 === "glans";

  if (kind === "insertable") return "insertable";
  if (kind === "pads") return "soft_external";
  if (kind === "mixed") {
    if (s?.siteA1 === "perineum" || s?.siteA2 === "perineum") return "perineum_combo";
    return "dual";
  }
  // loops
  if (wiring === "single_channel_2") {
    // Perineum + base single channel stays pelvic combo when mixed already handled
    return "deep_pressure";
  }
  if (bHot && (s?.balanceB ?? 100) <= 75) return "loops_ab_glans_hot";
  if (wiring === "independent_4" || wiring === "common_3") return "loops_ab_penis";
  return "loops_ab_penis";
}

/**
 * @param {object} setup partial setup fields
 * @returns {object} patch for Autodrive config
 */
export function setupToConfigPatch(setup) {
  const s = setup || {};
  const placement = s.placement || derivePlacementFromSetup(s);
  /** @type {Record<string, unknown>} */
  const patch = {
    electrodeKind: s.electrodeKind || "loops",
    wiringMode: s.wiringMode || "independent_4",
    siteA1: s.siteA1 || "base",
    siteA2: s.siteA2 || "mid",
    siteB1: s.siteB1 || "corona",
    siteB2: s.siteB2 || "glans",
    balanceB: clampInt(s.balanceB, 40, 100, 85),
    placement,
    abRole: s.abRole || "aRhythm_bSteady",
    channelFocus: s.channelFocus || "both",
    templateId: s.templateId,
  };
  if (typeof s.climaxPriority === "boolean") patch.climaxPriority = s.climaxPriority;
  if (typeof s.id === "string") patch.setupPresetId = s.id;
  return patch;
}

/**
 * Suggest Soft-Limit B given Soft-Limit A and a setup/preset.
 * @param {number} softA
 * @param {{ softRatioB?: number, balanceB?: number }|null} setup
 */
export function recommendSoftLimitB(softA, setup) {
  const a = Math.round(Number(softA));
  if (!Number.isFinite(a) || a <= 0) return null;
  const ratio =
    typeof setup?.softRatioB === "number"
      ? setup.softRatioB
      : (Number(setup?.balanceB) || 85) / 100;
  const r = Math.min(1, Math.max(0.55, ratio));
  return Math.max(10, Math.min(200, Math.round(a * r)));
}

/**
 * @param {string} presetId
 * @returns {object|null}
 */
export function getSetupPreset(presetId) {
  return SETUP_PRESETS[presetId] || null;
}

export function listSetupPresets() {
  return Object.values(SETUP_PRESETS);
}

export function listWiringModes() {
  return Object.values(WIRING_MODES);
}

export function listElectrodeKinds() {
  return Object.values(ELECTRODE_KINDS);
}

export function listBodySites(regionFilter) {
  const all = Object.values(BODY_SITES);
  if (!regionFilter) return all;
  return all.filter((s) => s.region === regionFilter || regionFilter === "all");
}

/**
 * SVG-friendly hot zones for penis map (percent coords).
 */
export const PENIS_MAP_ZONES = Object.freeze([
  { id: "glans", label: "Eichel", cx: 50, cy: 14, r: 11 },
  { id: "corona", label: "Corona", cx: 50, cy: 28, r: 10 },
  { id: "mid", label: "Mitte", cx: 50, cy: 48, r: 11 },
  { id: "base", label: "Basis", cx: 50, cy: 70, r: 12 },
  { id: "perineum", label: "Perineum", cx: 50, cy: 88, r: 9 },
]);

/**
 * Build human wiring checklist lines for the guide panel.
 * @param {object} cfg
 */
export function buildWiringChecklist(cfg) {
  const c = cfg || {};
  const wiring = WIRING_MODES[c.wiringMode] || WIRING_MODES.independent_4;
  const sa1 = BODY_SITES[c.siteA1] || BODY_SITES.base;
  const sa2 = BODY_SITES[c.siteA2] || BODY_SITES.mid;
  const sb1 = BODY_SITES[c.siteB1] || BODY_SITES.corona;
  const sb2 = BODY_SITES[c.siteB2] || BODY_SITES.glans;
  const lines = [];

  if (c.wiringMode === "single_channel_2") {
    const focus = c.channelFocus === "B" ? "B" : "A";
    const idle = focus === "A" ? "B" : "A";
    // Sites for the active channel (UI mirrors A-sites onto B when single)
    const p1 = (focus === "B" ? sb1 : sa1).label;
    const p2 = (focus === "B" ? sb2 : sa2).label;
    lines.push(`Kanal ${focus}: ${p1} ↔ ${p2} (beide Adern von ${focus})`);
    lines.push(`Kanal ${idle}: ungenutzt — Soft-Limit ${focus} zählt`);
    lines.push("Zwei Loops = ein Kreis: Basis + unter Eichel (typisch)");
  } else if (c.wiringMode === "common_3") {
    lines.push(`Common (geteilt A+B): ${sa1.label}`);
    lines.push(`Kanal A freier Pol: ${sa2.label}`);
    lines.push(`Kanal B freier Pol: ${sb2.label}`);
    if (wiring.warn) lines.push(`Hinweis: ${wiring.warn}`);
  } else {
    lines.push(`Kanal A: ${sa1.label} ↔ ${sa2.label} (beide Adern von A)`);
    lines.push(`Kanal B: ${sb1.label} ↔ ${sb2.label} (beide Adern von B)`);
    lines.push("Nicht: nur eine Ader pro Kanal an je einen Loop — Kreis unvollständig.");
  }
  if ((c.balanceB ?? 100) < 100) {
    lines.push(`Balance B: ${c.balanceB}% relativ zu A (Glans schonen)`);
  }
  return lines;
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
