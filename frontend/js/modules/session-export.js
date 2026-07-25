// session-export.js — Export/import session presets as JSON

import { loadAutodriveConfig, saveAutodriveConfig, AUTODRIVE_TEMPLATES } from "./autodrive.js";
import { loadStimConfig, saveStimConfig } from "./stim-player.js";
import { loadShockConfig, saveShockConfig } from "./shock.js";
import { AppState, log } from "../state.js";

/**
 * @returns {object}
 */
export function buildSessionExport() {
  return {
    type: "stim-app-session",
    version: 1,
    exportedAt: new Date().toISOString(),
    softLimits: { A: AppState.softLimitA, B: AppState.softLimitB },
    masterScale: AppState.masterScale,
    autodrive: loadAutodriveConfig(),
    stim: loadStimConfig(),
    shock: loadShockConfig(),
    templates: Object.keys(AUTODRIVE_TEMPLATES),
  };
}

/**
 * @param {object} data
 * @returns {{ ok: boolean, error?: string }}
 */
export function importSessionData(data) {
  if (!data || data.type !== "stim-app-session") {
    return { ok: false, error: "Ungültiges Session-Format" };
  }
  try {
    if (data.autodrive) saveAutodriveConfig(data.autodrive);
    if (data.stim) saveStimConfig(data.stim);
    if (data.shock) saveShockConfig(data.shock);
    if (data.softLimits) {
      if (data.softLimits.A != null) AppState.softLimitA = Number(data.softLimits.A);
      if (data.softLimits.B != null) AppState.softLimitB = Number(data.softLimits.B);
      const sa =
        document.getElementById("slider-soft-a") || document.getElementById("soft-limit-a");
      const sb =
        document.getElementById("slider-soft-b") || document.getElementById("soft-limit-b");
      // settings may use different ids — best effort
      document.getElementById("input-soft-limit-a") &&
        (document.getElementById("input-soft-limit-a").value = String(AppState.softLimitA));
      document.getElementById("input-soft-limit-b") &&
        (document.getElementById("input-soft-limit-b").value = String(AppState.softLimitB));
      void sa;
      void sb;
    }
    if (data.masterScale != null) {
      AppState.masterScale = Number(data.masterScale);
    }
    log("Session-Preset importiert.", "success");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function downloadSessionExport() {
  const data = buildSessionExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stim-session-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log("Session-Preset exportiert.", "info");
}

export function wireSessionExportUi() {
  document.getElementById("btn-session-export")?.addEventListener("click", downloadSessionExport);
  document.getElementById("btn-session-import")?.addEventListener("click", () => {
    document.getElementById("input-session-import")?.click();
  });
  document.getElementById("input-session-import")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const r = importSessionData(data);
      if (!r.ok) log(`Import: ${r.error}`, "error");
      else window.location.reload();
    } catch (err) {
      log(`Import fehlgeschlagen: ${err}`, "error");
    }
    e.target.value = "";
  });
}

document.addEventListener("DOMContentLoaded", () => wireSessionExportUi());
