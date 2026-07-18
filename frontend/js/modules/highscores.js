// highscores.js - local high scores for mini-gameses

const HIGHSCORE_KEY = "stim_app_highscores_v1";

function loadHighscores() {
  try {
    const raw = localStorage.getItem(HIGHSCORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveHighscores(data) {
  try {
    localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("highscore save failed", e);
  }
}

/**
 * @returns {{ isNew: boolean, best: number }}
 */
function recordHighscore(gameId, score) {
  const all = loadHighscores();
  const prev = Number(all[gameId] || 0);
  const n = Number(score) || 0;
  if (n > prev) {
    all[gameId] = n;
    saveHighscores(all);
    return { isNew: true, best: n };
  }
  return { isNew: false, best: prev };
}

function getHighscore(gameId) {
  const all = loadHighscores();
  return Number(all[gameId] || 0);
}

function refreshHighscoreUI() {
  const map = {
    "hs-reflex": "reflex",
    "hs-rhythm": "rhythm",
    "hs-edge": "edge",
    "hs-potato": "potato",
  };
  Object.keys(map).forEach((elId) => {
    const el = document.getElementById(elId);
    if (el) el.textContent = String(getHighscore(map[elId]));
  });
}

window.recordHighscore = recordHighscore;
window.getHighscore = getHighscore;
window.refreshHighscoreUI = refreshHighscoreUI;

document.addEventListener("DOMContentLoaded", () => {
  refreshHighscoreUI();
});
