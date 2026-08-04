// fun.js - SFX, toasts and achievement helpers (shared UI niceties).
// Pattern roulette, chance pulse, daily challenge and quick play were removed
// with the Play tab (v6.0).

import { log } from "../state.js";

const ACHIEVEMENTS_KEY = "stim_app_achievements_v1";

const ACHIEVEMENT_DEFS = {
  first_connect: { title: "Verbunden", desc: "Erstmals mit dem Gerät verbunden" },
  first_hs: { title: "Rekordjäger", desc: "Ersten Highscore geknackt" },
  // Milestones (unlocked via stim:unlock-achievement events from stats).
  sessions_10: { title: "Zehn in Folge", desc: "10 Sessions abgeschlossen" },
  sessions_50: { title: "Halbes Jahrhundert", desc: "50 Sessions abgeschlossen" },
  sessions_100: { title: "Dreistellig", desc: "100 Sessions abgeschlossen" },
  streak_3: { title: "Drei Tage am Stück", desc: "3 Tage in Folge eine Session" },
  streak_7: { title: "Woche gefüllt", desc: "7 Tage in Folge eine Session" },
  stim_100h: { title: "Strom-Legende", desc: "100 Stunden Stimulation" },
  climax_10: { title: "Zielgenau", desc: "10 Climax-Markierungen" },
};

let sfxCtx = null;

function getSfxCtx() {
  if (!sfxCtx) {
    try {
      sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  return sfxCtx;
}

/**
 * Lightweight UI beeps (no external assets).
 * @param {"hit"|"fail"|"win"|"click"|"unlock"} kind
 */
export function playGameSfx(kind) {
  const ctx = getSfxCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  const map = {
    hit: { f: 520, t: 0.08, type: "sine", vol: 0.08 },
    fail: { f: 140, t: 0.22, type: "square", vol: 0.06 },
    win: { f: 660, t: 0.18, type: "triangle", vol: 0.09 },
    click: { f: 400, t: 0.04, type: "sine", vol: 0.05 },
    unlock: { f: 880, t: 0.25, type: "triangle", vol: 0.08 },
  };
  const p = map[kind] || map.click;
  osc.type = p.type;
  osc.frequency.setValueAtTime(p.f, now);
  if (kind === "win" || kind === "unlock") {
    osc.frequency.exponentialRampToValueAtTime(p.f * 1.5, now + p.t);
  }
  gain.gain.setValueAtTime(p.vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + p.t);
  osc.start(now);
  osc.stop(now + p.t + 0.02);
}

function loadAchievements() {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveAchievements(data) {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(data));
  } catch (e) {
    /* ignore */
  }
}

export function showFunToast(title, subtitle) {
  let host = document.getElementById("fun-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "fun-toast-host";
    host.className = "fun-toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "fun-toast";
  // XSS-safe: never inject unescaped strings into HTML
  const strong = document.createElement("strong");
  strong.textContent = String(title ?? "");
  el.appendChild(strong);
  if (subtitle) {
    const span = document.createElement("span");
    span.textContent = String(subtitle);
    el.appendChild(span);
  }
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 350);
  }, 3200);
}

export function unlockAchievement(id) {
  const def = ACHIEVEMENT_DEFS[id];
  if (!def) return false;
  const all = loadAchievements();
  if (all[id]) return false;
  all[id] = Date.now();
  saveAchievements(all);
  playGameSfx("unlock");
  showFunToast(`🏆 ${def.title}`, def.desc);
  log(`Erfolg freigeschaltet: ${def.title}`, "success");
  refreshAchievementsUI();
  return true;
}

// Milestone achievements are unlocked by the stats layer via events
// (avoids an import cycle stats → fun → sessions → stats).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("stim:unlock-achievement", (e) => {
    try {
      if (e && e.detail && e.detail.id) unlockAchievement(e.detail.id);
    } catch {
      /* ignore */
    }
  });
}

function refreshAchievementsUI() {
  const list = document.getElementById("achievements-list");
  if (!list) return;
  const unlocked = loadAchievements();
  list.innerHTML = "";
  Object.keys(ACHIEVEMENT_DEFS).forEach((id) => {
    const def = ACHIEVEMENT_DEFS[id];
    const item = document.createElement("div");
    item.className = "achievement-item" + (unlocked[id] ? " unlocked" : "");
    item.innerHTML = `<span class="achievement-icon">${unlocked[id] ? "✓" : "○"}</span>
      <div><div class="achievement-title">${def.title}</div>
      <div class="achievement-desc">${def.desc}</div></div>`;
    list.appendChild(item);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAchievementsUI();
});
