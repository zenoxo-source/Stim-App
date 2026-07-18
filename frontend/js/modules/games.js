// games.js - Reflex Trainer and Rhythm Pulse Tapper for DG-LAB Coyote 3.0

function gameWaveOff() {
  if (typeof sendSoftStop === "function") sendSoftStop({ keepStrength: true });
  else sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
}

// ========== REFLEX TRAINER ==========

document.addEventListener("DOMContentLoaded", () => {
  DOM["btn-start-reflex"]?.addEventListener("click", () => {
    if (typeof beginMiniGame === "function") {
      if (!beginMiniGame("arena-reflex")) return;
    } else if (!AppState.isConnected) {
      log("Fehler: DG-LAB Controller ist nicht verbunden.", "error");
      return;
    } else {
      if (DOM["game-selectors"]) DOM["game-selectors"].style.display = "none";
      if (DOM["arena-reflex"]) DOM["arena-reflex"].style.display = "flex";
    }

    AppState.reflexLevel = 1;
    AppState.reflexTargetTime = 450;
    AppState.reflexShockVal = 30;
    AppState.reflexScore = 0;
    AppState.reflexState = "IDLE";

    if (DOM["reflex-level"]) DOM["reflex-level"].textContent = AppState.reflexLevel;
    if (DOM["reflex-target"]) DOM["reflex-target"].textContent = `${AppState.reflexTargetTime} ms`;
    if (DOM["reflex-shock"]) DOM["reflex-shock"].textContent = AppState.reflexShockVal;
    if (DOM["reflex-time"]) DOM["reflex-time"].textContent = "-- ms";
    if (DOM["reflex-feedback-message"]) DOM["reflex-feedback-message"].textContent = "";

    resetReflexBox();
  });

  DOM["btn-exit-reflex"]?.addEventListener("click", () => {
    clearTimeout(AppState.reflexTimeoutId);
    AppState.reflexState = "IDLE";
    gameWaveOff();

    if (typeof showGameSelectors === "function") showGameSelectors();
    else {
      if (DOM["arena-reflex"]) DOM["arena-reflex"].style.display = "none";
      if (DOM["game-selectors"]) DOM["game-selectors"].style.display = "grid";
    }
  });

  DOM["reflex-tap-box"]?.addEventListener("click", () => {
    if (AppState.reflexState === "IDLE") {
      startReflexWaiting();
    } else if (AppState.reflexState === "WAITING") {
      triggerReflexFalseStart();
    } else if (AppState.reflexState === "TRIGGERED") {
      triggerReflexSuccess();
    }
  });
});

function resetReflexBox() {
  if (DOM["reflex-tap-box"]) DOM["reflex-tap-box"].className = "reflex-box";
  if (DOM["reflex-text"]) DOM["reflex-text"].textContent = "Klicke dieses Feld zum Starten";
  if (DOM["reflex-subtext"])
    DOM["reflex-subtext"].textContent = `Ziel: Reaktionszeit unter ${AppState.reflexTargetTime} ms`;
}

function startReflexWaiting() {
  AppState.reflexState = "WAITING";
  if (DOM["reflex-tap-box"]) DOM["reflex-tap-box"].className = "reflex-box ready";
  if (DOM["reflex-text"]) DOM["reflex-text"].textContent = "BEREIT MACHEN...";
  if (DOM["reflex-subtext"])
    DOM["reflex-subtext"].textContent = "Klicke sofort, sobald das Feld GR\u00dcN wird!";
  if (DOM["reflex-feedback-message"]) DOM["reflex-feedback-message"].textContent = "";

  const randomDelay = 2000 + Math.random() * 3000;

  AppState.reflexTimeoutId = setTimeout(() => {
    triggerReflexGreen();
  }, randomDelay);
}

function triggerReflexGreen() {
  AppState.reflexState = "TRIGGERED";
  if (DOM["reflex-tap-box"]) DOM["reflex-tap-box"].className = "reflex-box trigger";
  if (DOM["reflex-text"]) DOM["reflex-text"].textContent = "JETZT KLICKEN!";
  if (DOM["reflex-subtext"]) DOM["reflex-subtext"].textContent = "Tappe so schnell du kannst!";
  AppState.reflexStartTime = performance.now();

  AppState.reflexTimeoutId = setTimeout(() => {
    if (AppState.reflexState === "TRIGGERED") {
      triggerReflexTooSlow();
    }
  }, AppState.reflexTargetTime);
}

function triggerReflexSuccess() {
  clearTimeout(AppState.reflexTimeoutId);
  const reactionTime = Math.round(performance.now() - AppState.reflexStartTime);

  AppState.reflexState = "IDLE";
  if (DOM["reflex-time"]) DOM["reflex-time"].textContent = `${reactionTime} ms`;
  if (DOM["reflex-feedback-message"]) {
    DOM["reflex-feedback-message"].textContent =
      `Hervorragend! ${reactionTime} ms erfasst. Level-Up!`;
    DOM["reflex-feedback-message"].style.color = "#107c41";
  }

  AppState.reflexLevel += 1;
  AppState.reflexTargetTime = Math.max(
    CONSTANTS.MIN_REFLEX_TARGET_MS,
    AppState.reflexTargetTime - 25
  );
  AppState.reflexShockVal = Math.min(CONSTANTS.MAX_REFLEX_SHOCK, AppState.reflexShockVal + 5);

  if (DOM["reflex-level"]) DOM["reflex-level"].textContent = AppState.reflexLevel;
  if (DOM["reflex-target"]) DOM["reflex-target"].textContent = `${AppState.reflexTargetTime} ms`;
  if (DOM["reflex-shock"]) DOM["reflex-shock"].textContent = AppState.reflexShockVal;

  if (DOM["reflex-tap-box"]) DOM["reflex-tap-box"].className = "reflex-box";
  if (DOM["reflex-text"]) DOM["reflex-text"].textContent = "BESTANDEN!";
  if (DOM["reflex-subtext"])
    DOM["reflex-subtext"].textContent = "Klicke das Feld f\u00fcr das n\u00e4chste Level";

  log(`Reflex Level ${AppState.reflexLevel - 1} bestanden: ${reactionTime} ms`, "success");
  if (typeof playGameSfx === "function") playGameSfx("hit");
  const hs = recordHighscore("reflex", AppState.reflexLevel - 1);
  if (hs.isNew && DOM["reflex-feedback-message"]) {
    DOM["reflex-feedback-message"].textContent += " · Highscore!";
  }
  if (hs.isNew && typeof unlockAchievement === "function") unlockAchievement("first_hs");
  if (typeof refreshHighscoreUI === "function") refreshHighscoreUI();
}

function triggerReflexFalseStart() {
  clearTimeout(AppState.reflexTimeoutId);
  AppState.reflexState = "SHOCKING";

  if (DOM["reflex-feedback-message"]) {
    DOM["reflex-feedback-message"].textContent =
      "FEHLSTART! Zu fr\u00fch geklickt. Strafe ausgel\u00f6st!";
    DOM["reflex-feedback-message"].style.color = "#d83b01";
  }
  if (DOM["reflex-tap-box"]) DOM["reflex-tap-box"].className = "reflex-box ready";
  if (DOM["reflex-text"]) DOM["reflex-text"].textContent = "\u26a0\ufe0f FEHLSTART";
  if (DOM["reflex-subtext"]) DOM["reflex-subtext"].textContent = "Sp\u00fcre die Warnung...";

  log("Reflex Trainer: Fehlstart! Strafe gesendet.", "warning");
  if (typeof playGameSfx === "function") playGameSfx("fail");

  setTimeout(() => {
    AppState.reflexState = "IDLE";
    gameWaveOff();
    resetReflexBox();
  }, CONSTANTS.REFLEX_PENALTY_MS);
}

function triggerReflexTooSlow() {
  AppState.reflexState = "SHOCKING";

  if (DOM["reflex-feedback-message"]) {
    DOM["reflex-feedback-message"].textContent =
      "ZU LANGSAM! Zeitfenster \u00fcberschritten. Schock!";
    DOM["reflex-feedback-message"].style.color = "#a80000";
  }
  if (DOM["reflex-tap-box"]) DOM["reflex-tap-box"].className = "reflex-box ready";
  if (DOM["reflex-text"]) DOM["reflex-text"].textContent = "\u26a1 STIMULIERT";
  if (DOM["reflex-subtext"]) DOM["reflex-subtext"].textContent = "Reagiere schneller!";

  log(
    `Reflex Trainer: Zu langsam! ${AppState.reflexTargetTime} ms \u00fcberschritten. Strafe gesendet.`,
    "error"
  );
  if (typeof playGameSfx === "function") playGameSfx("fail");

  setTimeout(() => {
    AppState.reflexState = "IDLE";
    gameWaveOff();
    resetReflexBox();
  }, CONSTANTS.REFLEX_TOO_SLOW_MS);
}

// ========== RHYTHM PULSE TAPPER ==========

document.addEventListener("DOMContentLoaded", () => {
  DOM["btn-start-rhythm"]?.addEventListener("click", () => {
    if (typeof beginMiniGame === "function") {
      if (!beginMiniGame("arena-rhythm")) return;
    } else if (!AppState.isConnected) {
      log("Fehler: DG-LAB Controller ist nicht verbunden.", "error");
      return;
    } else {
      if (DOM["game-selectors"]) DOM["game-selectors"].style.display = "none";
      if (DOM["arena-rhythm"]) DOM["arena-rhythm"].style.display = "flex";
    }

    AppState.rhythmState = "IDLE";
    AppState.rhythmScore = 0;
    AppState.rhythmCombo = 0;
    AppState.rhythmMultiplier = 1;
    AppState.rhythmTempo = 95;
    AppState.rhythmShockVal = 30;

    if (DOM["rhythm-score"]) DOM["rhythm-score"].textContent = AppState.rhythmScore;
    if (DOM["rhythm-combo"])
      DOM["rhythm-combo"].textContent = `${AppState.rhythmCombo} (x${AppState.rhythmMultiplier})`;
    if (DOM["rhythm-tempo"]) DOM["rhythm-tempo"].textContent = `BPM ${AppState.rhythmTempo}`;
    if (DOM["rhythm-shock"]) DOM["rhythm-shock"].textContent = AppState.rhythmShockVal;
    if (DOM["rhythm-feedback-message"]) DOM["rhythm-feedback-message"].textContent = "";
    if (DOM["rhythm-start-prompt"]) DOM["rhythm-start-prompt"].style.display = "block";
    if (DOM["rhythm-tap-area"]) DOM["rhythm-tap-area"].disabled = true;
  });

  DOM["btn-exit-rhythm"]?.addEventListener("click", () => {
    stopRhythmGame();
    if (typeof showGameSelectors === "function") showGameSelectors();
    else {
      if (DOM["arena-rhythm"]) DOM["arena-rhythm"].style.display = "none";
      if (DOM["game-selectors"]) DOM["game-selectors"].style.display = "grid";
    }
  });

  DOM["rhythm-tap-area"]?.addEventListener("click", () => {
    handleRhythmTap();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && DOM["arena-rhythm"]?.style.display === "flex") {
      e.preventDefault();
      handleRhythmTap();
    }
  });

  DOM["rhythm-start-prompt"]?.parentElement?.addEventListener("click", () => {
    if (AppState.rhythmState === "IDLE") {
      startRhythmPlaying();
    }
  });
});

function startRhythmPlaying() {
  if (typeof ensureGameStrength === "function") ensureGameStrength(35);
  AppState.rhythmState = "PLAYING";
  if (DOM["rhythm-start-prompt"]) DOM["rhythm-start-prompt"].style.display = "none";
  if (DOM["rhythm-tap-area"]) DOM["rhythm-tap-area"].disabled = false;
  if (DOM["rhythm-feedback-message"])
    DOM["rhythm-feedback-message"].textContent = "Bereite Rhythmus vor...";
  AppState.rhythmCombo = 0;
  AppState.rhythmMultiplier = 1;

  const beatInterval = Math.round(60000 / AppState.rhythmTempo);
  AppState.rhythmCurrentBeatIndex = 0;
  AppState.rhythmNextBeatTime = performance.now() + beatInterval;

  log(`Rhythm Game gestartet. Tempo: ${AppState.rhythmTempo} BPM.`, "info");

  AppState.rhythmIntervalId = setInterval(() => {
    const now = performance.now();
    AppState.rhythmNextBeatTime = now + beatInterval;

    const nodeIndex = AppState.rhythmCurrentBeatIndex % 4;

    for (let i = 0; i < 4; i++) {
      const el = document.getElementById(`rhythm-node-${i}`);
      if (el) el.className = `rhythm-beat-node ${i === nodeIndex ? "active" : ""}`;
    }

    if (AppState.rhythmBeatsArray[nodeIndex]) {
      sendWaveformCommand(40, 15, 40, 15);

      setTimeout(() => {
        if (AppState.rhythmState === "PLAYING") gameWaveOff();
      }, 80);
    }

    AppState.rhythmCurrentBeatIndex++;
  }, beatInterval);
}

function stopRhythmGame() {
  if (AppState.rhythmIntervalId) {
    clearInterval(AppState.rhythmIntervalId);
    AppState.rhythmIntervalId = null;
  }
  AppState.rhythmState = "IDLE";
  gameWaveOff();
}

function handleRhythmTap() {
  if (AppState.rhythmState !== "PLAYING") return;

  const now = performance.now();

  const timeToNext = Math.abs(now - AppState.rhythmNextBeatTime);
  const beatInterval = Math.round(60000 / AppState.rhythmTempo);
  const timeToPrev = Math.abs(now - (AppState.rhythmNextBeatTime - beatInterval));

  const diff = Math.min(timeToNext, timeToPrev);

  if (DOM["rhythm-tap-area"])
    DOM["rhythm-tap-area"].style.backgroundColor = "rgba(255,255,255,0.2)";
  setTimeout(() => {
    if (DOM["rhythm-tap-area"])
      DOM["rhythm-tap-area"].style.backgroundColor = "rgba(0, 120, 212, 0.1)";
  }, 80);

  if (diff <= CONSTANTS.RHYTHM_HIT_WINDOW_MS) {
    AppState.rhythmCombo += 1;
    AppState.rhythmMultiplier = Math.min(
      CONSTANTS.RHYTHM_MAX_MULTIPLIER,
      Math.floor(AppState.rhythmCombo / 5) + 1
    );
    AppState.rhythmScore += 10 * AppState.rhythmMultiplier;
    const rhythmHs = recordHighscore("rhythm", AppState.rhythmScore);
    if (typeof refreshHighscoreUI === "function") refreshHighscoreUI();
    if (typeof playGameSfx === "function") playGameSfx("hit");
    if (rhythmHs.isNew && typeof unlockAchievement === "function") unlockAchievement("first_hs");

    if (DOM["rhythm-score"]) DOM["rhythm-score"].textContent = AppState.rhythmScore;
    if (DOM["rhythm-combo"])
      DOM["rhythm-combo"].textContent = `${AppState.rhythmCombo} (x${AppState.rhythmMultiplier})`;
    if (DOM["rhythm-feedback-message"]) {
      DOM["rhythm-feedback-message"].textContent = `PERFEKT! Combo x${AppState.rhythmMultiplier}`;
      DOM["rhythm-feedback-message"].style.color = "#107c41";
    }

    sendWaveformCommand(150, 15, 150, 15);
    setTimeout(() => {
      if (AppState.rhythmState === "PLAYING") gameWaveOff();
    }, 120);

    const activeNode = document.querySelector(".rhythm-beat-node.active");
    if (activeNode) activeNode.classList.add("hit");
  } else {
    AppState.rhythmCombo = 0;
    AppState.rhythmMultiplier = 1;

    if (DOM["rhythm-combo"])
      DOM["rhythm-combo"].textContent = `${AppState.rhythmCombo} (x${AppState.rhythmMultiplier})`;
    if (DOM["rhythm-feedback-message"]) {
      DOM["rhythm-feedback-message"].textContent = "DANEBEN! Strafe ausgel\u00f6st!";
      DOM["rhythm-feedback-message"].style.color = "#a80000";
    }

    sendWaveformCommand(
      CONSTANTS.DEFAULT_FREQUENCY,
      AppState.rhythmShockVal,
      CONSTANTS.DEFAULT_FREQUENCY,
      AppState.rhythmShockVal
    );
    if (typeof playGameSfx === "function") playGameSfx("fail");
    log("Rhythm: Beat verpasst! Strafe gesendet.", "warning");

    setTimeout(() => {
      if (AppState.rhythmState === "PLAYING") gameWaveOff();
    }, 250);

    const activeNode = document.querySelector(".rhythm-beat-node.active");
    if (activeNode) activeNode.classList.add("miss");
  }
}
