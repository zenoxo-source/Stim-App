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
 * Recommended dual-loop penis presets (UI chips + auto config).
 * wiring independent_4: A base–mid, B corona–glans.
 */
export const SETUP_PRESETS = Object.freeze({
  loops_ab_classic: {
    id: "loops_ab_classic",
    label: "Loops A+B Klassisch",
    tag: "Penis",
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
    description: "A Basis–Mitte (Rhythmus) · B Corona–Eichel (Steady)",
  },
  loops_ab_tease: {
    id: "loops_ab_tease",
    label: "Loops A+B Tease",
    tag: "Penis",
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
    description: "Langer Edge · sanfte Glans-Balance",
  },
  loops_ab_edge: {
    id: "loops_ab_edge",
    label: "Loops A+B Edge",
    tag: "Penis",
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
    balanceB: 75,
    description: "Deny-Style · B/Spitze mit Rhythmus",
  },
  loops_ab_glans: {
    id: "loops_ab_glans",
    label: "Loops Glans-Hot",
    tag: "Penis",
    electrodeKind: "loops",
    wiringMode: "independent_4",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "corona",
    siteB2: "glans",
    templateId: "loops_glans",
    placement: "loops_ab_glans_hot",
    abRole: "aSteady_bRhythm",
    channelFocus: "both",
    balanceB: 70,
    description: "B heißer · Soft-Limit B niedriger halten",
  },
  loops_ab_rush: {
    id: "loops_ab_rush",
    label: "Loops Rush",
    tag: "Penis",
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
    description: "Kurz & direkt · Sync beide Kreise",
  },
  loops_common3: {
    id: "loops_common3",
    label: "3 Loops Common",
    tag: "Penis",
    electrodeKind: "loops",
    wiringMode: "common_3",
    siteA1: "base",
    siteA2: "mid",
    siteB1: "base",
    siteB2: "glans",
    templateId: "loops_classic",
    placement: "loops_ab_penis",
    abRole: "sync",
    channelFocus: "both",
    balanceB: 80,
    description: "Basis = Common · A Mitte · B Eichel (Kanäle gekoppelt)",
  },
  pads_soft: {
    id: "pads_soft",
    label: "Pads weich",
    tag: "Pads",
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
    description: "Weiche Pads · höheres Cap",
  },
  perineum_base: {
    id: "perineum_base",
    label: "Perineum + Basis",
    tag: "Pelvic",
    electrodeKind: "mixed",
    wiringMode: "single_channel_2",
    siteA1: "perineum",
    siteA2: "base",
    siteB1: "perineum",
    siteB2: "base",
    templateId: "classic",
    placement: "perineum_combo",
    abRole: "sync",
    channelFocus: "A",
    balanceB: 100,
    description: "Tiefer Kreis · Fokus A",
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
  if (wiring === "single_channel_2") return "deep_pressure";
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
  return {
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
    lines.push(`Kanal A: ${sa1.label} ↔ ${sa2.label} (beide Adern von A)`);
    lines.push("Kanal B: ungenutzt — Fokus A im Autodrive");
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
