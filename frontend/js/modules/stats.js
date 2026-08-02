// stats.js - Usage statistics dashboard
import { AppState, log } from "../state.js";
import { escapeHtml } from "../lib/protocol-utils.js";

const STATS_DASHBOARD_KEY = "stim_app_stats_v2";
const BATTERY_HISTORY_KEY = "stim_app_battery_history_v1";
/** Ring buffer size for battery samples (240 ≈ 4h at 1/min polling). */
const MAX_BATTERY_SAMPLES = 240;

const defaultStats = {
  totalPlayTimeSec: 0,
  sessionsCompleted: 0,
  patternsUsed: {},
  maxStrengthA: 0,
  maxStrengthB: 0,
  connectionsTotal: 0,
  gamesPlayed: {},
  recordingsCreated: 0,
  remoteCommands: 0,
  firstUsed: null,
  lastUsed: null,
};

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_DASHBOARD_KEY);
    if (!raw) return { ...defaultStats, firstUsed: new Date().toISOString() };
    return { ...defaultStats, ...JSON.parse(raw) };
  } catch {
    return { ...defaultStats };
  }
}

function saveStats(stats) {
  try {
    stats.lastUsed = new Date().toISOString();
    localStorage.setItem(STATS_DASHBOARD_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

export function trackStat(key, value) {
  const stats = loadStats();
  if (key === "pattern_used") {
    stats.patternsUsed[value] = (stats.patternsUsed[value] || 0) + 1;
  } else if (key === "game_played") {
    stats.gamesPlayed[value] = (stats.gamesPlayed[value] || 0) + 1;
  } else if (key === "max_strength_a") {
    stats.maxStrengthA = Math.max(stats.maxStrengthA, value);
  } else if (key === "max_strength_b") {
    stats.maxStrengthB = Math.max(stats.maxStrengthB, value);
  } else if (key === "connection") {
    stats.connectionsTotal += 1;
  } else if (key === "session_completed") {
    stats.sessionsCompleted += 1;
    // F4: per-day session counts for the weekly overview.
    if (!stats.days || typeof stats.days !== "object") stats.days = {};
    const day = new Date().toISOString().slice(0, 10);
    stats.days[day] = (stats.days[day] || 0) + 1;
  } else if (key === "recording_created") {
    stats.recordingsCreated += 1;
  } else if (key === "remote_command") {
    stats.remoteCommands += 1;
  } else if (key === "play_time") {
    stats.totalPlayTimeSec += value;
  } else if (typeof key === "string" && key.startsWith("autodrive_")) {
    // Counters for Autodrive analytics (starts/stops/success/debrief/feedback)
    if (!stats.autodrive) stats.autodrive = {};
    stats.autodrive[key] = (stats.autodrive[key] || 0) + 1;
  }
  saveStats(stats);
}

function formatDuration(sec) {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function topEntries(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Battery history (F4): samples recorded by bluetooth.js battery polling.
// ---------------------------------------------------------------------------

function loadBatteryHistory() {
  try {
    const raw = localStorage.getItem(BATTERY_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Record one battery sample. Called from the BLE battery poller.
 * @param {number} level 0–100
 */
export function recordBatterySample(level) {
  const lvl = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
  const arr = loadBatteryHistory();
  arr.push({ t: Date.now(), level: lvl });
  if (arr.length > MAX_BATTERY_SAMPLES) arr.splice(0, arr.length - MAX_BATTERY_SAMPLES);
  try {
    localStorage.setItem(BATTERY_HISTORY_KEY, JSON.stringify(arr));
  } catch {
    /* quota — drop oldest instead of failing */
    try {
      localStorage.setItem(BATTERY_HISTORY_KEY, JSON.stringify(arr.slice(-100)));
    } catch {
      /* ignore */
    }
  }
}

/** @returns {{ current: number, min: number, max: number, avg: number, bars: number[] }} */
function batterySummary() {
  const arr = loadBatteryHistory();
  const levels = arr.map((s) => s.level);
  if (levels.length === 0) {
    return { current: AppState.batteryLevel || 0, min: 0, max: 0, avg: 0, bars: [] };
  }
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const avg = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
  // Last 12 samples as bars (oldest → newest).
  const bars = levels.slice(-12);
  return { current: levels[levels.length - 1], min, max, avg, bars };
}

export function renderStats() {
  const stats = loadStats();
  const container = document.getElementById("stats-content");
  if (!container) return;

  const topPatterns = topEntries(stats.patternsUsed, 5);
  const topGames = topEntries(stats.gamesPlayed, 5);
  const batt = batterySummary();
  const battBars = batt.bars.length
    ? batt.bars
        .map((lvl) => {
          const pct = Math.max(0, Math.min(100, lvl));
          const color = pct <= 20 ? "#f92672" : pct <= 50 ? "#fd971f" : "#a6e22e";
          return `<span class="batt-bar" style="height:${Math.max(4, Math.round(pct / 2))}px;background:${color};" title="${pct}%"></span>`;
        })
        .join("")
    : `<span style="font-size:11px;opacity:0.5;">Noch keine Daten – beim nächsten Verbinden wird gemessen.</span>`;
  // F4: last-7-days session overview.
  const days = stats.days || {};
  const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    week.push({
      day: d.toISOString().slice(0, 10),
      label: dayNames[d.getDay()],
      count: days[d.toISOString().slice(0, 10)] || 0,
    });
  }
  const weekMax = Math.max(1, ...week.map((w) => w.count));
  const weekBars = week
    .map(
      (w) =>
        `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;">
          <span style="font-size:10px;opacity:0.7;">${w.count}</span>
          <span class="batt-bar" style="height:${Math.max(4, Math.round((w.count / weekMax) * 48))}px;background:${w.count ? "#5ab3ff" : "rgba(255,255,255,0.12)"};" title="${w.day}: ${w.count}"></span>
          <span style="font-size:9px;opacity:0.5;">${w.label}</span>
        </div>`
    )
    .join("");
  // F5: today's count + current daily streak.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayCount = days[todayKey] || 0;
  let streak = 0;
  const dCursor = new Date();
  if (!days[dCursor.toISOString().slice(0, 10)]) dCursor.setDate(dCursor.getDate() - 1);
  while (days[dCursor.toISOString().slice(0, 10)]) {
    streak++;
    dCursor.setDate(dCursor.getDate() - 1);
  }
  const todayLine = `Heute: <strong>${todayCount}</strong> · Serie: <strong>${streak}</strong> ${streak === 1 ? "Tag" : "Tage"}`;

  const daysActive = stats.firstUsed
    ? Math.max(1, Math.ceil((Date.now() - new Date(stats.firstUsed).getTime()) / 86400000))
    : 0;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${formatDuration(stats.totalPlayTimeSec)}</div>
        <div class="stat-label">Gesamt-Spielzeit</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${daysActive}</div>
        <div class="stat-label">Tage aktiv</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.connectionsTotal}</div>
        <div class="stat-label">Verbindungen</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.sessionsCompleted}</div>
        <div class="stat-label">Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.maxStrengthA}</div>
        <div class="stat-label">Max Strength A</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.maxStrengthB}</div>
        <div class="stat-label">Max Strength B</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.recordingsCreated}</div>
        <div class="stat-label">Aufnahmen</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.remoteCommands}</div>
        <div class="stat-label">Remote-Befehle</div>
      </div>
    </div>
    <div class="stats-lists">
      <div class="stat-list">
        <h4>Top Patterns</h4>
        ${
          topPatterns.length > 0
            ? topPatterns
                .map(
                  ([name, count]) =>
                    `<div class="stat-list-row"><span>${escapeHtml(name)}</span><span>${count}×</span></div>`
                )
                .join("")
            : "<p>Noch keine Patterns verwendet.</p>"
        }
      </div>
      <div class="stat-list">
        <h4>Top Spiele</h4>
        ${
          topGames.length > 0
            ? topGames
                .map(
                  ([name, count]) =>
                    `<div class="stat-list-row"><span>${escapeHtml(name)}</span><span>${count}×</span></div>`
                )
                .join("")
            : "<p>Noch keine Spiele gespielt.</p>"
        }
      </div>
    </div>
    <div class="stats-lists">
      <div class="stat-list">
        <h4>Batterie</h4>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px;">
          <div><span class="stat-value">${batt.current}%</span><div class="stat-label">Aktuell</div></div>
          <div><span class="stat-value">${batt.min}%</span><div class="stat-label">Min</div></div>
          <div><span class="stat-value">${batt.avg}%</span><div class="stat-label">Ø</div></div>
          <div><span class="stat-value">${batt.max}%</span><div class="stat-label">Max</div></div>
        </div>
        <div class="batt-bars" style="display:flex;align-items:flex-end;gap:3px;height:56px;">${battBars}</div>
      </div>
      <div class="stat-list">
        <h4>Letzte 7 Tage (Sessions)</h4>
        <div style="font-size:12px;margin-bottom:6px;">${todayLine}</div>
        <div class="batt-bars" style="display:flex;align-items:flex-end;gap:4px;height:56px;">${weekBars}</div>
      </div>
    </div>
  `;
}

function resetStats() {
  localStorage.removeItem(STATS_DASHBOARD_KEY);
  localStorage.removeItem(BATTERY_HISTORY_KEY);
  renderStats();
  log("Statistik zurückgesetzt.", "info");
}

document.addEventListener("DOMContentLoaded", () => {
  // Render when settings tab is opened
  document.querySelector('.nav-item[data-tab="settings"]')?.addEventListener("click", () => {
    setTimeout(renderStats, 100);
  });

  document.getElementById("btn-reset-stats")?.addEventListener("click", () => {
    if (confirm("Alle Statistiken wirklich zurücksetzen?")) {
      resetStats();
    }
  });

  // Track play time every minute
  setInterval(() => {
    if (
      AppState.isConnected &&
      (AppState.activePattern ||
        AppState.isAudioPlaying ||
        AppState.strengthA > 0 ||
        AppState.strengthB > 0)
    ) {
      trackStat("play_time", 60);
    }
  }, 60000);

  // Track max strength when it changes
  let lastStrA = 0;
  let lastStrB = 0;
  setInterval(() => {
    if (AppState.strengthA > lastStrA) {
      trackStat("max_strength_a", AppState.strengthA);
      lastStrA = AppState.strengthA;
    }
    if (AppState.strengthB > lastStrB) {
      trackStat("max_strength_b", AppState.strengthB);
      lastStrB = AppState.strengthB;
    }
  }, 2000);
});
