// webcam-vision.js - Local-only webcam motion-energy biofeedback.
//
// PRIVACY-BY-DESIGN (stricter than before: no longer needs any LLM):
//   1. NEVER auto-enable. User must call enable() explicitly.
//   2. Frames are analysed IN-MEMORY and discarded immediately. Nothing ever
//      leaves the renderer — no model, no network, no logging of pixels.
//   3. Display a clear "WEBCAM ACTIVE" indicator while running.
//   4. Allow disable() at any time — immediately stops capture + releases cam.
//   5. The only derived signal is a scalar "motion energy" 0..1 that feeds the
//      Autodrive engine via injectBioFeedback (same path as the HR strap).
//
// What it does: every `intervalMs`, a small grayscale downscaled frame is
// captured and compared (sum of absolute pixel differences) against the
// previous frame. The normalised difference = motion energy. A moving average
// smooths jitter; sustained high motion (rhythmic movement / arousal) becomes
// a positive biofeedback delta, stillness becomes a gentle negative delta.

import { DOM, log } from "../state.js";
import { injectBioFeedback } from "./autodrive.js";

const WEBCAM_KEY = "stim_app_webcam_motion_v1";

const DEFAULTS = Object.freeze({
  enabled: false, // false on first install; must be explicitly enabled
  intervalMs: 1000, // sample every 1s (local is cheap, unlike LLM calls)
  sampleWidth: 64, // tiny grayscale grid — enough for motion, max privacy
  sampleHeight: 48,
  // Tuning: map normalised motion energy [0..1] to a HR-delta-equivalent
  // signal for the engine (bpm over baseline). Sustained motion pushes commit.
  motionFloor: 0.012, // below this = "still"
  motionCeil: 0.12, // at/above this = "strong arousal"
  deltaFloor: -6, // stillness → small negative delta (relax)
  deltaCeil: 22, // strong motion → strong positive delta (arousal)
  smoothing: 0.3, // EMA factor for the motion moving average
});

let stream = null;
let videoEl = null;
let canvasEl = null;
let intervalHandle = null;
let prevPixels = null;
let motionAvg = 0;
let lastDeltaSentAt = 0;
let consentState = "not-asked"; // not-asked | granted | denied

/**
 * @returns {typeof DEFAULTS}
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(WEBCAM_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist config. Note: `enabled` is always reset to false on save — user
 * must re-enable on each session start.
 */
export function saveConfig(patch) {
  const merged = { ...loadConfig(), ...patch, enabled: false };
  try {
    localStorage.setItem(WEBCAM_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/**
 * Consent state. UI calls setConsent('granted') after explicit checkbox +
 * warning dialog confirmation.
 * @returns {"not-asked"|"granted"|"denied"}
 */
export function getConsent() {
  return consentState;
}

/**
 * @param {"not-asked"|"granted"|"denied"} state
 */
export function setConsent(state) {
  if (!["not-asked", "granted", "denied"].includes(state)) return;
  consentState = state;
}

/**
 * Draw the current video frame to a tiny grayscale pixel buffer.
 * Pure-ish helper (depends on canvas API); exposed for testing the math.
 *
 * @param {HTMLVideoElement} video
 * @param {number} width
 * @param {number} height
 * @param {CanvasRenderingContext2D} [ctx]  injectable for tests
 * @param {HTMLCanvasElement} [canvas]
 * @returns {{ width: number, height: number, gray: Uint8ClampedArray } | null}
 */
export function captureGrayscale(video, width, height, ctx, canvas) {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const cv = canvas || document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = ctx || cv.getContext("2d");
  if (!c) return null;
  try {
    c.drawImage(video, 0, 0, w, h);
  } catch {
    return null;
  }
  const img = c.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  // luminance = 0.299R + 0.587G + 0.114B
  for (let i = 0, j = 0; i < img.length; i += 4, j += 1) {
    gray[j] = (img[i] * 299 + img[i + 1] * 587 + img[i + 2] * 114) / 1000;
  }
  return { width: w, height: h, gray };
}

/**
 * Normalised mean absolute difference between two grayscale buffers.
 * Returns 0 for identical / mismatched lengths. Pure.
 * @param {Uint8ClampedArray} a
 * @param {Uint8ClampedArray} b
 * @returns {number} 0..1
 */
export function motionEnergy(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / (a.length * 255);
}

/**
 * Map a smoothed motion value [0..1] to a biofeedback delta
 * (bpm-over-baseline equivalent for the engine). Pure.
 * @param {number} motion  smoothed motion energy
 * @param {object} cfg
 * @returns {number}
 */
export function motionToDelta(motion, cfg) {
  const c = cfg || DEFAULTS;
  const floor = Number(c.motionFloor) || 0;
  const ceil = Number(c.motionCeil) || 1;
  const span = Math.max(0.0001, ceil - floor);
  const t = Math.min(1, Math.max(0, (motion - floor) / span));
  return Math.round(
    (Number(c.deltaFloor) || 0) + t * ((Number(c.deltaCeil) || 0) - (Number(c.deltaFloor) || 0))
  );
}

/** @returns {boolean} */
export function isActive() {
  return intervalHandle !== null;
}

/**
 * Active webcam capture + periodic LOCAL motion analysis.
 *
 * Pre-conditions: consent === "granted" (no provider/endpoint/model anymore).
 *
 * @param {Partial<typeof DEFAULTS>} [patch]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function enable(patch) {
  if (isActive()) return { ok: false, error: "Webcam-Motion läuft bereits." };
  if (consentState !== "granted") {
    return { ok: false, error: "Consent fehlt — bitte zuerst zustimmen." };
  }
  if (patch) saveConfig(patch);
  const cfg = loadConfig();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: cfg.sampleWidth * 8 }, height: { ideal: cfg.sampleHeight * 8 } },
      audio: false,
    });
  } catch (err) {
    return { ok: false, error: `Kamerazugriff verweigert: ${err.message}` };
  }

  videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
  document.body.appendChild(videoEl);
  await videoEl.play().catch(() => {});

  canvasEl = document.createElement("canvas");
  prevPixels = null;
  motionAvg = 0;

  intervalHandle = setInterval(() => sampleOnce(cfg), Math.max(250, cfg.intervalMs));
  setTimeout(() => sampleOnce(cfg), 400);

  log(
    `Webcam-Motion aktiv (lokal, ${cfg.sampleWidth}×${cfg.sampleHeight}, Interval ${cfg.intervalMs}ms).`,
    "warning"
  );
  updateIndicator(true);
  return { ok: true };
}

/** Stop webcam capture + release the camera. */
export function disable(reason = "manuell") {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (videoEl) {
    try {
      videoEl.pause();
      videoEl.srcObject = null;
      videoEl.remove();
    } catch {
      /* ignore */
    }
    videoEl = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  canvasEl = null;
  prevPixels = null;
  motionAvg = 0;
  updateIndicator(false);
  log(`Webcam-Motion gestoppt (${reason}).`, "info");
}

// Panic / global kill — always release camera (browser only)
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("stim:kill-all", () => {
    try {
      disable("panic");
    } catch {
      /* ignore */
    }
  });
}

/**
 * Capture one tiny grayscale frame, compute motion vs. previous frame, smooth,
 * map to a delta and feed it to the Autodrive engine (best-effort). The frame
 * never leaves this function and is never logged.
 */
function sampleOnce(cfg) {
  if (!videoEl) return;
  const ctx = canvasEl ? canvasEl.getContext("2d") : null;
  const frame = captureGrayscale(videoEl, cfg.sampleWidth, cfg.sampleHeight, ctx, canvasEl);
  if (!frame) return;

  let delta = 0;
  if (prevPixels && prevPixels.length === frame.gray.length) {
    const energy = motionEnergy(prevPixels, frame.gray);
    // Exponential moving average to suppress single-frame jitter.
    const a = Math.min(1, Math.max(0, Number(cfg.smoothing) || 0.3));
    motionAvg = motionAvg * (1 - a) + energy * a;
    delta = motionToDelta(motionAvg, cfg);
  }
  // Always hold the latest frame for the next diff.
  prevPixels = frame.gray;

  updateMotionDisplay(motionAvg, delta);

  // Feed the engine. Throttled to ~one delta per second even if sampling faster.
  const now = Date.now();
  if (typeof injectBioFeedback === "function" && now - lastDeltaSentAt >= 1000) {
    lastDeltaSentAt = now;
    try {
      injectBioFeedback(delta);
    } catch {
      /* biofeedback is best-effort */
    }
  }
}

/** @returns {number} the current smoothed motion energy (0..1). */
export function getMotionAvg() {
  return motionAvg;
}

function updateIndicator(active) {
  const ind = DOM && DOM["webcam-indicator"];
  if (!ind) return;
  if (active) {
    ind.style.display = "inline-block";
    ind.textContent = "● WEBCAM";
    ind.style.color = "var(--color-error)";
  } else {
    ind.style.display = "none";
    ind.textContent = "";
  }
}

function updateMotionDisplay(motion, delta) {
  const pct = Math.round(Math.min(1, motion) * 100);
  const txt = `Motion ${pct}% · Δ${delta >= 0 ? "+" : ""}${delta}`;
  const cached = DOM && DOM["webcam-analysis"];
  if (cached) cached.textContent = txt;
  const status = document.getElementById("webcam-status");
  if (status) status.textContent = txt;
}
