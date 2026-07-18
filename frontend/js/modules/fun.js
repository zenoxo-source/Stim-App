// fun.js - SFX, achievements, pattern roulette, chance pulse, daily challenge

const ACHIEVEMENTS_KEY = "stim_app_achievements_v1";
const DAILY_KEY = "stim_app_daily_v1";
const STATS_KEY = "stim_app_stats_v1";

const ACHIEVEMENT_DEFS = {
  first_connect: { title: "Verbunden", desc: "Erstmals mit dem Gerät verbunden" },
  first_hs: { title: "Rekordjäger", desc: "Ersten Highscore geknackt" },
  edge_50: { title: "Kantenläufer", desc: "Hold the Edge: 50+ Punkte" },
  potato_15: { title: "Heiße Kartoffel", desc: "Hot Potato: 15+ Weitergaben" },
  survive_30: { title: "Durchhalter", desc: "Survival: 30+ Sekunden" },
  roulette: { title: "Glücksrad", desc: "Pattern-Roulette gestartet" },
  chance: { title: "Würfelfreund", desc: "Zufallsimpuls ausgelöst" },
  daily: { title: "Tagesheld", desc: "Tages-Challenge geschafft" },
  quick_play: { title: "Überraschungsgast", desc: "Quick Play gestartet" },
  ten_games: { title: "Spielwütig", desc: "10 Spiele gestartet" },
};

const DAILY_POOL = [
  { game: "reflex", label: "Reflex", target: 5, unit: "Level", startBtn: "btn-start-reflex" },
  { game: "rhythm", label: "Rhythm", target: 80, unit: "Punkte", startBtn: "btn-start-rhythm" },
  { game: "edge", label: "Hold the Edge", target: 35, unit: "Punkte", startBtn: "btn-start-edge" },
  {
    game: "potato",
    label: "Hot Potato",
    target: 8,
    unit: "Weitergaben",
    startBtn: "btn-start-potato",
  },
  {
    game: "survival",
    label: "Survival",
    target: 18,
    unit: "Sekunden",
    startBtn: "btn-start-survival",
  },
];

const QUICK_PLAY_BTNS = [
  "btn-start-reflex",
  "btn-start-rhythm",
  "btn-start-edge",
  "btn-start-potato",
  "btn-start-survival",
];

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
  if (typeof ensureGameStrength === "function") ensureGameStrength(45);
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
  if (typeof ensureGameStrength === "function")
    ensureGameStrength(30 + Math.floor(Math.random() * 20));
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
      if (typeof sendSoftStop === "function") sendSoftStop({ keepStrength: true });
      else sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
    }
  }, ms);
  log(`Zufallsimpuls: Würfel ${roll}, Amp ${amp}.`, "info");
}

// ---- Stats ----
function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : { gamesStarted: 0, scoreEvents: 0 };
  } catch (e) {
    return { gamesStarted: 0, scoreEvents: 0 };
  }
}

function saveStats(s) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch (e) {
    /* ignore */
  }
}

function trackStat(kind) {
  const s = loadStats();
  if (kind === "gameStarted") {
    s.gamesStarted = (s.gamesStarted || 0) + 1;
    if (s.gamesStarted >= 10) unlockAchievement("ten_games");
  }
  if (kind === "scoreEvent") s.scoreEvents = (s.scoreEvents || 0) + 1;
  saveStats(s);
  refreshStatsUI();
}

function refreshStatsUI() {
  const el = document.getElementById("stats-summary");
  if (!el) return;
  const s = loadStats();
  el.textContent = `${s.gamesStarted || 0} Spiele gestartet · ${s.scoreEvents || 0} Score-Events`;
}

// ---- Daily challenge ----
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDailyChallenge() {
  const day = todayKey();
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  const base = DAILY_POOL[h % DAILY_POOL.length];
  const bump = h % 5;
  return {
    game: base.game,
    label: base.label,
    target: base.target + bump,
    unit: base.unit,
    startBtn: base.startBtn,
    day,
  };
}

function loadDailyState() {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const challenge = getDailyChallenge();
    if (!parsed || parsed.day !== challenge.day) {
      return { day: challenge.day, best: 0, done: false, game: challenge.game };
    }
    return parsed;
  } catch (e) {
    const c = getDailyChallenge();
    return { day: c.day, best: 0, done: false, game: c.game };
  }
}

function saveDailyState(state) {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore */
  }
}

function noteDailyProgress(gameId, score) {
  const challenge = getDailyChallenge();
  if (gameId !== challenge.game) return;
  const state = loadDailyState();
  const n = Number(score) || 0;
  if (n > (state.best || 0)) state.best = n;
  if (!state.done && n >= challenge.target) {
    state.done = true;
    unlockAchievement("daily");
    playGameSfx("win");
    showFunToast("📅 Tages-Challenge!", `${challenge.label}: ${n} / ${challenge.target}`);
    log(`Tages-Challenge geschafft: ${challenge.label} (${n}).`, "success");
  }
  saveDailyState(state);
  refreshDailyUI();
}

function refreshDailyUI() {
  const challenge = getDailyChallenge();
  const state = loadDailyState();
  const title = document.getElementById("daily-title");
  const progress = document.getElementById("daily-progress");
  const card = document.getElementById("daily-challenge-card");
  if (title) {
    title.textContent = `${challenge.label}: ${challenge.target} ${challenge.unit}`;
  }
  if (progress) {
    const best = state.best || 0;
    progress.textContent = state.done
      ? `Erledigt ✓ (${best})`
      : `Fortschritt: ${best} / ${challenge.target}`;
  }
  if (card) card.classList.toggle("done", !!state.done);
}

function startDailyChallenge() {
  const challenge = getDailyChallenge();
  const btn = document.getElementById(challenge.startBtn);
  if (btn) {
    document.querySelector('.nav-item[data-tab="games"]')?.click();
    setTimeout(() => btn.click(), 50);
  } else {
    log("Tages-Challenge: Spiel nicht gefunden.", "error");
  }
}

function startQuickPlay() {
  const pick = QUICK_PLAY_BTNS[Math.floor(Math.random() * QUICK_PLAY_BTNS.length)];
  const btn = document.getElementById(pick);
  if (!btn) return;
  unlockAchievement("quick_play");
  playGameSfx("click");
  showFunToast("⚡ Quick Play", pick.replace("btn-start-", ""));
  document.querySelector('.nav-item[data-tab="games"]')?.click();
  setTimeout(() => btn.click(), 50);
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAchievementsUI();
  refreshDailyUI();
  refreshStatsUI();
  document.getElementById("btn-pattern-roulette")?.addEventListener("click", () => {
    if (typeof ensureGameStrength === "function") ensureGameStrength(45);
    startPatternRoulette();
  });
  document.getElementById("btn-chance-pulse")?.addEventListener("click", fireChancePulse);
  document.getElementById("btn-daily-start")?.addEventListener("click", startDailyChallenge);
  document.getElementById("btn-quick-play")?.addEventListener("click", startQuickPlay);
});

window.playGameSfx = playGameSfx;
window.unlockAchievement = unlockAchievement;
window.showFunToast = showFunToast;
window.startPatternRoulette = startPatternRoulette;
window.fireChancePulse = fireChancePulse;
window.noteDailyProgress = noteDailyProgress;
window.trackStat = trackStat;
window.startDailyChallenge = startDailyChallenge;
window.startQuickPlay = startQuickPlay;
