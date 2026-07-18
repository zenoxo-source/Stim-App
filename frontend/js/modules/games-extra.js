// games-extra.js - Hold the Edge, Hot Potato, Survival + shared game helpers

/**
 * V3 needs channel strength > 0 for wave amps to be felt. Games only set wave amps.
 * Raise strength gently to min if user left sliders at 0.
 */
function ensureGameStrength(minLevel = 40) {
  const min = Math.max(10, Math.min(80, Number(minLevel) || 40));
  const targetA = Math.min(AppState.softLimitA, Math.max(AppState.strengthA || 0, min));
  const targetB = Math.min(AppState.softLimitB, Math.max(AppState.strengthB || 0, min));
  let raised = false;
  if ((AppState.strengthA || 0) < min) {
    if (typeof updateSlidersA === "function") updateSlidersA(targetA);
    else AppState.strengthA = targetA;
    raised = true;
  }
  if ((AppState.strengthB || 0) < min) {
    if (typeof updateSlidersB === "function") updateSlidersB(targetB);
    else AppState.strengthB = targetB;
    raised = true;
  }
  if (raised) {
    if (typeof sendStrengthCommand === "function") {
      sendStrengthCommand(AppState.strengthA, AppState.strengthB);
    }
    log(
      `Spiel-Basisstärke ${min} gesetzt (Soft-Limits: ${AppState.softLimitA}/${AppState.softLimitB}).`,
      "info"
    );
  }
}

function stopAllMiniGames() {
  clearTimeout(AppState.reflexTimeoutId);
  AppState.reflexState = "IDLE";
  if (AppState.rhythmIntervalId) {
    clearInterval(AppState.rhythmIntervalId);
    AppState.rhythmIntervalId = null;
  }
  AppState.rhythmState = "IDLE";
  if (typeof stopEdgeGame === "function") stopEdgeGame();
  if (typeof stopPotatoGame === "function") stopPotatoGame();
  if (typeof stopSurvivalGame === "function") stopSurvivalGame(false);
}

function hideGameSelectors() {
  stopAllMiniGames();
  if (DOM["game-selectors"]) DOM["game-selectors"].style.display = "none";
  ["arena-reflex", "arena-rhythm", "arena-edge", "arena-potato", "arena-survival"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

function showGameSelectors() {
  ["arena-reflex", "arena-rhythm", "arena-edge", "arena-potato", "arena-survival"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  if (DOM["game-selectors"]) DOM["game-selectors"].style.display = "grid";
}

function requireConnectedForGame() {
  if (!AppState.isConnected) {
    log("Fehler: Gerät nicht verbunden – Spiele brauchen Hardware-Feedback.", "error");
    return false;
  }
  return true;
}

function beginMiniGame(arenaId) {
  if (!requireConnectedForGame()) return false;
  hideGameSelectors();
  ensureGameStrength(40);
  const arena = document.getElementById(arenaId);
  if (arena) arena.style.display = "flex";
  if (typeof trackStat === "function") trackStat("gamesStarted");
  return true;
}

function gameShock(amp, ms = 280) {
  ensureGameStrength(35);
  const a = Math.min(100, Math.max(10, Math.round(amp)));
  sendWaveformCommand(60, a, 60, a);
  setTimeout(() => {
    sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  }, ms);
}

function gameTickle(amp = 12, ms = 100) {
  ensureGameStrength(25);
  sendWaveformCommand(120, amp, 120, amp);
  setTimeout(() => {
    sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  }, ms);
}

// ========== HOLD THE EDGE ==========

function stopEdgeGame() {
  if (AppState.edgeRaf) {
    cancelAnimationFrame(AppState.edgeRaf);
    AppState.edgeRaf = null;
  }
  AppState.edgeState = "IDLE";
  AppState.edgeHolding = false;
  sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  if (typeof updateOutputStatus === "function") updateOutputStatus();
}

function startEdgeRound() {
  ensureGameStrength(35);
  AppState.edgeState = "RUNNING";
  AppState.edgeHolding = false;
  AppState.edgeLevel = 0;
  AppState.edgeScore = AppState.edgeScore || 0;
  AppState.edgeZoneMin = 55 + Math.random() * 15;
  AppState.edgeZoneMax = AppState.edgeZoneMin + 12 + Math.random() * 8;
  AppState.edgeLastTick = performance.now();
  AppState.edgeInZoneMs = 0;
  updateEdgeUI();
  edgeLoop();
  log("Hold the Edge: Halte die Intensität in der grünen Zone!", "info");
}

function edgeLoop() {
  if (AppState.edgeState !== "RUNNING") return;
  const now = performance.now();
  const dt = Math.min(50, now - (AppState.edgeLastTick || now));
  AppState.edgeLastTick = now;

  if (AppState.edgeHolding) {
    AppState.edgeLevel = Math.min(100, AppState.edgeLevel + dt * 0.035);
  } else {
    AppState.edgeLevel = Math.max(0, AppState.edgeLevel - dt * 0.05);
  }

  const lvl = AppState.edgeLevel;
  const inZone = lvl >= AppState.edgeZoneMin && lvl <= AppState.edgeZoneMax;

  // Output proportional to level (capped by soft limits via wave amp)
  const amp = Math.round((lvl / 100) * 55);
  if (amp > 2) {
    sendWaveformCommand(50, amp, 50, Math.round(amp * 0.85));
  } else {
    sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  }

  if (inZone) {
    AppState.edgeInZoneMs += dt;
    if (AppState.edgeInZoneMs >= 80) {
      AppState.edgeScore += 1;
      AppState.edgeInZoneMs = 0;
    }
  }

  // Blow past the edge
  if (lvl > AppState.edgeZoneMax + 8) {
    AppState.edgeState = "FAIL";
    gameShock(Math.min(70, 25 + AppState.edgeScore / 10), 400);
    if (typeof playGameSfx === "function") playGameSfx("fail");
    const res = recordHighscore("edge", AppState.edgeScore);
    if (DOM["edge-feedback"]) {
      DOM["edge-feedback"].textContent = res.isNew
        ? `Über der Kante! Score ${AppState.edgeScore} – NEUER HIGHSCORE!`
        : `Über der Kante! Score ${AppState.edgeScore} (Best: ${res.best})`;
      DOM["edge-feedback"].style.color = "#a80000";
    }
    if (typeof unlockAchievement === "function") {
      if (AppState.edgeScore >= 50) unlockAchievement("edge_50");
      if (res.isNew) unlockAchievement("first_hs");
    }
    stopEdgeGame();
    AppState.edgeState = "IDLE";
    if (typeof refreshHighscoreUI === "function") refreshHighscoreUI();
    updateEdgeUI();
    return;
  }

  updateEdgeUI();
  AppState.edgeRaf = requestAnimationFrame(edgeLoop);
}

function updateEdgeUI() {
  const fill = document.getElementById("edge-fill");
  const zone = document.getElementById("edge-zone");
  const scoreEl = document.getElementById("edge-score");
  const lvlEl = document.getElementById("edge-level-text");
  if (fill) fill.style.height = `${AppState.edgeLevel || 0}%`;
  if (zone) {
    zone.style.bottom = `${AppState.edgeZoneMin || 60}%`;
    zone.style.height = `${Math.max(4, (AppState.edgeZoneMax || 75) - (AppState.edgeZoneMin || 60))}%`;
  }
  if (scoreEl) scoreEl.textContent = String(AppState.edgeScore || 0);
  if (lvlEl) lvlEl.textContent = `${Math.round(AppState.edgeLevel || 0)}%`;
  const meter = document.getElementById("edge-meter");
  if (meter) {
    const lvl = AppState.edgeLevel || 0;
    const inZone = lvl >= (AppState.edgeZoneMin || 0) && lvl <= (AppState.edgeZoneMax || 100);
    meter.classList.toggle("in-zone", inZone);
    meter.classList.toggle("danger", lvl > (AppState.edgeZoneMax || 100));
  }
}

// ========== HOT POTATO ==========

function stopPotatoGame() {
  if (AppState.potatoTimeout) {
    clearTimeout(AppState.potatoTimeout);
    AppState.potatoTimeout = null;
  }
  if (AppState.potatoTick) {
    clearInterval(AppState.potatoTick);
    AppState.potatoTick = null;
  }
  AppState.potatoState = "IDLE";
  sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  if (typeof updateOutputStatus === "function") updateOutputStatus();
}

function startPotatoRound() {
  AppState.potatoState = "LIVE";
  AppState.potatoScore = AppState.potatoScore || 0;
  AppState.potatoRound = (AppState.potatoRound || 0) + 1;
  const base = Math.max(900, 2800 - AppState.potatoRound * 120);
  AppState.potatoDeadline = performance.now() + base + Math.random() * 800;
  AppState.potatoChannel = Math.random() < 0.5 ? "A" : "B";
  const hint = document.getElementById("potato-channel");
  if (hint) {
    hint.textContent = AppState.potatoChannel;
    hint.className = "potato-channel ch-" + AppState.potatoChannel.toLowerCase();
  }
  if (DOM["potato-feedback"]) {
    DOM["potato-feedback"].textContent =
      `Kanal ${AppState.potatoChannel} – drücke ${AppState.potatoChannel === "A" ? "A / ←" : "B / →"}!`;
    DOM["potato-feedback"].style.color = "#5ab3ff";
  }
  // Gentle pulse while waiting
  AppState.potatoTick = setInterval(() => {
    if (AppState.potatoState !== "LIVE") return;
    const left = AppState.potatoDeadline - performance.now();
    if (left <= 0) {
      potatoExplode();
      return;
    }
    const urgency = 1 - left / 3000;
    const amp = Math.round(10 + urgency * 25);
    if (AppState.potatoChannel === "A") sendWaveformCommand(70, amp, 70, 0);
    else sendWaveformCommand(70, 0, 70, amp);
    const bar = document.getElementById("potato-timer-bar");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (left / 3500) * 100))}%`;
  }, 80);
  log(`Hot Potato Runde ${AppState.potatoRound}: Kanal ${AppState.potatoChannel}`, "info");
}

function potatoPass() {
  if (AppState.potatoState !== "LIVE") return;
  AppState.potatoScore += 1;
  gameTickle(18, 90);
  if (typeof playGameSfx === "function") playGameSfx("hit");
  if (AppState.potatoTick) {
    clearInterval(AppState.potatoTick);
    AppState.potatoTick = null;
  }
  if (DOM["potato-score"]) DOM["potato-score"].textContent = String(AppState.potatoScore);
  if (DOM["potato-feedback"]) {
    DOM["potato-feedback"].textContent = "Weitergegeben!";
    DOM["potato-feedback"].style.color = "#107c41";
  }
  if (typeof unlockAchievement === "function" && AppState.potatoScore >= 15) {
    unlockAchievement("potato_15");
  }
  AppState.potatoTimeout = setTimeout(() => {
    if (AppState.potatoState === "LIVE" || AppState.potatoState === "IDLE") {
      AppState.potatoState = "LIVE";
      startPotatoRound();
    }
  }, 450);
}

function potatoExplode() {
  if (AppState.potatoState !== "LIVE") return;
  AppState.potatoState = "BOOM";
  if (AppState.potatoTick) {
    clearInterval(AppState.potatoTick);
    AppState.potatoTick = null;
  }
  gameShock(Math.min(80, 30 + AppState.potatoRound * 3), 500);
  if (typeof playGameSfx === "function") playGameSfx("fail");
  const res = recordHighscore("potato", AppState.potatoScore);
  if (DOM["potato-feedback"]) {
    DOM["potato-feedback"].textContent = res.isNew
      ? `Zu spät! Score ${AppState.potatoScore} – HIGHSCORE!`
      : `Zu spät! Score ${AppState.potatoScore} (Best: ${res.best})`;
    DOM["potato-feedback"].style.color = "#a80000";
  }
  if (typeof unlockAchievement === "function" && res.isNew) unlockAchievement("first_hs");
  if (typeof refreshHighscoreUI === "function") refreshHighscoreUI();
  AppState.potatoTimeout = setTimeout(() => {
    AppState.potatoState = "IDLE";
    AppState.potatoScore = 0;
    AppState.potatoRound = 0;
    if (DOM["potato-score"]) DOM["potato-score"].textContent = "0";
    sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  }, 1200);
  log("Hot Potato: Explosion!", "warning");
}

function handlePotatoKey(channel) {
  if (AppState.potatoState !== "LIVE") return;
  if (channel === AppState.potatoChannel) potatoPass();
  else {
    // Wrong channel = mild shock, continue
    gameShock(35, 200);
    if (typeof playGameSfx === "function") playGameSfx("fail");
    if (DOM["potato-feedback"]) {
      DOM["potato-feedback"].textContent = "Falscher Kanal!";
      DOM["potato-feedback"].style.color = "#fd971f";
    }
  }
}

// ========== SURVIVAL ==========

function stopSurvivalGame(record = false) {
  if (AppState.survivalRaf) {
    cancelAnimationFrame(AppState.survivalRaf);
    AppState.survivalRaf = null;
  }
  const wasRunning = AppState.survivalState === "RUNNING";
  AppState.survivalState = "IDLE";
  sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  if (record && wasRunning) {
    const res = recordHighscore("survival", AppState.survivalScore);
    if (DOM["survival-feedback"]) {
      DOM["survival-feedback"].textContent = res.isNew
        ? `Ende! ${AppState.survivalScore}s – HIGHSCORE!`
        : `Ende! ${AppState.survivalScore}s (Best: ${res.best}s)`;
      DOM["survival-feedback"].style.color = res.isNew ? "#107c41" : "#fd971f";
    }
    if (typeof playGameSfx === "function") playGameSfx(res.isNew ? "win" : "hit");
    if (typeof unlockAchievement === "function") {
      if (AppState.survivalScore >= 30) unlockAchievement("survive_30");
      if (res.isNew) unlockAchievement("first_hs");
    }
    if (typeof refreshHighscoreUI === "function") refreshHighscoreUI();
  }
  if (typeof updateOutputStatus === "function") updateOutputStatus();
}

function survivalLoop() {
  if (AppState.survivalState !== "RUNNING") return;
  const now = performance.now();
  AppState.survivalLastTick = now;

  const elapsed = (now - AppState.survivalStartedAt) / 1000;
  AppState.survivalScore = Math.floor(elapsed);
  // Ramp 8 → ~70 over ~45s, soft-capped
  AppState.survivalLevel = Math.min(70, 8 + elapsed * 1.35 + Math.sin(elapsed * 0.7) * 6);
  const amp = Math.round(AppState.survivalLevel);
  const wobble = Math.round(4 + Math.sin(elapsed * 2.2) * 4);
  sendWaveformCommand(
    40 + Math.round(elapsed),
    amp,
    55 + Math.round(elapsed * 0.8),
    amp - 5 + wobble
  );

  if (DOM["survival-score"]) DOM["survival-score"].textContent = `${AppState.survivalScore}s`;
  if (DOM["survival-level"]) DOM["survival-level"].textContent = `${amp}%`;
  const bar = document.getElementById("survival-bar");
  if (bar) bar.style.width = `${Math.min(100, (amp / 70) * 100)}%`;

  AppState.survivalRaf = requestAnimationFrame(survivalLoop);
}

function startSurvivalRound() {
  ensureGameStrength(30);
  AppState.survivalState = "RUNNING";
  AppState.survivalScore = 0;
  AppState.survivalLevel = 8;
  AppState.survivalStartedAt = performance.now();
  AppState.survivalLastTick = performance.now();
  if (DOM["survival-feedback"]) {
    DOM["survival-feedback"].textContent = "Halte durch – Q oder „Aufgeben“ beendet.";
    DOM["survival-feedback"].style.color = "#5ab3ff";
  }
  survivalLoop();
  log("Survival gestartet – Intensität steigt langsam.", "info");
}

document.addEventListener("DOMContentLoaded", () => {
  // Hold the Edge
  document.getElementById("btn-start-edge")?.addEventListener("click", () => {
    if (!beginMiniGame("arena-edge")) return;
    AppState.edgeScore = 0;
    if (DOM["edge-feedback"]) DOM["edge-feedback"].textContent = "Gedrückt halten zum Steigen…";
    startEdgeRound();
  });

  document.getElementById("btn-exit-edge")?.addEventListener("click", () => {
    stopEdgeGame();
    showGameSelectors();
  });

  const edgeHold = document.getElementById("edge-hold-btn");
  if (edgeHold) {
    const down = (e) => {
      e.preventDefault();
      if (AppState.edgeState === "IDLE") startEdgeRound();
      AppState.edgeHolding = true;
    };
    const up = (e) => {
      e.preventDefault();
      AppState.edgeHolding = false;
    };
    edgeHold.addEventListener("mousedown", down);
    edgeHold.addEventListener("mouseup", up);
    edgeHold.addEventListener("mouseleave", up);
    edgeHold.addEventListener("touchstart", down, { passive: false });
    edgeHold.addEventListener("touchend", up);
  }

  // Hot Potato
  document.getElementById("btn-start-potato")?.addEventListener("click", () => {
    if (!beginMiniGame("arena-potato")) return;
    AppState.potatoScore = 0;
    AppState.potatoRound = 0;
    if (DOM["potato-score"]) DOM["potato-score"].textContent = "0";
    startPotatoRound();
  });

  document.getElementById("btn-exit-potato")?.addEventListener("click", () => {
    stopPotatoGame();
    showGameSelectors();
  });

  document.getElementById("btn-potato-a")?.addEventListener("click", () => handlePotatoKey("A"));
  document.getElementById("btn-potato-b")?.addEventListener("click", () => handlePotatoKey("B"));

  // Survival
  document.getElementById("btn-start-survival")?.addEventListener("click", () => {
    if (!beginMiniGame("arena-survival")) return;
    startSurvivalRound();
  });
  document.getElementById("btn-exit-survival")?.addEventListener("click", () => {
    stopSurvivalGame(AppState.survivalState === "RUNNING");
    showGameSelectors();
  });
  document.getElementById("btn-survival-bail")?.addEventListener("click", () => {
    if (AppState.survivalState === "RUNNING") stopSurvivalGame(true);
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    // Edge: Space hold
    const edgeOpen = document.getElementById("arena-edge")?.style.display === "flex";
    if (edgeOpen && e.code === "Space") {
      e.preventDefault();
      if (AppState.edgeState === "IDLE") startEdgeRound();
      AppState.edgeHolding = true;
    }

    // Potato
    if (document.getElementById("arena-potato")?.style.display === "flex") {
      if (e.code === "KeyA" || e.code === "ArrowLeft") {
        e.preventDefault();
        handlePotatoKey("A");
      }
      if (e.code === "KeyB" || e.code === "ArrowRight") {
        e.preventDefault();
        handlePotatoKey("B");
      }
    }

    // Survival bail
    if (
      document.getElementById("arena-survival")?.style.display === "flex" &&
      AppState.survivalState === "RUNNING" &&
      (e.code === "KeyQ" || e.key.toLowerCase() === "q")
    ) {
      e.preventDefault();
      stopSurvivalGame(true);
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" && document.getElementById("arena-edge")?.style.display === "flex") {
      AppState.edgeHolding = false;
    }
  });
});

window.stopEdgeGame = stopEdgeGame;
window.stopPotatoGame = stopPotatoGame;
window.stopSurvivalGame = stopSurvivalGame;
window.stopAllMiniGames = stopAllMiniGames;
window.ensureGameStrength = ensureGameStrength;
window.beginMiniGame = beginMiniGame;
window.showGameSelectors = showGameSelectors;
window.hideGameSelectors = hideGameSelectors;
