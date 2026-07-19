// status-ui.js - Output / safety indicators
import { AppState, log } from "../state.js";
import { killAllOutput } from "./safety.js";

export function isOutputActive() {
  if (!AppState.isConnected) return false;
  if (AppState.activePattern) return true;
  if (AppState.isAudioPlaying) return true;
  if (AppState.reflexState === "SHOCKING") return true;
  if (AppState.rhythmState && AppState.rhythmState !== "IDLE") return true;
  if (AppState.edgeState === "RUNNING") return true;
  if (AppState.potatoState === "LIVE" || AppState.potatoState === "BOOM") return true;
  if (AppState.survivalState === "RUNNING") return true;
  if ((AppState.strengthA || 0) > 0 || (AppState.strengthB || 0) > 0) return true;
  if ((AppState.lastWaveAmpA || 0) > 0 || (AppState.lastWaveAmpB || 0) > 0) {
    if (AppState.activePattern || AppState.isAudioPlaying) return true;
  }
  return false;
}

function activeOutputModeLabel() {
  if (AppState.activePattern) return String(AppState.activePattern);
  if (AppState.isAudioPlaying) return "STIM";
  if (AppState.edgeState === "RUNNING") return "Edge";
  if (AppState.potatoState === "LIVE" || AppState.potatoState === "BOOM") return "Potato";
  if (AppState.survivalState === "RUNNING") return "Survival";
  if (AppState.reflexState === "SHOCKING" || AppState.reflexState === "WAITING") return "Reflex";
  if (AppState.rhythmState && AppState.rhythmState !== "IDLE") return "Rhythm";
  return "Direkt";
}

export function updateOutputStatus(opts = {}) {
  const panic = !!opts.panic;
  const el = document.getElementById("output-status");
  const text = document.getElementById("output-status-text");
  const chip = document.getElementById("safety-chip");
  const chipText = document.getElementById("safety-chip-text");

  const active = panic ? false : isOutputActive();

  if (el) {
    el.classList.remove("idle", "active", "panic");
    if (panic) el.classList.add("panic");
    else if (active) el.classList.add("active");
    else el.classList.add("idle");
  }
  if (text) {
    if (panic) text.textContent = "PANIC – Ausgabe gestoppt";
    else if (active) text.textContent = "Ausgabe: aktiv";
    else text.textContent = "Ausgabe: aus";
  }
  if (chip) {
    chip.classList.remove("idle", "active", "panic");
    if (panic) chip.classList.add("panic");
    else if (active) chip.classList.add("active");
    else chip.classList.add("idle");
  }
  if (chipText) {
    if (panic) chipText.textContent = "PANIC";
    else if (active) {
      const a = AppState.strengthA || 0;
      const b = AppState.strengthB || 0;
      chipText.textContent = `Output A${a}/B${b} · ${activeOutputModeLabel()}`;
    } else chipText.textContent = AppState.isConnected ? "Verbunden · bereit" : "Bereit";
  }

  // Soft-limit proximity warning on labels
  const warnA = document.getElementById("label-intensity-a");
  const warnB = document.getElementById("label-intensity-b");
  if (warnA) {
    warnA.classList.toggle(
      "limit-warn",
      AppState.softLimitA > 0 && AppState.strengthA >= AppState.softLimitA * 0.9
    );
  }
  if (warnB) {
    warnB.classList.toggle(
      "limit-warn",
      AppState.softLimitB > 0 && AppState.strengthB >= AppState.softLimitB * 0.9
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-panic")?.addEventListener("click", () => {
    killAllOutput();
    updateOutputStatus({ panic: true });
    log("PANIC STOP aktiviert (STOPP-Taste).", "error");
    setTimeout(() => updateOutputStatus(), 2500);
  });

  // Periodic refresh for patterns / audio
  setInterval(() => updateOutputStatus(), 400);
  updateOutputStatus();
});
