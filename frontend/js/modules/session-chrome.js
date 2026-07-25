// session-chrome.js — Unified floating session bar when output is active

import { AppState } from "../state.js";
import { getOutputOwner } from "./output-owner.js";
import {
  isAutodriveActive,
  getAutodriveState,
  pauseAutodrive,
  resumeAutodrive,
  stopAutodrive,
} from "./autodrive.js";
import { killAllOutput } from "./safety.js";

let mounted = false;

function ensureChrome() {
  let el = document.getElementById("session-chrome");
  if (el) return el;
  el = document.createElement("div");
  el.id = "session-chrome";
  el.className = "session-chrome";
  el.style.display = "none";
  el.innerHTML = `
    <div class="sc-mode" id="sc-mode">—</div>
    <div class="sc-stats">
      <span>A <strong id="sc-a">0</strong></span>
      <span>B <strong id="sc-b">0</strong></span>
      <span id="sc-extra"></span>
    </div>
    <div class="sc-actions">
      <button type="button" id="sc-fs" class="btn btn-secondary btn-sm" title="Fullscreen">⛶</button>
      <button type="button" id="sc-pause" class="btn btn-secondary btn-sm">Pause</button>
      <button type="button" id="sc-stop" class="btn btn-danger btn-sm">Stop</button>
      <button type="button" id="sc-panic" class="btn btn-danger btn-sm">STOPP</button>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById("sc-panic")?.addEventListener("click", () => killAllOutput());
  document.getElementById("sc-stop")?.addEventListener("click", () => {
    if (isAutodriveActive()) stopAutodrive("chrome");
    else if (AppState.isAudioPlaying) document.getElementById("btn-play-audio")?.click();
    else killAllOutput({ skipCooldown: true });
  });
  document.getElementById("sc-pause")?.addEventListener("click", () => {
    if (isAutodriveActive()) {
      const st = getAutodriveState();
      if (st.phase === "PAUSED") resumeAutodrive();
      else pauseAutodrive();
    } else if (AppState.isAudioPlaying) {
      document.getElementById("btn-play-audio")?.click();
    }
  });
  document.getElementById("sc-fs")?.addEventListener("click", () => {
    if (isAutodriveActive()) {
      document.getElementById("btn-autodrive-fs")?.click();
      document.getElementById("ad-fs-close") || document.getElementById("autodrive-fullscreen");
      const fs = document.getElementById("autodrive-fullscreen");
      if (fs) fs.style.display = "flex";
    } else {
      document.querySelector('.nav-item[data-tab="stim"]')?.click();
    }
  });

  mounted = true;
  return el;
}

export function updateSessionChrome() {
  const el = ensureChrome();
  const owner = getOutputOwner();
  const ad = isAutodriveActive();
  const audio = !!AppState.isAudioPlaying;
  const active =
    ad ||
    audio ||
    (owner && owner !== "none") ||
    (AppState.strengthA || 0) > 0 ||
    (AppState.strengthB || 0) > 0;

  if (!active || !AppState.isConnected) {
    el.style.display = "none";
    return;
  }

  el.style.display = "flex";
  const mode = document.getElementById("sc-mode");
  const extra = document.getElementById("sc-extra");
  if (ad) {
    const st = getAutodriveState();
    if (mode) mode.textContent = `Autodrive · ${st.phaseLabel || st.phase}`;
    if (extra) extra.textContent = st.nextStepHint || "";
  } else if (audio) {
    if (mode) mode.textContent = "STIM Player";
    if (extra) extra.textContent = AppState.audioElement?.src ? "Audio→Stim" : "";
  } else {
    if (mode) mode.textContent = owner !== "none" ? `Owner: ${owner}` : "Direkt";
    if (extra) extra.textContent = "";
  }
  const a = document.getElementById("sc-a");
  const b = document.getElementById("sc-b");
  if (a) a.textContent = String(AppState.strengthA || 0);
  if (b) b.textContent = String(AppState.strengthB || 0);

  const pauseBtn = document.getElementById("sc-pause");
  if (pauseBtn && ad) {
    const st = getAutodriveState();
    pauseBtn.textContent = st.phase === "PAUSED" ? "Weiter" : "Pause";
  }
}

export function startSessionChromeLoop() {
  ensureChrome();
  if (mounted && !window.__scLoop) {
    window.__scLoop = setInterval(updateSessionChrome, 400);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  startSessionChromeLoop();
});
