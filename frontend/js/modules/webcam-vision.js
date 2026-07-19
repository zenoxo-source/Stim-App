// webcam-vision.js - Periodic webcam-frame analysis via multimodal LLM.
//
// PRIVACY-BY-DESIGN rules enforced in code:
//   1. NEVER auto-enable. User must call enable() explicitly.
//   2. NEVER persist frames. They're analyzed in-memory and discarded.
//   3. NEVER log frame data (only analysis text).
//   4. Display a clear "WEBCAM ACTIVE" indicator while running.
//   5. Allow disable() at any time — immediately stops capture + releases cam.
//   6. Only works with providers that support vision (Ollama + OpenRouter).
//   7. Frames are JPEG 512×512 (~30 KB base64) to limit memory + bandwidth.
//
// API follows OpenAI vision format. Ollama supports this since llava;
// OpenRouter supports it via GPT-4V / Claude / Gemini Vision etc.

import { DOM, log } from "../state.js";
import { AIChatState } from "./ai-state.js";

const WEBCAM_KEY = "stim_app_webcam_vision_v1";

const DEFAULTS = {
  enabled: false, // false on first install; must be explicitly enabled
  intervalMs: 10_000, // capture every 10s
  maxWidth: 512,
  maxHeight: 512,
  jpegQuality: 0.7,
  visionModel: "", // empty = use main AI model
  systemPrompt:
    "Du siehst ein Standbild aus der Webcam des Users. Beschreibe in 1-2 Sätzen non-judgmental, was du sieht (Körperhaltung, Mimik). gib dann einen Stim-Vorschlag im Tool-Call-Format.",
};

let stream = null;
let videoEl = null;
let intervalHandle = null;
let lastAnalysisText = "";
let lastAnalysisAt = 0;
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
 * Get consent state. UI calls setConsent('granted') after explicit checkbox
 * + warning dialog confirmation.
 * @returns {"not-asked"|"granted"|"denied"}
 */
export function getConsent() {
  return consentState;
}

/**
 * Set consent state.
 * @param {"not-asked"|"granted"|"denied"} state
 */
export function setConsent(state) {
  if (!["not-asked", "granted", "denied"].includes(state)) return;
  consentState = state;
}

/**
 * Check whether a given AI provider supports vision input.
 * @param {"ollama"|"openrouter"|string} provider
 * @returns {boolean}
 */
export function providerSupportsVision(provider) {
  if (!provider) return false;
  const p = String(provider).toLowerCase();
  // Ollama: supports llava, llama3.2-vision, moondream etc. — model-dependent.
  // OpenRouter: many models support vision (gpt-4o, claude-3.5-sonnet, etc.)
  // We assume the user picks a vision-capable model.
  return p === "ollama" || p === "openrouter";
}

/**
 * Capture a single frame from the active webcam stream as base64 JPEG.
 * Pure-ish helper (depends on canvas API); exposed for testing the format.
 *
 * @param {HTMLVideoElement} video
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @param {number} quality 0..1
 * @returns {{ dataUrl: string, base64: string, width: number, height: number } | null}
 */
export function captureFrameToBase64(video, maxWidth, maxHeight, quality) {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, Math.min(maxWidth / vw, maxHeight / vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  c.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", Math.max(0.1, Math.min(1, quality)));
  const base64 = dataUrl.split(",")[1] || "";
  return { dataUrl, base64, width: w, height: h };
}

/**
 * Build the OpenAI-compatible vision message body.
 * Pure helper — for testing the request format.
 *
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} imageBase64
 * @param {string} [userText=""]
 * @returns {{ model: string, messages: Array, stream: boolean }}
 */
export function buildVisionRequestBody(model, systemPrompt, imageBase64, userText = "") {
  return {
    model,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userText || "Beschreibe dieses Bild." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    ],
  };
}

/**
 * @returns {boolean}
 */
export function isActive() {
  return intervalHandle !== null;
}

/**
 * Active webcam capture + periodic analysis.
 *
 * Pre-conditions enforced:
 *   - consent === "granted"
 *   - provider supports vision
 *   - AI endpoint + model configured
 *
 * @param {Partial<typeof DEFAULTS>} [patch]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function enable(patch) {
  if (isActive()) return { ok: false, error: "Webcam-Vision läuft bereits." };
  if (consentState !== "granted") {
    return { ok: false, error: "Consent fehlt — bitte zuerst zustimmen." };
  }
  if (patch) saveConfig(patch);
  const cfg = loadConfig();

  // Provider check
  const provider = (document.getElementById("ai-provider")?.value || "").toLowerCase();
  if (!providerSupportsVision(provider)) {
    return { ok: false, error: `Provider „${provider}" unterstützt keine Vision-API.` };
  }
  const endpoint = document.getElementById("ai-endpoint")?.value;
  const apiKey = document.getElementById("ai-api-key")?.value;
  const mainModel = document.getElementById("ai-model")?.value;
  const model = cfg.visionModel || mainModel;
  if (!endpoint || !model) {
    return { ok: false, error: "AI-Endpoint oder Model fehlt." };
  }

  // Get camera
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: cfg.maxWidth }, height: { ideal: cfg.maxHeight } },
      audio: false,
    });
  } catch (err) {
    return { ok: false, error: `Kamerazugriff verweigert: ${err.message}` };
  }

  // Build hidden video element
  videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
  document.body.appendChild(videoEl);
  await videoEl.play().catch(() => {});

  // Capture loop
  intervalHandle = setInterval(
    () => analyzeOnce(cfg, endpoint, apiKey, provider, model),
    Math.max(2000, cfg.intervalMs)
  );
  // Immediate first capture
  setTimeout(() => analyzeOnce(cfg, endpoint, apiKey, provider, model), 500);

  log(`Webcam-Vision aktiv (Interval ${cfg.intervalMs}ms, Model ${model}).`, "warning");
  updateIndicator(true);
  return { ok: true };
}

/**
 * Stop webcam capture + release the camera.
 */
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
  updateIndicator(false);
  log(`Webcam-Vision gestoppt (${reason}).`, "info");
}

/**
 * Capture one frame + send to LLM. The LLM's response becomes available via
 * getLastAnalysis(). Frame is discarded immediately after the request.
 */
async function analyzeOnce(cfg, endpoint, apiKey, provider, model) {
  if (!videoEl) return;
  const frame = captureFrameToBase64(videoEl, cfg.maxWidth, cfg.maxHeight, cfg.jpegQuality);
  if (!frame) return;

  // NEVER persist or log the base64 frame data.
  const body = buildVisionRequestBody(model, cfg.systemPrompt, frame.base64);
  // Frame is now only inside `body` for the duration of the request.

  const controller = new AbortController();
  AIChatState.currentController = controller;

  try {
    const headers = { "Content-Type": "application/json" };
    if (provider === "openrouter" && apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log(`Webcam-Vision Fehler ${res.status}: ${text.slice(0, 200)}`, "error");
      return;
    }
    const data = await res.json();
    const text =
      data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "(keine Antwort)";
    lastAnalysisText = typeof text === "string" ? text : JSON.stringify(text);
    lastAnalysisAt = Date.now();
    updateAnalysisDisplay(lastAnalysisText);
    // Append to AI chat history so tool-calls in the response can fire
    try {
      appendVisionToChat(lastAnalysisText);
    } catch {
      /* chat append optional */
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    log(`Webcam-Vision Anfrage fehlgeschlagen: ${err.message}`, "error");
  } finally {
    AIChatState.currentController = null;
  }
}

/**
 * Inject the vision analysis into the AI chat as a system message.
 * Wrapped in try/catch by caller — llm-service is optional dependency.
 */
function appendVisionToChat(text) {
  const chatHistory = document.getElementById("ai-chat-history");
  if (!chatHistory) return;
  // Just visual: append as a quiet "vision" line
  const div = document.createElement("div");
  div.className = "chat-msg system";
  div.style.cssText = "font-size: 12px; opacity: 0.7; font-style: italic;";
  div.textContent = `👁️ Webcam-Vision: ${text}`;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

/**
 * Update the visible "WEBCAM ACTIVE" indicator (red dot, etc.).
 */
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

function updateAnalysisDisplay(text) {
  const el = DOM && DOM["webcam-analysis"];
  if (el) {
    el.textContent = text.slice(0, 500);
    el.title = text;
  }
}

/** @returns {string} last analysis text (empty if never analyzed). */
export function getLastAnalysis() {
  return lastAnalysisText;
}

/** @returns {number} timestamp of last successful analysis (0 if never). */
export function getLastAnalysisAt() {
  return lastAnalysisAt;
}
