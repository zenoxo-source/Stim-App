// ai-director.js - Autonomous AI Director (Flagship Feature).
//
// Ein "Regisseur", der eigenstaendig eine E-Stim-Session fuehrt: er ruft in
// regelmaessigen Abstaenden (mit Jitter) das konfigurierte LLM auf, erhaelt
// eine Narrative + 0..3 Stim-Befehle, fuehrt diese aus und passt sich an
// Panic-Events / Cooldowns an.
//
// Baut auf: llm-service.js (Endpoint-Config), ai-bridge.js (Ausfuehrung),
// ai-memory.js (persistenter Kontext), safety-extras.js (Cooldown).
//
// State machine: IDLE -> RUNNING <-> PAUSED -> IDLE

import { AppState, log } from "../state.js";
import { AIChatState } from "./ai-state.js";
import { getMemorySnapshot, addMemory } from "./ai-memory.js";
import { aiPlayPattern, aiCreateCustomPattern, aiStopAll } from "./ai-bridge.js";
import { updateSlidersA, updateSlidersB, updateAIDashboard } from "../control-deck.js";
import { isPanicCooldownActive } from "./safety-extras.js";

const DIRECTOR_KEY = "stim_app_director_v1";

const STATE = Object.freeze({ IDLE: "IDLE", RUNNING: "RUNNING", PAUSED: "PAUSED" });

const PERSONAS = Object.freeze({
  domina: { name: "Mistress", style: "Dominant, streng, fordernd, sadistisch." },
  nurse: { name: "Nurse Joy", style: "Klinisch, neckend, verspielt, experimentierfreudig." },
  master: { name: "The Master", style: "Kalt, berechnend, herablassend, praezise." },
});

const DEFAULTS = Object.freeze({
  persona: "domina",
  theme: "",
  beatIntervalSec: 30,
  maxIntensity: 60,
  startIntensity: 15,
  autoStopMinutes: 20,
  jitter: 0.3,
});

const VALID_COMMANDS = Object.freeze([
  "set_intensity",
  "play_pattern",
  "create_custom_pattern",
  "stop_all",
]);

const VALID_MOODS = Object.freeze(["neutral", "tease", "punish", "reward", "build", "cool"]);

const MIN_BEAT_INTERVAL_SEC = 10;
const MAX_BEAT_INTERVAL_SEC = 600;
const RECENT_NARRATIVE_LIMIT = 8;

let state = STATE.IDLE;
let cfg = { ...DEFAULTS };
let beatNumber = 0;
let startedAt = 0;
let nextBeatTimeout = null;
let autoStopTimeout = null;
let recentNarratives = [];
let lastMood = "neutral";
let abortController = null;
let uiTickHandle = null;

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

/**
 * Load persisted config merged with defaults.
 * @returns {typeof DEFAULTS}
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(DIRECTOR_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...sanitiseConfig(parsed) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist a config patch and return the merged result.
 * @param {Partial<typeof DEFAULTS>} patch
 * @returns {typeof DEFAULTS}
 */
export function saveConfig(patch = {}) {
  const merged = { ...loadConfig(), ...sanitiseConfig(patch) };
  try {
    localStorage.setItem(DIRECTOR_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/**
 * Clamp unknown user input into the allowed ranges. Pure helper.
 * @param {object} input
 * @returns {Partial<typeof DEFAULTS>}
 */
export function sanitiseConfig(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  if (typeof input.persona === "string" && PERSONAS[input.persona]) out.persona = input.persona;
  if (typeof input.theme === "string") out.theme = input.theme.slice(0, 200);
  if (input.beatIntervalSec !== undefined) {
    out.beatIntervalSec = clampRange(
      Number(input.beatIntervalSec),
      10,
      600,
      DEFAULTS.beatIntervalSec
    );
  }
  if (input.maxIntensity !== undefined) {
    out.maxIntensity = clampRange(Number(input.maxIntensity), 1, 200, DEFAULTS.maxIntensity);
  }
  if (input.startIntensity !== undefined) {
    out.startIntensity = clampRange(Number(input.startIntensity), 0, 200, DEFAULTS.startIntensity);
  }
  if (input.autoStopMinutes !== undefined) {
    out.autoStopMinutes = clampRange(
      Number(input.autoStopMinutes),
      1,
      240,
      DEFAULTS.autoStopMinutes
    );
  }
  if (input.jitter !== undefined) {
    out.jitter = clampRange(Number(input.jitter), 0, 0.8, DEFAULTS.jitter);
  }
  return out;
}

function clampRange(v, lo, hi, fallback) {
  if (typeof v !== "number" || isNaN(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Pure helpers (kept testable without AppState/network)
// ---------------------------------------------------------------------------

/**
 * Clamp an intensity value to [0, min(softCap, maxIntensity)].
 * Pure: softCap is passed in so tests can avoid AppState.
 * @param {number} val
 * @param {number} maxIntensity
 * @param {number} softLimitA
 * @param {number} softLimitB
 * @returns {number}
 */
export function clampIntensity(val, maxIntensity, softLimitA, softLimitB) {
  const v = parseInt(val, 10);
  if (isNaN(v)) return 0;
  const softCap = Math.min(
    Math.max(0, Number(softLimitA) || 0),
    Math.max(0, Number(softLimitB) || 0)
  );
  const cap = Math.min(softCap, Math.max(0, Number(maxIntensity) || 0));
  return Math.max(0, Math.min(cap, v));
}

/**
 * Compute the next beat delay (ms) with optional jitter.
 *
 * @param {typeof DEFAULTS} c
 * @param {() => number} [rng] defaults to Math.random
 * @returns {number} delay in ms, minimum 2000
 */
export function computeNextBeatMs(c, rng = Math.random) {
  const baseSec = clampRange(c.beatIntervalSec, MIN_BEAT_INTERVAL_SEC, MAX_BEAT_INTERVAL_SEC, 30);
  const base = baseSec * 1000;
  const jitter = clampRange(c.jitter, 0, 0.8, 0);
  if (jitter <= 0) return base;
  const offset = (rng() - 0.5) * 2 * jitter; // [-jitter, +jitter]
  return Math.max(2000, Math.round(base * (1 + offset)));
}

/**
 * Build the system + user messages for the LLM.
 * Pure given a context object (testable).
 * @param {object} ctx
 * @returns {{ system: string, user: string }}
 */
export function buildDirectorMessages(ctx) {
  const persona = PERSONAS[ctx.persona] || PERSONAS.domina;
  const memSnap = ctx.memorySnapshot || "(keine)";
  const recent = (ctx.recentNarratives || [])
    .slice(-3)
    .map((n, i) => `- ${n}`)
    .join("\n");
  const system = [
    `Du bist der "Director" — ein autonomer KI-Regisseur fuer eine E-Stim-Session mit ${ctx.userName}.`,
    `Du steuerst ein DG-LAB Coyote 3.0 Geraet und entscheidest selbst, was passiert.`,
    `Persona: ${persona.name} — ${persona.style}`,
    `Antworte IMMER auf Deutsch und NUR mit einem einzigen JSON-Objekt (kein Markdown, keine Erklaerung).`,
  ].join("\n");

  const user = [
    `Thema / Stimmung: ${ctx.theme || "(frei, variabel)"}`,
    `Beat Nr. ${ctx.beatNumber} | laeuft ${ctx.elapsedMin} Min | Auto-Stop nach ${ctx.autoStopMin} Min`,
    `Aktuelle Intensitaet: A=${ctx.strA}, B=${ctx.strB} | Muster: ${ctx.pattern || "keins"}`,
    `Harte Limits: levelA/levelB duerfen ${ctx.maxIntensity} NICHT ueberschreiten.`,
    ``,
    `Bekannte User-Praeferenzen:`,
    memSnap,
    ``,
    `Letzte Beats:`,
    recent || "- (none)",
    ``,
    `Antworte mit genau diesem JSON-Schema:`,
    `{`,
    `  "narrative": "1-3 Saeetze in der Ich-Perspektive der Persona. Was gerade passiert.",`,
    `  "commands": [`,
    `    {"name": "set_intensity", "arguments": {"levelA": 0..${ctx.maxIntensity}, "levelB": 0..${ctx.maxIntensity}}},`,
    `    {"name": "play_pattern", "arguments": {"pattern_name": "gentle|rhythm|tease|climax|strobe|wave|heartbeat|alternate|escalate|flutter|drift|sawtooth|duet"}},`,
    `    {"name": "create_custom_pattern", "arguments": {"name": "...", "patternA": [0..150], "patternB": [0..150], "intervalMs": 50..500}},`,
    `    {"name": "stop_all", "arguments": {}}`,
    `  ],`,
    `  "memory": "kurze Notiz ueber den User fuer spaetere Sessions, oder null",`,
    `  "mood": "neutral|tease|punish|reward|build|cool"`,
    `}`,
    ``,
    `Regeln:`,
    `- commands darf 0..3 Eintraege enthalten (0 = nur Narrative).`,
    `- Sei kreativ, unberechenbar, abwechslungsreich.`,
    `- Nicht jede Beat ist "punish" — nutze auch tease, reward, build, cool.`,
    `- Kein Markdown, kein Code-Block, kein Text ausserhalb des JSON.`,
  ].join("\n");

  return { system, user };
}

/**
 * Parse the LLM response into a normalised beat object.
 * Tolerant: strips ```json fences, extracts {...} on malformed output.
 * @param {string} rawText
 * @returns {{ ok: boolean, error?: string, narrative?: string, commands?: Array, memory?: string|null, mood?: string }}
 */
export function parseDirectorResponse(rawText) {
  if (typeof rawText !== "string") return { ok: false, error: "Kein String" };
  let text = rawText.trim();
  if (!text) return { ok: false, error: "Leere Antwort" };

  // Strip a single surrounding code fence pair
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: "Kein JSON-Objekt gefunden" };
    try {
      parsed = JSON.parse(m[0]);
    } catch (err) {
      return { ok: false, error: `JSON-Parsing: ${err.message}` };
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Antwort ist kein Objekt" };
  }

  const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "";

  let rawCommands = Array.isArray(parsed.commands) ? parsed.commands : [];
  if (!Array.isArray(parsed.commands) && parsed.command) rawCommands = [parsed.command];

  const commands = [];
  for (const c of rawCommands) {
    if (!c || typeof c !== "object") continue;
    const name = typeof c.name === "string" ? c.name : c.function && c.function.name;
    if (!name || !VALID_COMMANDS.includes(name)) continue;
    const args = c.arguments ?? (c.function && c.function.arguments) ?? c.parameters ?? {};
    commands.push({ name, arguments: args && typeof args === "object" ? args : {} });
  }

  const memory =
    typeof parsed.memory === "string" &&
    parsed.memory.trim() &&
    parsed.memory.trim().toLowerCase() !== "null"
      ? parsed.memory.trim().slice(0, 500)
      : null;

  const mood = VALID_MOODS.includes(parsed.mood) ? parsed.mood : "neutral";

  if (!narrative && commands.length === 0) {
    return { ok: false, error: "Weder Narrative noch Commands" };
  }

  return { ok: true, narrative, commands, memory, mood };
}

// ---------------------------------------------------------------------------
// State queries
// ---------------------------------------------------------------------------

/** @returns {boolean} */
export function isRunning() {
  return state === STATE.RUNNING;
}

/** @returns {boolean} */
export function isPaused() {
  return state === STATE.PAUSED;
}

/** @returns {boolean} */
export function isActive() {
  return state !== STATE.IDLE;
}

/** @returns {object} status snapshot for UI */
export function getStatus() {
  return {
    state,
    beatNumber,
    startedAt,
    elapsedMs: startedAt ? Date.now() - startedAt : 0,
    autoStopMin: cfg.autoStopMinutes,
    mood: lastMood,
    nextBeatScheduled: nextBeatTimeout !== null,
  };
}

// For tests: reset all state without touching the device.
export function _resetForTest() {
  _clearTimers();
  state = STATE.IDLE;
  cfg = { ...DEFAULTS };
  beatNumber = 0;
  startedAt = 0;
  recentNarratives = [];
  lastMood = "neutral";
  if (abortController) {
    try {
      abortController.abort();
    } catch {
      /* ignore */
    }
    abortController = null;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle: start / stop / pause / resume
// ---------------------------------------------------------------------------

/**
 * Start the Director. Validates config, arms timers, kicks first beat.
 * @param {Partial<typeof DEFAULTS>} [patch]
 * @returns {{ ok: boolean, error?: string }}
 */
export function start(patch) {
  if (state !== STATE.IDLE) return { ok: false, error: "Director laeuft bereits" };
  cfg = patch ? saveConfig(patch) : loadConfig();
  if (!AppState.isConnected) {
    return { ok: false, error: "Nicht mit Geraet verbunden" };
  }
  beatNumber = 0;
  recentNarratives = [];
  lastMood = "neutral";
  startedAt = Date.now();

  state = STATE.RUNNING;
  log(
    `Director gestartet (Persona ${PERSONAS[cfg.persona].name}, alle ${cfg.beatIntervalSec}s).`,
    "success"
  );
  appendDirectorLog(`Director aktiv — ${PERSONAS[cfg.persona].name} uebernimmt.`, "system");

  // Apply start intensity (clamped). Best-effort — ignore BLE errors.
  try {
    const a = clampIntensity(
      cfg.startIntensity,
      cfg.maxIntensity,
      AppState.softLimitA,
      AppState.softLimitB
    );
    updateSlidersA(a);
    updateSlidersB(a);
    updateAIDashboard();
  } catch (err) {
    log(`Director startIntensity Fehler: ${err.message}`, "warning");
  }

  // Arm auto-stop
  const ms = Math.max(60_000, cfg.autoStopMinutes * 60_000);
  autoStopTimeout = setTimeout(() => {
    log(`Director Auto-Stop nach ${cfg.autoStopMinutes} Min.`, "info");
    stop("auto-stop");
  }, ms);

  startUiTick();
  // First beat after a short delay so the user sees the panel switch.
  nextBeatTimeout = setTimeout(runBeat, 2500);
  broadcastStatus();
  return { ok: true };
}

/**
 * Stop the Director. Cancels timers, aborts LLM, soft-stops the device.
 * @param {string} [reason]
 */
export function stop(reason = "manuell") {
  if (state === STATE.IDLE) return;
  _clearTimers();
  state = STATE.IDLE;
  if (abortController) {
    try {
      abortController.abort();
    } catch {
      /* ignore */
    }
    abortController = null;
  }
  appendDirectorLog(`Director gestoppt (${reason}).`, "system");
  log(`Director gestoppt (${reason}).`, "info");
  try {
    aiStopAll();
  } catch (err) {
    log(`Director Cleanup: ${err.message}`, "warning");
  }
  broadcastStatus();
}

/** RUNNING -> PAUSED. Keeps elapsed/auto-stop but cancels next beat. */
export function pause() {
  if (state !== STATE.RUNNING) return;
  state = STATE.PAUSED;
  if (nextBeatTimeout) {
    clearTimeout(nextBeatTimeout);
    nextBeatTimeout = null;
  }
  appendDirectorLog("Director pausiert.", "system");
  log("Director pausiert.", "info");
  broadcastStatus();
}

/** PAUSED -> RUNNING. Reschedules next beat shortly. */
export function resume() {
  if (state !== STATE.PAUSED) return;
  state = STATE.RUNNING;
  appendDirectorLog("Director laeuft weiter.", "system");
  log("Director fortgesetzt.", "info");
  nextBeatTimeout = setTimeout(runBeat, 1500);
  broadcastStatus();
}

function _clearTimers() {
  if (nextBeatTimeout) {
    clearTimeout(nextBeatTimeout);
    nextBeatTimeout = null;
  }
  if (autoStopTimeout) {
    clearTimeout(autoStopTimeout);
    autoStopTimeout = null;
  }
  stopUiTick();
}

// ---------------------------------------------------------------------------
// Beat loop
// ---------------------------------------------------------------------------

async function runBeat() {
  nextBeatTimeout = null;
  if (state !== STATE.RUNNING) return;

  // Safety gate 1: device connected
  if (!AppState.isConnected) {
    log("Director: Geraet getrennt — Pause.", "warning");
    pause();
    return;
  }
  // Safety gate 2: panic cooldown — reschedule short
  if (isPanicCooldownActive()) {
    appendDirectorLog("Panic-Cooldown aktiv — Beat uebersprungen.", "system");
    nextBeatTimeout = setTimeout(runBeat, 10_000);
    return;
  }
  // Safety gate 3: avoid clobbering an in-flight manual chat
  if (AIChatState.isProcessing) {
    nextBeatTimeout = setTimeout(runBeat, 5000);
    return;
  }

  beatNumber += 1;
  const elapsedMin = Math.floor((Date.now() - startedAt) / 60_000);
  const memSnap = safeMemorySnapshot();
  const messages = buildDirectorMessages({
    persona: cfg.persona,
    userName: "User",
    theme: cfg.theme,
    beatNumber,
    elapsedMin,
    autoStopMin: cfg.autoStopMinutes,
    strA: AppState.strengthA,
    strB: AppState.strengthB,
    pattern: AppState.activePattern,
    maxIntensity: cfg.maxIntensity,
    memorySnapshot: memSnap,
    recentNarratives,
  });

  abortController = new AbortController();
  let raw = "";
  try {
    raw = await callDirectorLLM(messages, abortController.signal);
  } catch (err) {
    if (err.name === "AbortError") {
      // Stopped by user — do nothing.
      return;
    }
    log(`Director LLM-Fehler: ${err.message}`, "error");
    appendDirectorLog(`LLM-Fehler: ${err.message}`, "error");
    // Reschedule — keep the loop alive.
    nextBeatTimeout = setTimeout(runBeat, Math.max(5000, cfg.beatIntervalSec * 1000));
    return;
  } finally {
    if (abortController === abortController) abortController = null;
  }

  if (state !== STATE.RUNNING) return; // may have been stopped mid-flight

  const parsed = parseDirectorResponse(raw);
  if (!parsed.ok) {
    log(`Director Antwort unbrauchbar: ${parsed.error}`, "warning");
    appendDirectorLog(`Antwort unverstanden: ${parsed.error}`, "error");
    nextBeatTimeout = setTimeout(runBeat, computeNextBeatMs(cfg));
    return;
  }

  // Apply
  if (parsed.narrative) {
    recentNarratives.push(parsed.narrative);
    if (recentNarratives.length > RECENT_NARRATIVE_LIMIT) {
      recentNarratives = recentNarratives.slice(-RECENT_NARRATIVE_LIMIT);
    }
    appendDirectorLog(parsed.narrative, "narrative");
  }
  lastMood = parsed.mood;
  for (const cmd of parsed.commands) {
    try {
      const summary = executeCommand(cmd);
      if (summary) appendDirectorLog(`> ${cmd.name}: ${summary}`, "command");
    } catch (err) {
      log(`Director Befehl ${cmd.name} Fehler: ${err.message}`, "error");
    }
  }
  if (parsed.memory) {
    try {
      addMemory("note", `[Director] ${parsed.memory}`, false);
    } catch {
      /* ignore */
    }
  }

  broadcastStatus();
  nextBeatTimeout = setTimeout(runBeat, computeNextBeatMs(cfg));
}

/**
 * Execute a single parsed command via the existing ai-bridge / deck helpers.
 * Returns a short human-readable summary.
 * @param {{ name: string, arguments: object }} cmd
 * @returns {string}
 */
function executeCommand(cmd) {
  if (!AppState.isConnected) return "übersprungen (nicht verbunden)";
  switch (cmd.name) {
    case "set_intensity": {
      const a = clampIntensity(
        cmd.arguments.levelA,
        cfg.maxIntensity,
        AppState.softLimitA,
        AppState.softLimitB
      );
      const b = clampIntensity(
        cmd.arguments.levelB,
        cfg.maxIntensity,
        AppState.softLimitA,
        AppState.softLimitB
      );
      updateSlidersA(a);
      updateSlidersB(b);
      updateAIDashboard();
      return `A=${a} B=${b}`;
    }
    case "play_pattern": {
      const r = aiPlayPattern(cmd.arguments.pattern_name);
      return typeof r === "string" ? r : cmd.arguments.pattern_name;
    }
    case "create_custom_pattern": {
      const r = aiCreateCustomPattern(
        cmd.arguments.name,
        cmd.arguments.patternA,
        cmd.arguments.patternB,
        cmd.arguments.intervalMs
      );
      return typeof r === "string" ? r : cmd.arguments.name || "custom";
    }
    case "stop_all":
      return aiStopAll();
    default:
      return `unbekannt: ${cmd.name}`;
  }
}

// ---------------------------------------------------------------------------
// LLM call (non-streaming, reuses endpoint config from settings)
// ---------------------------------------------------------------------------

async function callDirectorLLM(messages, signal) {
  const provider = (document.getElementById("ai-provider")?.value || "ollama").toLowerCase();
  const endpoint =
    document.getElementById("ai-endpoint")?.value || "http://localhost:11434/v1/chat/completions";
  const apiKey = document.getElementById("ai-api-key")?.value || "";
  const model = document.getElementById("ai-model")?.value || "qwen2.5";

  const headers = { "Content-Type": "application/json" };
  if (provider === "openrouter") {
    if (!apiKey) throw new Error("OpenRouter API-Key fehlt (in Einstellungen)");
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "StimApp Director";
  }

  const body = {
    model,
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    stream: false,
    temperature: 0.9,
    max_tokens: 400,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Leere LLM-Antwort");
  return content;
}

function safeMemorySnapshot() {
  try {
    return getMemorySnapshot() || "(keine)";
  } catch {
    return "(keine)";
  }
}

// ---------------------------------------------------------------------------
// UI bindings
// ---------------------------------------------------------------------------

function appendDirectorLog(text, kind = "narrative") {
  const logEl = document.getElementById("director-log");
  if (!logEl) return;
  // Clear placeholder if present
  if (logEl.dataset.placeholder && logEl.children.length <= 1) {
    logEl.innerHTML = "";
    delete logEl.dataset.placeholder;
  }
  const line = document.createElement("div");
  line.className = `director-log-line director-log-${kind}`;
  const time = new Date().toLocaleTimeString();
  if (kind === "narrative") {
    line.innerHTML = `<span class="director-log-time">${time}</span> <span class="director-log-text"></span>`;
    line.querySelector(".director-log-text").textContent = text;
  } else {
    line.textContent = `[${time}] ${text}`;
  }
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function broadcastStatus() {
  const pill = document.getElementById("director-status-pill");
  const btnToggle = document.getElementById("btn-director-toggle");
  const btnPause = document.getElementById("btn-director-pause");
  const meta = document.getElementById("director-meta");
  if (pill) {
    pill.textContent =
      state === STATE.RUNNING ? "läuft" : state === STATE.PAUSED ? "pausiert" : "inaktiv";
    pill.className = `director-pill director-pill-${state.toLowerCase()}`;
  }
  if (btnToggle) {
    btnToggle.textContent = state === STATE.IDLE ? "▶ Start" : "⏹ Stop";
  }
  if (btnPause) {
    btnPause.disabled = state !== STATE.RUNNING && state !== STATE.PAUSED;
    btnPause.textContent = state === STATE.PAUSED ? "▶ Weiter" : "⏸ Pause";
  }
  if (meta) {
    if (state === STATE.IDLE) {
      meta.textContent = beatNumber > 0 ? `Bereit (${beatNumber} Beats zuletzt).` : "Bereit.";
    } else {
      const min = Math.floor((Date.now() - startedAt) / 60_000);
      meta.textContent = `Beat ${beatNumber} · ${min} Min · Mood ${lastMood}`;
    }
  }
}

function startUiTick() {
  stopUiTick();
  uiTickHandle = setInterval(broadcastStatus, 1000);
}

function stopUiTick() {
  if (uiTickHandle) {
    clearInterval(uiTickHandle);
    uiTickHandle = null;
  }
}

function bindUi() {
  // Seed form from persisted config
  const persisted = loadConfig();
  cfg = persisted;
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setVal("director-persona", persisted.persona);
  setVal("director-theme", persisted.theme);
  setVal("director-interval", persisted.beatIntervalSec);
  setVal("director-max", persisted.maxIntensity);
  setVal("director-autostop", persisted.autoStopMinutes);
  setText("director-interval-val", persisted.beatIntervalSec);
  setText("director-max-val", persisted.maxIntensity);
  setText("director-autostop-val", persisted.autoStopMinutes);

  const onToggle = () => {
    if (state === STATE.IDLE) {
      // Read current form values into cfg
      const patch = readForm();
      saveConfig(patch);
      cfg = loadConfig();
      const r = start();
      if (!r.ok) {
        appendDirectorLog(`Start fehlgeschlagen: ${r.error}`, "error");
        log(`Director Start: ${r.error}`, "error");
      }
    } else {
      stop("user");
    }
  };

  const onPause = () => {
    if (state === STATE.RUNNING) pause();
    else if (state === STATE.PAUSED) resume();
  };

  document.getElementById("btn-director-toggle")?.addEventListener("click", onToggle);
  document.getElementById("btn-director-pause")?.addEventListener("click", onPause);

  // Collapse / expand panel body (UI-only, persisted in localStorage)
  const btnCollapse = document.getElementById("btn-director-collapse");
  const body = document.getElementById("director-body");
  if (btnCollapse && body) {
    const syncCollapse = () => {
      const collapsed = body.style.display === "none";
      btnCollapse.textContent = collapsed ? "▸" : "▾";
    };
    try {
      if (localStorage.getItem("stim_app_director_collapsed") === "1") {
        body.style.display = "none";
        syncCollapse();
      }
    } catch {
      /* ignore */
    }
    btnCollapse.addEventListener("click", () => {
      const collapsed = body.style.display === "none";
      body.style.display = collapsed ? "" : "none";
      syncCollapse();
      try {
        localStorage.setItem("stim_app_director_collapsed", collapsed ? "0" : "1");
      } catch {
        /* ignore */
      }
    });
  }

  // Live slider labels + auto-save
  const interval = document.getElementById("director-interval");
  interval?.addEventListener("input", () => {
    setText("director-interval-val", interval.value);
    saveConfig({ beatIntervalSec: Number(interval.value) });
    cfg = loadConfig();
  });
  const max = document.getElementById("director-max");
  max?.addEventListener("input", () => {
    setText("director-max-val", max.value);
    saveConfig({ maxIntensity: Number(max.value) });
    cfg = loadConfig();
  });
  const autostop = document.getElementById("director-autostop");
  autostop?.addEventListener("input", () => {
    setText("director-autostop-val", autostop.value);
    saveConfig({ autoStopMinutes: Number(autostop.value) });
    cfg = loadConfig();
  });
  document.getElementById("director-persona")?.addEventListener("change", (e) => {
    saveConfig({ persona: e.target.value });
    cfg = loadConfig();
  });
  document.getElementById("director-theme")?.addEventListener("change", (e) => {
    saveConfig({ theme: e.target.value });
    cfg = loadConfig();
  });

  // Stop on panic
  window.addEventListener("stim:kill-all", () => {
    if (state !== STATE.IDLE) stop("panic");
  });

  broadcastStatus();
}

function readForm() {
  return {
    persona: document.getElementById("director-persona")?.value || DEFAULTS.persona,
    theme: document.getElementById("director-theme")?.value || "",
    beatIntervalSec: Number(
      document.getElementById("director-interval")?.value || DEFAULTS.beatIntervalSec
    ),
    maxIntensity: Number(document.getElementById("director-max")?.value || DEFAULTS.maxIntensity),
    autoStopMinutes: Number(
      document.getElementById("director-autostop")?.value || DEFAULTS.autoStopMinutes
    ),
  };
}

function injectStyles() {
  if (document.getElementById("director-styles")) return;
  const style = document.createElement("style");
  style.id = "director-styles";
  style.textContent = `
    .director-pill{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;}
    .director-pill-idle{background:rgba(255,255,255,.08);color:var(--text-secondary);}
    .director-pill-running{background:rgba(166,226,46,.18);color:#a6e22e;}
    .director-pill-paused{background:rgba(253,151,31,.18);color:#fd971f;}
    .director-label{display:block;font-size:11px;color:var(--text-secondary);margin-bottom:4px;font-weight:600;}
    .director-log-line{font-size:13px;line-height:1.45;padding:2px 0;}
    .director-log-time{color:var(--text-muted);font-size:11px;margin-right:6px;}
    .director-log-narrative{color:var(--text-primary);}
    .director-log-command{color:#5ab3ff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;}
    .director-log-system{color:var(--text-muted);font-style:italic;}
    .director-log-error{color:#f92672;}
    #director-log{scrollbar-width:thin;}
  `;
  document.head.appendChild(style);
}

document.addEventListener("DOMContentLoaded", () => {
  injectStyles();
  bindUi();
});
