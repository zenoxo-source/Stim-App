// shock.js — Short burst (XToys shock-mode style), within soft-limits

import { AppState, DOM, log, CONSTANTS } from "../state.js";
import { sendStrengthCommand, sendWaveformCommand, sendSoftStop } from "./bluetooth.js";
import { claimOutput, releaseOutput, getOutputOwner } from "./output-owner.js";
import { blockDuringPanicCooldown } from "./safety-extras.js";
import { blockIfLocked as blockIfPinLocked } from "./session-pin.js";

function syncStrengthUi(a, b) {
  if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = String(a);
  if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = String(a);
  if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = String(a);
  if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = String(b);
  if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = String(b);
  if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = String(b);
}

const SHOCK_KEY = "stim_app_shock_v1";

export function loadShockConfig() {
  try {
    const raw = localStorage.getItem(SHOCK_KEY);
    if (!raw) return { intensity: 50, durationMs: 400, freq: 70 };
    const p = JSON.parse(raw);
    return {
      intensity: Math.max(1, Math.min(200, Number(p.intensity) || 50)),
      durationMs: Math.max(50, Math.min(3000, Number(p.durationMs) || 400)),
      freq: Math.max(10, Math.min(240, Number(p.freq) || 70)),
    };
  } catch {
    return { intensity: 50, durationMs: 400, freq: 70 };
  }
}

export function saveShockConfig(patch) {
  const m = { ...loadShockConfig(), ...patch };
  try {
    localStorage.setItem(SHOCK_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
  return m;
}

let shockTimer = null;

/**
 * Fire a short shock burst. Returns { ok, error? }
 * @param {Partial<{ intensity: number, durationMs: number, freq: number, channel: string }>} [opts]
 */
export function fireShock(opts = {}) {
  if (!AppState.isConnected) return { ok: false, error: "Nicht verbunden" };
  if (blockDuringPanicCooldown("Shock")) return { ok: false, error: "Panic-Cooldown" };
  if (blockIfPinLocked("Shock")) return { ok: false, error: "PIN gesperrt" };

  const owner = getOutputOwner();
  if (owner === "autodrive") {
    return { ok: false, error: "Während Autodrive nicht verfügbar — stoppe zuerst" };
  }

  const cfg = { ...loadShockConfig(), ...opts };
  const ch = String(opts.channel || "both").toUpperCase();
  const softA = AppState.softLimitA || 150;
  const softB = AppState.softLimitB || 150;
  const level = Math.min(cfg.intensity, softA, softB);

  const prevA = AppState.strengthA;
  const prevB = AppState.strengthB;
  const claim = claimOutput("manual");
  if (!claim.ok && owner !== "manual" && owner !== "none") {
    return { ok: false, error: claim.error || "Claim fehlgeschlagen" };
  }

  const a = ch === "B" ? Math.min(prevA, softA) : level;
  const b = ch === "A" ? Math.min(prevB, softB) : level;

  AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
  sendStrengthCommand(a, b, { writer: "manual" });
  sendWaveformCommand(cfg.freq, 100, cfg.freq, 100, { writer: "wave-loop" });
  log(`Shock ${level} · ${cfg.durationMs}ms · f${cfg.freq}`, "warning");

  if (shockTimer) clearTimeout(shockTimer);
  shockTimer = setTimeout(() => {
    // End burst wave; restore prior logical strengths (do not leave session at 0).
    sendSoftStop({ keepStrength: false, writer: "safety" });
    AppState.strengthA = prevA;
    AppState.strengthB = prevB;
    syncStrengthUi(prevA, prevB);
    if (prevA > 0 || prevB > 0) {
      // Re-assert previous absolute strength with inactive wave; idle/wave-loop
      // will resume carrier if the user still has continuous output enabled.
      sendStrengthCommand(prevA, prevB, { writer: "manual" });
      sendSoftStop({ keepStrength: true, writer: "safety" });
    }
    if (getOutputOwner() === "manual") releaseOutput("manual");
    shockTimer = null;
  }, cfg.durationMs);

  return { ok: true };
}

document.addEventListener("DOMContentLoaded", () => {
  const fire = () => {
    const r = fireShock();
    if (!r.ok) log(`Shock: ${r.error}`, "error");
  };
  document.getElementById("btn-shock")?.addEventListener("click", fire);
  document.getElementById("btn-shock-sidebar")?.addEventListener("click", fire);
  const int = document.getElementById("shock-intensity");
  const dur = document.getElementById("shock-duration");
  if (int || dur) {
    const cfg = loadShockConfig();
    if (int) int.value = String(cfg.intensity);
    if (dur) dur.value = String(cfg.durationMs);
    const save = () =>
      saveShockConfig({
        intensity: Number(int?.value) || 50,
        durationMs: Number(dur?.value) || 400,
      });
    int?.addEventListener("change", save);
    dur?.addEventListener("change", save);
  }
});
