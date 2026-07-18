// stats.js - Usage statistics dashboard

const STATS_DASHBOARD_KEY = "stim_app_stats_v2";

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

function trackStat(key, value) {
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
  } else if (key === "recording_created") {
    stats.recordingsCreated += 1;
  } else if (key === "remote_command") {
    stats.remoteCommands += 1;
  } else if (key === "play_time") {
    stats.totalPlayTimeSec += value;
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

function renderStats() {
  const stats = loadStats();
  const container = document.getElementById("stats-content");
  if (!container) return;

  const topPatterns = topEntries(stats.patternsUsed, 5);
  const topGames = topEntries(stats.gamesPlayed, 5);

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
                    `<div class="stat-list-row"><span>${name}</span><span>${count}×</span></div>`
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
                    `<div class="stat-list-row"><span>${name}</span><span>${count}×</span></div>`
                )
                .join("")
            : "<p>Noch keine Spiele gespielt.</p>"
        }
      </div>
    </div>
  `;
}

function resetStats() {
  localStorage.removeItem(STATS_DASHBOARD_KEY);
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

window.trackStat = trackStat;
window.renderStats = renderStats;
