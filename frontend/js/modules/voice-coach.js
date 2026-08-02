// voice-coach.js — spoken coaching for Autodrive sessions (Web Speech TTS).
//
// Speaks short cues on phase changes (edging, surge, push, aftercare), runs a
// breathing cadence during WARMUP/AFTERCARE and bracing cues in EDGE_HOLD.
// Explicit 🔊 toggle; stops on fullscreen close, panic or session end.
// No audio is recorded — speechSynthesis only.

import { log } from "../state.js";
import { startBreathSensor, stopBreathSensor } from "./breath-sensor.js";

const CUES = {
  WARMUP: "Lass es aufbauen. Atme ruhig ein und aus.",
  BUILD: "Gleich wird es intensiver. Bleib entspannt.",
  TEASE: "Lass dich treiben. Du bist kurz davor.",
  EDGE_HOLD: "Am Limit. Halten. Gleich.",
  SURGE: "Kurz davor. Bereit für den Push?",
  CLIMAX_PUSH: "Jetzt!",
  AFTERCARE: "Gut gemacht. Atme tief ein… und langsam aus…",
};

// F9: persona-flavored cue overrides (applied when a persona is selected).
const CUES_PERSONA = {
  domina: {
    EDGE_HOLD: "Halten. Nicht kommen. Noch nicht.",
    CLIMAX_PUSH: "Komm für mich. Jetzt!",
    AFTERCARE: "Braves Stück. Atme tief ein… und aus…",
  },
  nurse: {
    EDGE_HOLD: "Gleichgewicht halten… gleich…",
    CLIMAX_PUSH: "Es ist Zeit. Loslassen!",
    AFTERCARE: "Sehr gut. Tief atmen, bitte schön.",
  },
  master: {
    EDGE_HOLD: "Du wartest, bis ich es sage.",
    CLIMAX_PUSH: "Jetzt. Du gehörst mir.",
    AFTERCARE: "Ausgehalten. Gut gemacht.",
  },
};

const BREATH_IN = "Ein";
const BREATH_OUT = "Aus";
const BRACE_CUE = "Spann den Beckenboden an. Halten… lösen.";

let enabled = false;
let breathTimer = null;
let currentVoice = null;
let persona = "domina";

function supported() {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
}

function pickGermanVoice() {
  if (currentVoice) return currentVoice;
  try {
    const voices = window.speechSynthesis.getVoices();
    const de = voices.filter((v) => /^de/i.test(v.lang));
    if (de.length === 0) {
      currentVoice = voices[0] || null;
      return currentVoice;
    }
    // F9: persona-flavored voices — female for domina/nurse, male for master.
    const wantFemale = persona !== "master";
    const nameRe = wantFemale
      ? /female|weiblich|hedda|katja|petra|anna/i
      : /male|männlich|stefan|markus/i;
    currentVoice = de.find((v) => nameRe.test(v.name)) || de[0] || null;
  } catch {
    currentVoice = null;
  }
  return currentVoice;
}

function speak(text) {
  if (!supported() || !enabled || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickGermanVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = "de-DE";
    }
    u.rate = 0.95;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch (err) {
    console.warn("TTS speak failed:", err);
  }
}

function startBreathCadence() {
  stopBreathCadence();
  // F13: mic-based breathing detection when available (syncs "Ein"/"Aus" to
  // the user's actual breath); fixed timer otherwise.
  startBreathSensor(
    () => {
      if (enabled) speak(BREATH_IN);
    },
    () => {
      if (enabled) speak(BREATH_OUT);
    }
  ).then((ok) => {
    if (ok) return;
    // Fallback: timed cadence.
    breathTimer = setInterval(() => {
      if (!enabled) return;
      speak(BREATH_IN);
      setTimeout(() => {
        if (enabled) speak(BREATH_OUT);
      }, 3800);
    }, 8000);
  });
}

function stopBreathCadence() {
  if (breathTimer) {
    clearInterval(breathTimer);
    breathTimer = null;
  }
  try {
    stopBreathSensor();
  } catch {
    /* ignore */
  }
}

function setStatus(text, kind) {
  const el = document.getElementById("ad-fs-coach-status");
  if (el) {
    el.textContent = text || "";
    el.dataset.kind = kind || "";
  }
  const btn = document.getElementById("ad-fs-coach");
  if (btn) btn.classList.toggle("active", kind === "on");
}

// ---------------------------------------------------------------------------
// F10: external narration (story mode) — independent of the coach toggle.
// ---------------------------------------------------------------------------

let narratorEnabled = false;

/** Speak a text through the narrator (persona voice). */
export function speakExternal(text) {
  if (!supported() || !text) return;
  const clean = String(text).slice(0, 400);
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickGermanVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = "de-DE";
    }
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch (err) {
    console.warn("Narrator TTS failed:", err);
  }
}

/** @returns {boolean} */
export function isNarratorEnabled() {
  return narratorEnabled;
}

export function setNarratorEnabled(on) {
  narratorEnabled = !!on;
  const btn = document.getElementById("btn-story-narrate");
  if (btn) btn.classList.toggle("active", narratorEnabled);
  return narratorEnabled;
}

function personaText(phase) {
  const override = CUES_PERSONA[persona];
  if (override && override[phase]) return override[phase];
  return CUES[phase] || null;
}

function onPhaseChange(e) {
  if (!enabled) return;
  const phase = e && e.detail ? e.detail.phase : null;
  const cue = personaText(phase);
  if (cue) speak(cue);
  if (phase === "WARMUP" || phase === "AFTERCARE") {
    startBreathCadence();
  } else {
    stopBreathCadence();
  }
  // Bracing cue each time the edge hold starts.
  if (phase === "EDGE_HOLD") {
    setTimeout(() => speak(BRACE_CUE), 6000);
  }
}

function toggleCoach() {
  enabled = !enabled;
  if (!enabled) {
    stopBreathCadence();
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    setStatus("", "");
  } else {
    setStatus("🔊 Coach aktiv", "on");
    log("Sprach-Coach aktiviert.", "info");
  }
}

function stopCoach(reason) {
  if (!enabled) return;
  enabled = false;
  stopBreathCadence();
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  setStatus("", "");
  log(`Sprach-Coach gestoppt (${reason}).`, "info");
}

export function initVoiceCoach() {
  if (!supported()) {
    const btn = document.getElementById("ad-fs-coach");
    if (btn) btn.style.display = "none";
    return;
  }
  // Warm the voice list (async on some platforms).
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      currentVoice = null;
      pickGermanVoice();
    };
  } catch {
    /* ignore */
  }
  document.getElementById("ad-fs-coach")?.addEventListener("click", toggleCoach);
  document.getElementById("ad-fs-close")?.addEventListener("click", () => stopCoach("close"));
  window.addEventListener("stim:autodrive-phase", onPhaseChange);
  window.addEventListener("stim:kill-all", () => stopCoach("panic"));
  window.addEventListener("stim:autodrive-climax", () => speak("Genieß den Moment."));
  // F9: persona-flavored cues.
  window.addEventListener("stim:persona-change", (e) => {
    if (e && e.detail && e.detail.persona) {
      persona = e.detail.persona;
      currentVoice = null;
    }
  });
  // F10: story narrator toggle.
  document.getElementById("btn-story-narrate")?.addEventListener("click", () => {
    setNarratorEnabled(!isNarratorEnabled());
    log(isNarratorEnabled() ? "Story-Erzähler aktiviert." : "Story-Erzähler deaktiviert.", "info");
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVoiceCoach, { once: true });
  } else {
    initVoiceCoach();
  }
}
