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
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const TICK_MS = 50;

/** @type {Array<{id: string, name: string, actions: Array<{at: number, pos: number}>, range: number, inverted: boolean}>} */
let scripts = [];
let player = null; // {id, actions, range, inverted, startedAt, lastIdx, timer}

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
  const elapsed = Date.now() - player.startedAt;
  const { actions } = player;
  // Advance pointer (actions sorted by `at`).
  while (player.lastIdx < actions.length - 2 && actions[player.lastIdx + 1].at <= elapsed) {
    player.lastIdx += 1;
  }
  const a0 = actions[player.lastIdx];
  const a1 = actions[Math.min(player.lastIdx + 1, actions.length - 1)];
  if (elapsed >= actions[actions.length - 1].at) {
    stopFunscript();
    return;
  }
  // Interpolate position between the two surrounding actions.
  const span = Math.max(1, a1.at - a0.at);
  const frac = Math.max(0, Math.min(1, (elapsed - a0.at) / span));
  const pos = a0.pos + (a1.pos - a0.pos) * frac;
  const strength = posToStrength(
    pos,
    player.range,
    player.inverted,
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
    const total = actions[actions.length - 1].at || 1;
    progress.value = Math.min(100, (elapsed / total) * 100);
  }
}

function renderFunscriptUi() {
  const list = document.getElementById("funscript-list");
  if (!list) return;
  const all = loadScripts();
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
}

// Panic clears the player.
window.addEventListener("stim:kill-all", () => {
  if (player) {
    clearInterval(player.timer);
    player = null;
    renderFunscriptUi();
  }
});

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
    renderFunscriptUi();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
}
