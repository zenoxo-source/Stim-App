// funscript.js — Funscript playback (interactive script format, position → intensity).
//
// Standard format: { version, actions: [{at: ms, pos: 0..1}], range, inverted }.
// Imports are validated + size-capped, stored in localStorage, and played back
// through the wave loop with the "replay" output owner (panic/PIN respected).

import { AppState, log } from "../state.js";
import { sendStrengthCommand, sendWaveformCommand, sendSoftStop } from "./bluetooth.js";
import { claimOutput, releaseOutput } from "./output-owner.js";
import { blockDuringPanicCooldown } from "./safety-extras.js";
import { blockIfLocked } from "./session-pin.js";
import { startWaveLoop } from "../control-deck.js";

const SCRIPTS_KEY = "stim_app_funscripts_v1";
const FS_CFG_KEY = "stim_app_funscript_cfg_v1";
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const TICK_MS = 50;

const FS_CFG_DEFAULTS = { speed: 1, invert: false, range: 1, offsetMs: 0, loop: false };

function loadFsCfg() {
  try {
    return { ...FS_CFG_DEFAULTS, ...JSON.parse(localStorage.getItem(FS_CFG_KEY) || "{}") };
  } catch {
    return { ...FS_CFG_DEFAULTS };
  }
}
function saveFsCfg(patch) {
  const next = { ...loadFsCfg(), ...patch };
  try {
    localStorage.setItem(FS_CFG_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** @type {Array<{id: string, name: string, actions: Array<{at: number, pos: number}>, range: number, inverted: boolean}>} */
let scripts = [];
let player = null; // {id, actions, startedAt, lastIdx, timer}
/** External streaming mode (pos pushed by remote clients). */
let streaming = false;
let streamPos = 0;

function loadScripts() {
  try {
    const raw = localStorage.getItem(SCRIPTS_KEY);
    scripts = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(scripts)) scripts = [];
  } catch {
    scripts = [];
  }
  return scripts;
}

function saveScripts() {
  try {
    localStorage.setItem(SCRIPTS_KEY, JSON.stringify(scripts));
  } catch {
    /* ignore */
  }
}

/** @returns {boolean} whether a funscript player is running. */
export function isFunscriptActive() {
  return player !== null;
}

/** Validate a parsed funscript object. */
export function validateFunscript(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Kein gültiges Funscript-Objekt." };
  }
  if (!Array.isArray(data.actions) || data.actions.length === 0) {
    return { ok: false, error: "Funscript ohne Aktionen." };
  }
  if (data.actions.length > 200000) {
    return { ok: false, error: "Zu viele Aktionen (max 200.000)." };
  }
  for (const a of data.actions) {
    if (!a || !Number.isFinite(a.at) || !Number.isFinite(a.pos)) {
      return { ok: false, error: "Aktion ohne at/pos." };
    }
  }
  return {
    ok: true,
    normalized: {
      actions: data.actions,
      range: Number(data.range) || 1,
      inverted: !!data.inverted,
    },
  };
}

/** Import a funscript file. */
export async function importFunscript(file) {
  try {
    if (file && file.size > MAX_SCRIPT_BYTES) {
      return { ok: false, error: "Datei zu groß (max 2 MB)." };
    }
    const text = await file.text();
    const parsed = JSON.parse(text);
    const v = validateFunscript(parsed);
    if (!v.ok) return v;
    loadScripts();
    scripts.push({
      id: "fs_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (file.name || "script").replace(/\.funscript$/i, "").slice(0, 80),
      ...v.normalized,
    });
    if (scripts.length > 20) scripts.splice(0, scripts.length - 20);
    saveScripts();
    return { ok: true, count: scripts.length };
  } catch (err) {
    return { ok: false, error: `Import fehlgeschlagen: ${err.message}` };
  }
}

export function getFunscripts() {
  return loadScripts();
}

export function removeFunscript(id) {
  loadScripts();
  scripts = scripts.filter((s) => s.id !== id);
  saveScripts();
  return scripts;
}

/** Position → logical strength (0..softLimit of focus channel). */
function posToStrength(pos, range, inverted, softA, softB) {
  let p = Math.max(0, Math.min(1, Number(pos) || 0));
  if (inverted) p = 1 - p;
  p *= range;
  const cap = Math.max(softA || 0, softB || 0);
  return Math.round(p * Math.min(cap, 150));
}

/** Start playing a script by id. */
export function startFunscript(id) {
  if (!AppState.isConnected) return { ok: false, error: "Nicht verbunden." };
  if (blockDuringPanicCooldown("Funscript")) return { ok: false, error: "Panic-Cooldown." };
  if (blockIfLocked("Funscript")) return { ok: false, error: "PIN gesperrt." };
  loadScripts();
  const script = scripts.find((s) => s.id === id);
  if (!script) return { ok: false, error: "Skript nicht gefunden." };

  if (player) stopFunscript();
  const claim = claimOutput("replay");
  if (!claim.ok) return { ok: false, error: claim.error || "Claim fehlgeschlagen." };
  // Ensure the wave loop feeds our strength commands.
  if (!AppState.waveLoopInterval) startWaveLoop();

  player = {
    actions: script.actions,
    range: script.range,
    inverted: script.inverted,
    startedAt: Date.now(),
    lastIdx: 0,
    timer: null,
  };
  player.timer = setInterval(tickPlayer, TICK_MS);
  log(`Funscript „${script.name}" gestartet (${script.actions.length} Aktionen).`, "success");
  renderFunscriptUi();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// F2b: real-time streaming from remote clients (stream_funscript command).
// ---------------------------------------------------------------------------

/** @returns {boolean} */
export function isFunscriptStreaming() {
  return streaming;
}

/** Start external streaming mode (client pushes positions). */
export function startFunscriptStream() {
  if (!AppState.isConnected) return { ok: false, error: "Nicht verbunden." };
  if (blockDuringPanicCooldown("Funscript-Stream")) {
    return { ok: false, error: "Panic-Cooldown." };
  }
  if (blockIfLocked("Funscript-Stream")) return { ok: false, error: "PIN gesperrt." };
  if (player) stopFunscript();
  const claim = claimOutput("replay");
  if (!claim.ok) return { ok: false, error: claim.error || "Claim fehlgeschlagen." };
  streaming = true;
  streamPos = 0;
  if (!AppState.waveLoopInterval) startWaveLoop();
  log("Funscript-Streaming aktiv (externe Positionen).", "success");
  renderFunscriptUi();
  return { ok: true };
}

/** Push one position sample (0..1) from a remote client. */
export function streamFunscriptPos(pos) {
  if (!streaming) return false;
  streamPos = Math.max(0, Math.min(1, Number(pos) || 0));
  const cfg = loadFsCfg();
  const strength = posToStrength(
    streamPos,
    cfg.range,
    cfg.invert,
    AppState.softLimitA,
    AppState.softLimitB
  );
  sendStrengthCommand(strength, strength, { writer: "replay" });
  if (strength > 0) {
    sendWaveformCommand(70, 100, 70, 100, { writer: "wave-loop", force: true });
  } else {
    sendWaveformCommand(0, 0, 0, 0, { writer: "wave-loop", force: true });
  }
  return true;
}

/** Stop external streaming mode. */
export function stopFunscriptStream() {
  if (!streaming) return;
  streaming = false;
  streamPos = 0;
  try {
    releaseOutput("replay");
  } catch {
    /* ignore */
  }
  sendSoftStop({ keepStrength: false });
  log("Funscript-Streaming gestoppt.", "info");
  renderFunscriptUi();
}

/** Stop the funscript player. */
export function stopFunscript() {
  if (!player) return;
  clearInterval(player.timer);
  player = null;
  try {
    releaseOutput("replay");
  } catch {
    /* ignore */
  }
  sendSoftStop({ keepStrength: false });
  log("Funscript gestoppt.", "info");
  renderFunscriptUi();
}

function tickPlayer() {
  if (!player) return;
  if (!AppState.isConnected) {
    stopFunscript();
    return;
  }
  const cfg = loadFsCfg();
  const totalMs = player.actions[player.actions.length - 1].at || 1;
  // Speed + offset (ms) applied to the timeline; optional loop wraps around.
  let elapsed = (Date.now() - player.startedAt + (cfg.offsetMs || 0)) * (cfg.speed || 1);
  if (cfg.loop) {
    elapsed = ((elapsed % totalMs) + totalMs) % totalMs;
  }
  const { actions } = player;
  if (elapsed >= totalMs) {
    stopFunscript();
    return;
  }
  // Advance pointer (actions sorted by `at`).
  while (player.lastIdx < actions.length - 2 && actions[player.lastIdx + 1].at <= elapsed) {
    player.lastIdx += 1;
  }
  const a0 = actions[player.lastIdx];
  const a1 = actions[Math.min(player.lastIdx + 1, actions.length - 1)];
  // Interpolate position between the two surrounding actions.
  const span = Math.max(1, a1.at - a0.at);
  const frac = Math.max(0, Math.min(1, (elapsed - a0.at) / span));
  const pos = a0.pos + (a1.pos - a0.pos) * frac;
  const strength = posToStrength(
    pos,
    cfg.range,
    cfg.invert,
    AppState.softLimitA,
    AppState.softLimitB
  );
  sendStrengthCommand(strength, strength, { writer: "replay" });
  if (strength > 0) {
    sendWaveformCommand(70, 100, 70, 100, { writer: "wave-loop", force: true });
  } else {
    sendWaveformCommand(0, 0, 0, 0, { writer: "wave-loop", force: true });
  }
  const progress = document.getElementById("funscript-progress");
  if (progress) {
    progress.value = Math.min(100, (elapsed / totalMs) * 100);
  }
}

function renderFunscriptUi() {
  const list = document.getElementById("funscript-list");
  if (!list) return;
  const all = loadScripts();
  // Streaming status row.
  if (list) {
    const streamRow = document.getElementById("funscript-stream-row");
    if (streamRow) {
      streamRow.style.display = "flex";
      streamRow.querySelector("#fs-stream-status").textContent = streaming
        ? "Streaming aktiv — Positionen vom Remote-Client"
        : "Kein externes Streaming";
      streamRow.querySelector("#fs-stream-start").style.display = streaming
        ? "none"
        : "inline-block";
      streamRow.querySelector("#fs-stream-stop").style.display = streaming
        ? "inline-block"
        : "none";
    }
  }
  if (all.length === 0) {
    list.innerHTML = `<p style="font-size:12px;color:var(--text-muted);">Noch keine Skripte importiert.</p>`;
    return;
  }
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  list.innerHTML = all
    .map(
      (s) => `
      <div class="hotkey-row" data-fsid="${esc(s.id)}">
        <span class="hotkey-label"><strong>${esc(s.name)}</strong>
          <small style="display:block;opacity:0.6;">${s.actions.length} Aktionen · ${s.range}x${s.inverted ? " · invertiert" : ""}</small>
        </span>
        <span class="hotkey-combo">
          <button type="button" class="btn btn-secondary btn-sm" data-fs-preview="${esc(s.id)}" title="Wellenform-Vorschau">👁</button>
          ${player && player.actions === s.actions ? `<button type="button" class="btn btn-secondary btn-sm" data-fs-stop="1">Stop</button>` : `<button type="button" class="btn btn-sm" data-fs-play="${esc(s.id)}">Play</button>`}
          <button type="button" class="btn btn-secondary btn-sm" data-fs-del="${esc(s.id)}">✕</button>
        </span>
      </div>`
    )
    .join("");
  list
    .querySelectorAll("[data-fs-play]")
    .forEach((b) =>
      b.addEventListener("click", () => startFunscript(b.getAttribute("data-fs-play")))
    );
  list
    .querySelectorAll("[data-fs-stop]")
    .forEach((b) => b.addEventListener("click", stopFunscript));
  list.querySelectorAll("[data-fs-del]").forEach((b) => {
    b.addEventListener("click", () => {
      if (player) stopFunscript();
      removeFunscript(b.getAttribute("data-fs-del"));
      renderFunscriptUi();
    });
  });
  list.querySelectorAll("[data-fs-preview]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-fs-preview");
      const script = all.find((s) => s.id === id);
      if (!script) return;
      let canvas = document.getElementById("fs-preview-" + id);
      if (canvas) {
        canvas.style.display = canvas.style.display === "none" ? "block" : "none";
        if (canvas.style.display === "block") drawFunscriptPreview(canvas, script.actions);
        return;
      }
      canvas = document.createElement("canvas");
      canvas.id = "fs-preview-" + id;
      canvas.className = "fs-preview-canvas";
      canvas.width = 600;
      canvas.height = 90;
      b.closest(".hotkey-row").after(canvas);
      drawFunscriptPreview(canvas, script.actions);
    });
  });
}

// F21: funscript waveform preview — downsampled position polyline + time axis.
function drawFunscriptPreview(canvas, actions) {
  if (!canvas || !Array.isArray(actions) || actions.length < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 90;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const padL = 34;
  const padR = 8;
  const padT = 8;
  const padB = 16;
  const pw = w - padL - padR;
  const ph = h - padT - padB;
  const t0 = actions[0].at;
  const t1 = actions[actions.length - 1].at;
  const span = Math.max(1, t1 - t0);
  const x = (at) => padL + ((at - t0) / span) * pw;
  const y = (pos) => padT + (1 - pos / 100) * ph;
  const step = Math.max(1, Math.ceil(actions.length / 500));
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "9px system-ui";
  ctx.textAlign = "center";
  for (let g = 0; g <= 4; g++) {
    const gx = padL + (g / 4) * pw;
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, padT);
    ctx.lineTo(gx + 0.5, padT + ph);
    ctx.stroke();
    ctx.fillText(`${Math.round((t0 + (g / 4) * span) / 1000)}s`, gx, h - 4);
  }
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.textAlign = "right";
  ctx.fillText("100", padL - 4, padT + 4);
  ctx.fillText("0", padL - 4, padT + ph);
  ctx.beginPath();
  ctx.moveTo(x(actions[0].at), y(actions[0].pos));
  for (let i = step; i < actions.length; i += step) {
    ctx.lineTo(x(actions[i].at), y(actions[i].pos));
  }
  ctx.strokeStyle = "rgba(166,226,46,0.9)";
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

// Panic clears the player.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("stim:kill-all", () => {
    if (player) {
      clearInterval(player.timer);
      player = null;
      renderFunscriptUi();
    }
    if (streaming) {
      streaming = false;
      renderFunscriptUi();
    }
  });
}

if (typeof document !== "undefined") {
  const wire = () => {
    document.getElementById("btn-funscript-import")?.addEventListener("click", () => {
      document.getElementById("input-funscript-import")?.click();
    });
    document.getElementById("input-funscript-import")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const r = await importFunscript(file);
        if (r.ok) {
          log(`Funscript importiert (${r.count} gespeichert).`, "success");
        } else {
          log(`Funscript-Import fehlgeschlagen: ${r.error}`, "error");
        }
        renderFunscriptUi();
      }
      e.target.value = "";
    });

    // Player config controls (speed/invert/range/offset/loop).
    const cfg = loadFsCfg();
    const setSel = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = String(v);
    };
    setSel("fs-speed", cfg.speed);
    const inv = document.getElementById("fs-invert");
    if (inv) inv.checked = !!cfg.invert;
    const loop = document.getElementById("fs-loop");
    if (loop) loop.checked = !!cfg.loop;
    const range = document.getElementById("fs-range");
    if (range) range.value = String(cfg.range);
    const off = document.getElementById("fs-offset");
    if (off) off.value = String(cfg.offsetMs || 0);
    document.getElementById("fs-speed")?.addEventListener("change", (e) => {
      saveFsCfg({ speed: parseFloat(e.target.value) || 1 });
    });
    inv?.addEventListener("change", () => saveFsCfg({ invert: inv.checked }));
    loop?.addEventListener("change", () => saveFsCfg({ loop: loop.checked }));
    range?.addEventListener("input", () => saveFsCfg({ range: parseFloat(range.value) || 1 }));
    off?.addEventListener("change", () => saveFsCfg({ offsetMs: parseInt(off.value, 10) || 0 }));

    // External streaming controls.
    document.getElementById("fs-stream-start")?.addEventListener("click", () => {
      const r = startFunscriptStream();
      if (!r.ok) log(`Funscript-Stream: ${r.error}`, "error");
    });
    document.getElementById("fs-stream-stop")?.addEventListener("click", stopFunscriptStream);

    renderFunscriptUi();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
}
