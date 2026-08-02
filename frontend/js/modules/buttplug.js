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

// ---------------------------------------------------------------------------
// Buttplug CLIENT: sync external devices (Intiface Central / Lovense / …).
// ---------------------------------------------------------------------------

let clientConnected = false;
let clientDevices = [];
let clientServer = "";
let lastSyncAt = 0;

function updateClientUi() {
  const status = document.getElementById("bpc-status");
  const btn = document.getElementById("btn-bpc-toggle");
  if (!status) return;
  status.textContent = clientConnected
    ? `Verbunden: ${clientServer || "?"} · Geräte: ${clientDevices.join(", ") || "keine"}`
    : "Getrennt";
  if (btn) btn.textContent = clientConnected ? "Trennen" : "🔗 Sync-Geräte verbinden (Intiface)";
}

/**
 * Throttled sync hook — called on strength writes; forwards the normalized
 * level (0..1) to the first connected external device.
 */
export function syncExternalDevices(levelA, levelB) {
  if (!clientConnected || !window.electronAPI?.syncButtplugClient) return;
  const now = Date.now();
  if (now - lastSyncAt < 100) return; // ~10 Hz max
  lastSyncAt = now;
  const softA = AppState.softLimitA || 150;
  const softB = AppState.softLimitB || 150;
  const speed = Math.max(
    softA > 0 ? Math.min(1, (levelA || 0) / softA) : 0,
    softB > 0 ? Math.min(1, (levelB || 0) / softB) : 0
  );
  window.electronAPI.syncButtplugClient(speed);
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

  // Client side.
  if (typeof window.electronAPI.onButtplugClientStatus === "function") {
    window.electronAPI.onButtplugClientStatus((status) => {
      clientConnected = !!(status && status.connected);
      clientDevices = (status && status.devices) || [];
      clientServer = (status && status.serverName) || "";
      updateClientUi();
    });
  }
  document.getElementById("btn-bpc-toggle")?.addEventListener("click", async () => {
    if (clientConnected) {
      await window.electronAPI.disconnectButtplugClient();
      clientConnected = false;
      updateClientUi();
      log("Sync-Geräte getrennt.", "info");
      return;
    }
    const portEl = document.getElementById("bpc-port");
    const port = portEl ? parseInt(portEl.value, 10) || 12345 : 12345;
    const r = await window.electronAPI.connectButtplugClient(port);
    if (r.ok) {
      log("Buttplug-Client verbunden (Intiface Central).", "success");
    } else {
      log(`Buttplug-Client Fehler: ${r.error}`, "error");
    }
    updateClientUi();
  });
  setInterval(updateUi, 3000);
  setInterval(updateClientUi, 3000);
  updateUi();
  updateClientUi();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtplug, { once: true });
  } else {
    initButtplug();
  }
}
