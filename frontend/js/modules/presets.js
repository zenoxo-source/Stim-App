// presets.js - intensity presets + session safety timer

const PRESETS = {
  gentle: {
    label: "Sanft",
    softLimitA: 80,
    softLimitB: 80,
    masterScale: 0.6,
    frequencyA: 40,
    frequencyB: 40,
  },
  medium: {
    label: "Mittel",
    softLimitA: 120,
    softLimitB: 120,
    masterScale: 0.85,
    frequencyA: 45,
    frequencyB: 45,
  },
  intense: {
    label: "Intensiv",
    softLimitA: 160,
    softLimitB: 160,
    masterScale: 1.0,
    frequencyA: 55,
    frequencyB: 55,
  },
};

function applyIntensityPreset(id) {
  const p = PRESETS[id];
  if (!p) return;
  AppState.softLimitA = p.softLimitA;
  AppState.softLimitB = p.softLimitB;
  AppState.masterScale = p.masterScale;
  AppState.frequencyA = p.frequencyA;
  AppState.frequencyB = p.frequencyB;
  if (AppState.strengthA > AppState.softLimitA) AppState.strengthA = AppState.softLimitA;
  if (AppState.strengthB > AppState.softLimitB) AppState.strengthB = AppState.softLimitB;
  if (typeof applySettings === "function") {
    applySettings({
      ...AppState,
      softLimitA: p.softLimitA,
      softLimitB: p.softLimitB,
      masterScale: p.masterScale,
      frequencyA: p.frequencyA,
      frequencyB: p.frequencyB,
      pulseWidthA: AppState.pulseWidthA,
      pulseWidthB: AppState.pulseWidthB,
      swapChannels: AppState.swapChannels,
      audioHearSound: AppState.audioHearSound,
      aiProvider: DOM["ai-provider"]?.value,
      aiEndpoint: DOM["ai-endpoint"]?.value,
      aiModel: DOM["ai-model"]?.value,
      aiSystemPrompt: DOM["ai-system-prompt"]?.value,
    });
  }
  if (typeof updateSlidersA === "function") updateSlidersA(AppState.strengthA);
  if (typeof updateSlidersB === "function") updateSlidersB(AppState.strengthB);
  if (typeof syncFreqUI === "function") {
    syncFreqUI("A");
    syncFreqUI("B");
  }
  if (AppState.isConnected && typeof sendV3Init === "function") sendV3Init();
  if (typeof saveSettings === "function") saveSettings();
  document.querySelectorAll(".preset-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-preset") === id);
  });
  log(
    `Preset „${p.label}“: Limits ${p.softLimitA}/${p.softLimitB}, Master ${Math.round(p.masterScale * 100)}%, Wave-Freq ${p.frequencyA}.`,
    "info"
  );
}

// ---- Session safety timer ----
function startSafetyTimer(minutes) {
  stopSafetyTimer(false);
  const ms = Math.max(1, Number(minutes) || 15) * 60 * 1000;
  AppState.safetyTimerEndsAt = Date.now() + ms;
  AppState.safetyTimerMinutes = minutes;
  updateSafetyTimerUI();
  AppState.safetyTimerInterval = setInterval(updateSafetyTimerUI, 1000);
  log(`Safety-Timer: ${minutes} Min. – danach Soft-Stop.`, "warning");
}

function stopSafetyTimer(logMsg = true) {
  if (AppState.safetyTimerInterval) {
    clearInterval(AppState.safetyTimerInterval);
    AppState.safetyTimerInterval = null;
  }
  AppState.safetyTimerEndsAt = null;
  const el = document.getElementById("safety-timer-display");
  if (el) {
    el.textContent = "Timer aus";
    el.classList.remove("urgent");
  }
  if (logMsg) log("Safety-Timer gestoppt.", "info");
}

function updateSafetyTimerUI() {
  const el = document.getElementById("safety-timer-display");
  if (!AppState.safetyTimerEndsAt) {
    if (el) el.textContent = "Timer aus";
    return;
  }
  const left = AppState.safetyTimerEndsAt - Date.now();
  if (left <= 0) {
    stopSafetyTimer(false);
    if (typeof killAllOutput === "function") killAllOutput();
    log("Safety-Timer abgelaufen – Ausgabe gestoppt.", "warning");
    if (el) {
      el.textContent = "Zeit abgelaufen";
      el.classList.add("urgent");
    }
    return;
  }
  const sec = Math.ceil(left / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (el) {
    el.textContent = `${m}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("urgent", sec <= 60);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyIntensityPreset(btn.getAttribute("data-preset")));
  });

  document.getElementById("btn-timer-start")?.addEventListener("click", () => {
    const mins = parseInt(document.getElementById("timer-minutes")?.value || "15", 10);
    startSafetyTimer(mins);
  });
  document.getElementById("btn-timer-stop")?.addEventListener("click", () => stopSafetyTimer(true));

  // Hotkey help
  document.getElementById("btn-hotkey-help")?.addEventListener("click", () => {
    const o = document.getElementById("hotkey-overlay");
    if (o) o.style.display = o.style.display === "flex" ? "none" : "flex";
  });
  document.getElementById("hotkey-close")?.addEventListener("click", () => {
    const o = document.getElementById("hotkey-overlay");
    if (o) o.style.display = "none";
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      e.preventDefault();
      const o = document.getElementById("hotkey-overlay");
      if (o) o.style.display = o.style.display === "flex" ? "none" : "flex";
    }
    if (e.key === "Escape") {
      const o = document.getElementById("hotkey-overlay");
      if (o && o.style.display === "flex") o.style.display = "none";
    }
  });
});

window.applyIntensityPreset = applyIntensityPreset;
window.startSafetyTimer = startSafetyTimer;
window.stopSafetyTimer = stopSafetyTimer;
