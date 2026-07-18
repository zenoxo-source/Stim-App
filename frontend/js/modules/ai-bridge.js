// ai-bridge.js - AI service integration proxies and AI visualizer

window.aiStopAll = () => {
  if (!AppState.isConnected) return "Fehler: Nicht mit Ger\u00e4t verbunden.";

  AppState.activePattern = null;
  updateAIDashboard();

  if (typeof updateSlidersA === "function") updateSlidersA(0);
  if (typeof updateSlidersB === "function") updateSlidersB(0);

  sendV3EmergencyStop();

  if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = 0;
  if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = 0;
  if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = 0;

  if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = 0;
  if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = 0;
  if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = 0;

  return "All channels set to 0 and patterns stopped successfully.";
};

function clampAIValue(channel, val) {
  const limit = channel === "A" ? AppState.softLimitA : AppState.softLimitB;
  if (val < CONSTANTS.MIN_INTENSITY) return CONSTANTS.MIN_INTENSITY;
  if (val > limit) {
    log(`AI Limit-Warnung: Wert ${val} \u00fcberschreitet Soft-Limit ${limit}.`, "warning");
    return limit;
  }
  return val;
}

window.aiSetIntensity = (levelA, levelB) => {
  if (!AppState.isConnected) return "Fehler: Nicht mit Ger\u00e4t verbunden.";

  const mode = DOM["ai-channel-mode"]?.value || "sync";
  const msg = [];

  let valA = levelA !== undefined ? parseInt(levelA) : undefined;
  let valB = levelB !== undefined ? parseInt(levelB) : undefined;

  if (isNaN(valA)) valA = undefined;
  if (isNaN(valB)) valB = undefined;

  if (mode === "sync") {
    const target = valA !== undefined ? valA : valB !== undefined ? valB : undefined;
    if (target !== undefined) {
      valA = target;
      valB = target;
    }
  } else if (mode === "only_a") {
    if (valA === undefined && valB !== undefined) valA = valB;
    valB = undefined;
  } else if (mode === "only_b") {
    if (valB === undefined && valA !== undefined) valB = valA;
    valA = undefined;
  }

  if (valA !== undefined) {
    valA = clampAIValue("A", valA);
    if (typeof updateSlidersA === "function") {
      updateSlidersA(valA);
    } else {
      AppState.strengthA = valA;
      if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = valA;
      if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = valA;
      if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = valA;
    }
    msg.push(`Channel A set to ${valA}`);
  }

  if (valB !== undefined) {
    valB = clampAIValue("B", valB);
    if (typeof updateSlidersB === "function") {
      updateSlidersB(valB);
    } else {
      AppState.strengthB = valB;
      if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = valB;
      if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = valB;
      if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = valB;
    }
    msg.push(`Channel B set to ${valB}`);
  }

  if (msg.length > 0) {
    updateAIDashboard();
    if (typeof sendStrengthCommand === "function") {
      sendStrengthCommand(AppState.strengthA, AppState.strengthB);
    }
    return msg.join(", ") + " successfully.";
  }

  return "Fehler: Keine g\u00fcltigen Level \u00fcbergeben.";
};

window.aiPlayPattern = (patternName) => {
  if (!AppState.isConnected) return "Fehler: Nicht mit Ger\u00e4t verbunden.";

  if (AppState.activePattern === patternName) {
    return `Muster ${patternName} l\u00e4uft bereits.`;
  }

  const btn = document.querySelector(`.pattern-card[data-pattern="${patternName}"]`);
  if (btn && Object.values(CONSTANTS.PATTERNS).includes(patternName)) {
    document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));
    AppState.activePattern = patternName;
    btn.classList.add("active");
    if (typeof ensureGameStrength === "function") ensureGameStrength(40);

    updateAIDashboard();

    log(`AI: Muster '${patternName}' gestartet.`, "info");
    return `Muster ${patternName} gestartet.`;
  }
  return `Fehler: Muster ${patternName} nicht gefunden.`;
};

window.aiCreateCustomPattern = (name, patternA, patternB, intervalMs) => {
  if (!AppState.isConnected) return "Fehler: Nicht mit Ger\u00e4t verbunden.";

  AppState.aiCustomPatternA = Array.isArray(patternA) ? patternA : [patternA || 0];
  AppState.aiCustomPatternB = Array.isArray(patternB) ? patternB : [patternB || 0];
  AppState.aiCustomInterval = intervalMs || CONSTANTS.WAVE_LOOP_INTERVAL_MS;

  document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));
  AppState.activePattern = CONSTANTS.PATTERNS.AI_CUSTOM;
  if (typeof ensureGameStrength === "function") ensureGameStrength(40);

  const nameDisp = name || "KI Spezial";
  if (DOM["ai-dash-pattern"]) DOM["ai-dash-pattern"].textContent = nameDisp;

  log(`AI Custom Muster '${nameDisp}' gestartet.`, "info");
  return `Erfolg: Custom Muster '${nameDisp}' l\u00e4uft.`;
};

window.aiStartSession = (sessionId) => {
  if (!AppState.isConnected) return "Fehler: Nicht mit Ger\u00e4t verbunden.";

  const available = Object.values(SESSIONS).map((s) => s.id);
  if (!available.includes(sessionId))
    return `Fehler: Session '${sessionId}' nicht gefunden. Verf\u00fcgbar: ${available.join(", ")}`;

  if (SESSION_STATE.activeSession) SESSION_STATE.stop();

  document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));

  SESSION_STATE.start(sessionId);

  const session = Object.values(SESSIONS).find((s) => s.id === sessionId);
  const phaseNames = session.phases.map((p) => p.name).join(" \u2192 ");
  return `Session '${session.name}' gestartet (${session.durationSec}s). Phasen: ${phaseNames}`;
};

// eslint-disable-next-line no-unused-vars
function renderAIVisualizer() {
  requestAnimationFrame(renderAIVisualizer);

  const drawWave = (canvas, color, strength, frequency) => {
    if (!canvas) return;
    if (canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;
    if (canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight;

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, width, height);

    if (!AppState.isConnected || strength <= 0) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    const time = Date.now() / 1000;
    const effAmp = (strength / 150) * (height / 2.2);
    const effFreq = frequency / 10;

    for (let x = 0; x < width; x++) {
      const y = height / 2 + Math.sin(time * 10 + x * 0.05 * effFreq) * effAmp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  let dispA = AppState.strengthA * AppState.masterScale;
  let dispB = AppState.strengthB * AppState.masterScale;
  let visFreqA = AppState.frequencyA;
  let visFreqB = AppState.frequencyB;

  if (
    AppState.activePattern &&
    AppState.activePattern !== CONSTANTS.PATTERNS.AI_CUSTOM &&
    AppState.activePattern !== "session"
  ) {
    dispA = AppState.lastWaveAmpA;
    dispB = AppState.lastWaveAmpB;
    visFreqA = AppState.lastWaveFreqA;
    visFreqB = AppState.lastWaveFreqB;
  } else if (AppState.activePattern === "session") {
    dispA = AppState.lastWaveAmpA;
    dispB = AppState.lastWaveAmpB;
    visFreqA = AppState.lastWaveFreqA;
    visFreqB = AppState.lastWaveFreqB;
  } else if (AppState.activePattern === CONSTANTS.PATTERNS.AI_CUSTOM) {
    const tick = Math.floor(
      Date.now() / (AppState.aiCustomInterval || CONSTANTS.WAVE_LOOP_INTERVAL_MS)
    );
    dispA =
      (AppState.aiCustomPatternA.length > 0
        ? AppState.aiCustomPatternA[tick % AppState.aiCustomPatternA.length]
        : 0) * AppState.masterScale;
    dispB =
      (AppState.aiCustomPatternB.length > 0
        ? AppState.aiCustomPatternB[tick % AppState.aiCustomPatternB.length]
        : 0) * AppState.masterScale;
  }

  drawWave(DOM["ai-visualizer-a"], "#5ab3ff", dispA, visFreqA);
  drawWave(DOM["ai-visualizer-b"], "#d7b4f3", dispB, visFreqB);

  drawWave(DOM["deck-visualizer-a"], "#5ab3ff", dispA, visFreqA);
  drawWave(DOM["deck-visualizer-b"], "#d7b4f3", dispB, visFreqB);
}
