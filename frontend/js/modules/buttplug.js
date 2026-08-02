// buttplug.js — renderer side of the Buttplug.io bridge.
// Maps VibrateCmd speeds (0–1) from Buttplug clients to device intensity
// within soft limits; provides the settings toggle + status UI.

import { AppState, log } from "../state.js";
import { sendStrengthCommand, sendWaveformCommand } from "./bluetooth.js";

let connected = false;

function applyVibrate(speed) {
  if (!AppState.isConnected) return;
  const cap = Math.max(AppState.softLimitA || 0, AppState.softLimitB || 0);
  const strength = Math.round(Math.max(0, Math.min(1, speed || 0)) * Math.min(cap, 150));
  sendStrengthCommand(strength, strength, { writer: "remote" });
  if (strength > 0) {
    sendWaveformCommand(70, 100, 70, 100, { writer: "wave-loop", force: true });
  } else {
    sendWaveformCommand(0, 0, 0, 0, { writer: "wave-loop", force: true });
  }
}

function updateUi() {
  const status = document.getElementById("buttplug-status");
  const btn = document.getElementById("btn-buttplug-toggle");
  if (!status) return;
  if (window.electronAPI && typeof window.electronAPI.getButtplugStatus === "function") {
    window.electronAPI.getButtplugStatus().then((s) => {
      connected = !!(s && s.running);
      status.textContent = connected
        ? `Läuft auf ws://127.0.0.1:${s.port} · ${s.clients} Client(s)`
        : "Gestoppt";
      if (btn) btn.textContent = connected ? "Stoppen" : "▶ Buttplug-Server starten";
    });
  }
}

export function initButtplug() {
  if (!window.electronAPI || typeof window.electronAPI.startButtplug !== "function") return;
  window.electronAPI.onButtplugVibrate(({ speed }) => applyVibrate(speed));
  document.getElementById("btn-buttplug-toggle")?.addEventListener("click", async () => {
    if (connected) {
      await window.electronAPI.stopButtplug();
      log("Buttplug-Server gestoppt.", "info");
    } else {
      const portEl = document.getElementById("buttplug-port");
      const port = portEl ? parseInt(portEl.value, 10) || 12345 : 12345;
      const r = await window.electronAPI.startButtplug(port);
      if (r.ok) {
        log(`Buttplug-Server gestartet auf ws://127.0.0.1:${r.port} (experimentell).`, "success");
      } else {
        log(`Buttplug-Server Fehler: ${r.error}`, "error");
      }
    }
    updateUi();
  });
  setInterval(updateUi, 3000);
  updateUi();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtplug, { once: true });
  } else {
    initButtplug();
  }
}
