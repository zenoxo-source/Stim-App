// settings.js - Persistent settings and preferences
import { AppState, DOM, log } from "../state.js";
import { buildSettingsExport, parseSettingsImport } from "../lib/protocol-utils.js";
import { syncFreqUI } from "../control-deck.js";
import { sendV3Init } from "./bluetooth.js";

const SETTINGS_KEY = "stim_app_settings_v1";
const LEGACY_SETTINGS_KEY = "coyote_app_settings_v1";

const defaultSettings = {
  softLimitA: 150,
  softLimitB: 150,
  masterScale: 1.0,
  frequencyA: 45,
  frequencyB: 45,
  pulseWidthA: 100,
  pulseWidthB: 100,
  freqBalanceA: 160,
  freqBalanceB: 160,
  waveBalanceA: 0,
  waveBalanceB: 0,
  swapChannels: false,
  audioHearSound: true,
};

export function loadSettings() {
  try {
    let raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (legacy) {
        raw = legacy;
        try {
          localStorage.setItem(SETTINGS_KEY, legacy);
        } catch (e) {
          /* ignore migrate write */
        }
      }
    }
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
  } catch (e) {
    console.warn("Failed to load settings:", e);
    return { ...defaultSettings };
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        softLimitA: AppState.softLimitA,
        softLimitB: AppState.softLimitB,
        masterScale: AppState.masterScale,
        frequencyA: AppState.frequencyA,
        frequencyB: AppState.frequencyB,
        pulseWidthA: AppState.pulseWidthA,
        pulseWidthB: AppState.pulseWidthB,
        freqBalanceA: AppState.freqBalanceA,
        freqBalanceB: AppState.freqBalanceB,
        waveBalanceA: AppState.waveBalanceA,
        waveBalanceB: AppState.waveBalanceB,
        swapChannels: AppState.swapChannels,
        audioHearSound: AppState.audioHearSound,
      })
    );
  } catch (e) {
    console.warn("Failed to save settings:", e);
  }
}

export function applySettings(settings) {
  AppState.softLimitA = settings.softLimitA;
  AppState.softLimitB = settings.softLimitB;
  AppState.masterScale = settings.masterScale;
  AppState.frequencyA = settings.frequencyA;
  AppState.frequencyB = settings.frequencyB;
  let pwA = settings.pulseWidthA;
  let pwB = settings.pulseWidthB;
  if (pwA === 15 && pwB === 15) {
    pwA = 100;
    pwB = 100;
  }
  AppState.pulseWidthA = pwA;
  AppState.pulseWidthB = pwB;
  AppState.freqBalanceA = settings.freqBalanceA ?? 160;
  AppState.freqBalanceB = settings.freqBalanceB ?? 160;
  AppState.waveBalanceA = settings.waveBalanceA ?? 0;
  AppState.waveBalanceB = settings.waveBalanceB ?? 0;
  AppState.swapChannels = settings.swapChannels;
  AppState.audioHearSound = settings.audioHearSound;

  if (DOM["slider-limit-a"]) DOM["slider-limit-a"].value = settings.softLimitA;
  if (DOM["label-limit-a"]) DOM["label-limit-a"].textContent = settings.softLimitA;
  if (DOM["slider-limit-b"]) DOM["slider-limit-b"].value = settings.softLimitB;
  if (DOM["label-limit-b"]) DOM["label-limit-b"].textContent = settings.softLimitB;

  if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].max = settings.softLimitA;
  if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].max = settings.softLimitB;

  if (DOM["slider-master"]) DOM["slider-master"].value = Math.round(settings.masterScale * 100);
  if (DOM["master-val-text"])
    DOM["master-val-text"].textContent = `${Math.round(settings.masterScale * 100)}%`;

  syncFreqUI("A");
  syncFreqUI("B");

  if (DOM["slider-width-a"]) DOM["slider-width-a"].value = AppState.pulseWidthA;
  if (DOM["slider-width-b"]) DOM["slider-width-b"].value = AppState.pulseWidthB;
  if (DOM["label-width-a"]) DOM["label-width-a"].textContent = `${AppState.pulseWidthA}%`;
  if (DOM["label-width-b"]) DOM["label-width-b"].textContent = `${AppState.pulseWidthB}%`;

  const bal = [
    ["slider-freq-bal-a", "label-freq-bal-a", AppState.freqBalanceA],
    ["slider-freq-bal-b", "label-freq-bal-b", AppState.freqBalanceB],
    ["slider-wave-bal-a", "label-wave-bal-a", AppState.waveBalanceA],
    ["slider-wave-bal-b", "label-wave-bal-b", AppState.waveBalanceB],
  ];
  bal.forEach(([sid, lid, val]) => {
    const s = document.getElementById(sid);
    const l = document.getElementById(lid);
    if (s) s.value = val;
    if (l) l.textContent = String(val);
  });

  if (DOM["check-swap-channels"]) DOM["check-swap-channels"].checked = settings.swapChannels;
  if (DOM["check-hear-audio"]) DOM["check-hear-audio"].checked = settings.audioHearSound;
  if (DOM["check-settings-audio"]) DOM["check-settings-audio"].checked = settings.audioHearSound;
}

function exportSettingsFile() {
  const payload = buildSettingsExport(AppState);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stim-app-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log("Einstellungen exportiert.", "success");
}

async function importSettingsFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = parseSettingsImport(text);
  } catch (e) {
    log(`Import fehlgeschlagen: ${e.message}`, "error");
    return;
  }
  applySettings(parsed);
  saveSettings();
  if (AppState.isConnected) sendV3Init();
  log("Einstellungen importiert.", "success");
}

function bindBalanceSlider(sliderId, labelId, stateKey) {
  const slider = document.getElementById(sliderId);
  const label = document.getElementById(labelId);
  if (!slider) return;
  slider.addEventListener("input", () => {
    const v = parseInt(slider.value, 10);
    AppState[stateKey] = v;
    if (label) label.textContent = String(v);
    saveSettings();
    if (AppState.isConnected) sendV3Init();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const settings = loadSettings();
  applySettings(settings);

  if (window.electronAPI && typeof window.electronAPI.getVersion === "function") {
    window.electronAPI.getVersion().then((v) => {
      if (DOM["app-version-text"]) DOM["app-version-text"].textContent = `v${v}`;
      const about = document.getElementById("about-version-line");
      if (about) about.textContent = `Version ${v}`;
    });
  } else if (DOM["app-version-text"]) {
    DOM["app-version-text"].textContent = "v1.9.0";
  }

  const saveEvents = ["input", "change"];
  [
    "slider-limit-a",
    "slider-limit-b",
    "slider-master",
    "select-freq-a",
    "select-freq-b",
    "slider-freq-a",
    "slider-freq-b",
    "slider-width-a",
    "slider-width-b",
    "check-swap-channels",
    "check-hear-audio",
    "check-settings-audio",
  ].forEach((id) => {
    const el = document.getElementById(id) || DOM[id];
    if (el) {
      saveEvents.forEach((evt) => el.addEventListener(evt, saveSettings));
    }
  });

  bindBalanceSlider("slider-freq-bal-a", "label-freq-bal-a", "freqBalanceA");
  bindBalanceSlider("slider-freq-bal-b", "label-freq-bal-b", "freqBalanceB");
  bindBalanceSlider("slider-wave-bal-a", "label-wave-bal-a", "waveBalanceA");
  bindBalanceSlider("slider-wave-bal-b", "label-wave-bal-b", "waveBalanceB");

  document.getElementById("btn-reset-balance")?.addEventListener("click", () => {
    AppState.freqBalanceA = 160;
    AppState.freqBalanceB = 160;
    AppState.waveBalanceA = 0;
    AppState.waveBalanceB = 0;
    [
      ["slider-freq-bal-a", "label-freq-bal-a", 160],
      ["slider-freq-bal-b", "label-freq-bal-b", 160],
      ["slider-wave-bal-a", "label-wave-bal-a", 0],
      ["slider-wave-bal-b", "label-wave-bal-b", 0],
    ].forEach(([sid, lid, val]) => {
      const s = document.getElementById(sid);
      const l = document.getElementById(lid);
      if (s) s.value = val;
      if (l) l.textContent = String(val);
    });
    saveSettings();
    if (AppState.isConnected) sendV3Init();
    log("Wave-Balance auf Standard zurückgesetzt.", "info");
  });

  document.getElementById("btn-export-settings")?.addEventListener("click", exportSettingsFile);
  document.getElementById("btn-import-settings")?.addEventListener("click", () => {
    document.getElementById("input-import-settings")?.click();
  });
  document.getElementById("input-import-settings")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importSettingsFromFile(file);
    e.target.value = "";
  });
});
