// voice-feedback.js — hands-free Autodrive feedback via the Web Speech API.
//
// During a session the user can say "zu schwach / gut / zu stark / fast /
// jetzt / abgespritzt …" instead of pressing the feedback buttons. Only
// active while Autodrive runs; the mic is only enabled while the toggle is on.
//
// Uses Chromium's SpeechRecognition (Electron). If unavailable the button is
// hidden. Recognition is a privacy-sensitive feature: it only runs while the
// user keeps the toggle enabled, and transcripts are never persisted.

import { log } from "../state.js";
import { injectFeedback, isAutodriveActive } from "./autodrive.js";

/** Ordered phrase → feedback token list. First match wins (DE + EN). */
const PHRASES = [
  {
    match: /zu schwach|zu wenig|schwächer|schwacher|schwaecher|too weak|not enough|weaker/i,
    token: "too_weak",
  },
  {
    match: /zu stark|zu viel|stärker|starker|staerker|heftiger|too strong|stronger|more intense/i,
    token: "too_strong",
  },
  {
    match: /passt|gut so|super|genau richtig|sehr gut|good|perfect|nice|feels good/i,
    token: "good",
  },
  {
    match: /fast|beinahe|gleich da|kurz davor|knapp davor|almost|close|about to/i,
    token: "almost",
  },
  {
    match: /jetzt|abspritzen|komm jetzt|kommst du|komme|now|come now|make me come|do it now/i,
    token: "now",
  },
  { match: /gekommen|abgespritzt|fertig|geschafft|came|done|finished|i came/i, token: "climaxed" },
  { match: /noch nicht|warten|halt|not yet|wait/i, token: "not_yet" },
];

const MIN_REPEAT_MS = 1500;

let recognition = null;
let enabled = false;
let lastToken = "";
let lastFiredAt = 0;

function speechSupported() {
  return (
    typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

function setStatus(text, kind = "") {
  const el = document.getElementById("ad-fs-voice-status");
  if (el) {
    el.textContent = text || "";
    el.dataset.kind = kind;
  }
  const btn = document.getElementById("ad-fs-voice");
  if (btn) btn.classList.toggle("active", kind === "on");
}

function matchToken(transcript) {
  const t = String(transcript || "").toLowerCase();
  for (const { match, token } of PHRASES) {
    if (match.test(t)) return token;
  }
  return null;
}

function handleResult(transcript) {
  const token = matchToken(transcript);
  if (!token) return;
  const now = Date.now();
  if (token === lastToken && now - lastFiredAt < MIN_REPEAT_MS) return;
  lastToken = token;
  lastFiredAt = now;
  if (!isAutodriveActive()) {
    setStatus(`🎤 (nicht aktiv) ${transcript.slice(0, 40)}`, "idle");
    return;
  }
  injectFeedback(token);
  setStatus(`🎤 ${transcript.slice(0, 40)} → ${token}`, "hit");
  log(`Sprach-Feedback: "${transcript}" → ${token}`, "info");
}

function startVoice() {
  if (!speechSupported() || recognition) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  try {
    const rec = new SR();
    rec.lang = "de-DE";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const alt = ev.results[i][0];
        if (alt && alt.transcript) handleResult(alt.transcript);
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setStatus("🎤 Mikrofon verweigert", "error");
        log("Sprach-Feedback: Mikrofonzugriff verweigert.", "warning");
      } else if (ev.error !== "aborted" && ev.error !== "no-speech") {
        setStatus(`🎤 Fehler: ${ev.error}`, "error");
      }
    };
    rec.onend = () => {
      // continuous mode can drop on silence — restart while enabled.
      recognition = null;
      if (enabled) {
        try {
          rec.start();
          recognition = rec;
        } catch {
          enabled = false;
        }
      }
    };
    rec.start();
    recognition = rec;
    enabled = true;
    setStatus("🎤 zuhören…", "on");
    log("Sprach-Feedback aktiv (de-DE). Sag „zu schwach“, „gut“, „fast“, „jetzt“…", "info");
  } catch (err) {
    recognition = null;
    enabled = false;
    setStatus("🎤 Start fehlgeschlagen", "error");
    console.warn("Speech recognition start failed:", err);
  }
}

function stopVoice() {
  enabled = false;
  if (recognition) {
    try {
      recognition.onend = null;
      recognition.abort();
    } catch {
      /* ignore */
    }
    recognition = null;
  }
  setStatus("");
}

function toggleVoice() {
  if (enabled) stopVoice();
  else startVoice();
}

/** Wire the 🎤 button; hide it when the platform has no SpeechRecognition. */
export function initVoiceFeedback() {
  if (!speechSupported()) {
    const btn = document.getElementById("ad-fs-voice");
    if (btn) btn.style.display = "none";
    return;
  }
  document.getElementById("ad-fs-voice")?.addEventListener("click", toggleVoice);
  // Never leave the mic running when the fullscreen UI closes.
  document.getElementById("ad-fs-close")?.addEventListener("click", stopVoice);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVoiceFeedback, { once: true });
  } else {
    initVoiceFeedback();
  }
}
