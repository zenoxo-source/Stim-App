// voice-coach.js — spoken coaching for Autodrive sessions (Web Speech TTS).
//
// Speaks short cues on phase changes (edging, surge, push, aftercare), runs a
// breathing cadence during WARMUP/AFTERCARE and bracing cues in EDGE_HOLD.
// Explicit 🔊 toggle; stops on fullscreen close, panic or session end.
// No audio is recorded — speechSynthesis only.

import { log } from "../state.js";

const CUES = {
  WARMUP: "Lass es aufbauen. Atme ruhig ein und aus.",
  BUILD: "Gleich wird es intensiver. Bleib entspannt.",
  TEASE: "Lass dich treiben. Du bist kurz davor.",
  EDGE_HOLD: "Am Limit. Halten. Gleich.",
  SURGE: "Kurz davor. Bereit für den Push?",
  CLIMAX_PUSH: "Jetzt!",
  AFTERCARE: "Gut gemacht. Atme tief ein… und langsam aus…",
};

const BREATH_IN = "Ein";
const BREATH_OUT = "Aus";
const BRACE_CUE = "Spann den Beckenboden an. Halten… lösen.";

let enabled = false;
let breathTimer = null;
let currentVoice = null;

function supported() {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
}

function pickGermanVoice() {
  if (currentVoice) return currentVoice;
  try {
    const voices = window.speechSynthesis.getVoices();
    currentVoice = voices.find((v) => /^de/i.test(v.lang)) || voices[0] || null;
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
  breathTimer = setInterval(() => {
    if (!enabled) return;
    speak(BREATH_IN);
    setTimeout(() => {
      if (enabled) speak(BREATH_OUT);
    }, 3800);
  }, 8000);
}

function stopBreathCadence() {
  if (breathTimer) {
    clearInterval(breathTimer);
    breathTimer = null;
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

function onPhaseChange(e) {
  if (!enabled) return;
  const phase = e && e.detail ? e.detail.phase : null;
  if (CUES[phase]) speak(CUES[phase]);
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
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVoiceCoach, { once: true });
  } else {
    initVoiceCoach();
  }
}
