// fun.js - SFX, achievements, pattern roulette, chance pulse

const ACHIEVEMENTS_KEY = "stim_app_achievements_v1";

const ACHIEVEMENT_DEFS = {
  first_connect: { title: "Verbunden", desc: "Erstmals mit dem Gerät verbunden" },
  first_hs: { title: "Rekordjäger", desc: "Ersten Highscore geknackt" },
  edge_50: { title: "Kantenläufer", desc: "Hold the Edge: 50+ Punkte" },
  potato_15: { title: "Heiße Kartoffel", desc: "Hot Potato: 15+ Weitergaben" },
  survive_30: { title: "Durchhalter", desc: "Survival: 30+ Sekunden" },
  roulette: { title: "Glücksrad", desc: "Pattern-Roulette gestartet" },
  chance: { title: "Würfelfreund", desc: "Zufallsimpuls ausgelöst" },
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
function playGameSfx(kind) {
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

function showFunToast(title, subtitle) {
  let host = document.getElementById("fun-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "fun-toast-host";
    host.className = "fun-toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "fun-toast";
  el.innerHTML = `<strong>${title}</strong>${subtitle ? `<span>${subtitle}</span>` : ""}`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 350);
  }, 3200);
}

function unlockAchievement(id) {
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

const ROULETTE_PATTERNS = [
  "gentle",
  "rhythm",
  "tease",
  "climax",
  "strobe",
  "random",
  "wave",
  "heartbeat",
  "alternate",
  "escalate",
  "flutter",
  "drift",
  "sawtooth",
  "duet",
];

function startPatternRoulette() {
  if (!AppState.isConnected) {
    log("Roulette braucht eine Verbindung.", "error");
    return;
  }
  if (typeof SESSION_STATE !== "undefined" && SESSION_STATE.activeSession) {
    SESSION_STATE.stop();
  }
  const pick = ROULETTE_PATTERNS[Math.floor(Math.random() * ROULETTE_PATTERNS.length)];
  document.querySelectorAll(".pattern-card").forEach((c) => {
    c.classList.toggle("active", c.getAttribute("data-pattern") === pick);
  });
  AppState.activePattern = pick;
  if (typeof updateAIDashboard === "function") updateAIDashboard();
  playGameSfx("win");
  showFunToast("🎲 Pattern-Roulette", pick);
  unlockAchievement("roulette");
  log(`Roulette: „${pick}“ gestartet.`, "info");
}

function fireChancePulse() {
  if (!AppState.isConnected) {
    log("Zufallsimpuls braucht eine Verbindung.", "error");
    return;
  }
  const roll = 1 + Math.floor(Math.random() * 6);
  const amp = 12 + roll * 10;
  const ms = 180 + roll * 40;
  sendWaveformCommand(30 + roll * 15, amp, 40 + roll * 12, Math.round(amp * 0.9));
  playGameSfx(roll >= 5 ? "win" : "hit");
  showFunToast(`🎲 Würfel: ${roll}`, `Impuls ~${amp} für ${ms} ms`);
  unlockAchievement("chance");
  setTimeout(() => {
    if (
      AppState.edgeState !== "RUNNING" &&
      AppState.potatoState !== "LIVE" &&
      AppState.survivalState !== "RUNNING" &&
      !AppState.activePattern
    ) {
      sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
    }
  }, ms);
  log(`Zufallsimpuls: Würfel ${roll}, Amp ${amp}.`, "info");
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAchievementsUI();
  document.getElementById("btn-pattern-roulette")?.addEventListener("click", startPatternRoulette);
  document.getElementById("btn-chance-pulse")?.addEventListener("click", fireChancePulse);
});

window.playGameSfx = playGameSfx;
window.unlockAchievement = unlockAchievement;
window.showFunToast = showFunToast;
window.startPatternRoulette = startPatternRoulette;
window.fireChancePulse = fireChancePulse;
