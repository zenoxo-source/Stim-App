// session-readiness.js — Home "Session bereit" checklist + metrics display

import { AppState } from "../state.js";
import { loadStimConfig } from "./stim-player.js";
import { getAutodriveStatsSummary, hasLastSuccess } from "./autodrive.js";

/**
 * @returns {{ ok: boolean, items: { id: string, label: string, ok: boolean, action?: string, actionLabel?: string }[] }}
 */
export function getSessionReadiness() {
  const softOk = (AppState.softLimitA || 0) >= 40 && (AppState.softLimitB || 0) >= 40;
  const softSet = (AppState.softLimitA || 0) >= 20 && (AppState.softLimitB || 0) >= 20;
  const stim = loadStimConfig();
  const stimCalib =
    stim.strengthMin >= 5 && stim.strengthMax > stim.strengthMin + 10 && stim.strengthMax <= 200;

  const items = [
    {
      id: "bt",
      label: "Bluetooth verbunden",
      ok: !!AppState.isConnected,
      action: "connect",
      actionLabel: "Verbinden",
    },
    {
      id: "soft",
      label: softOk
        ? `Soft-Limits ok (A${AppState.softLimitA}/B${AppState.softLimitB})`
        : softSet
          ? `Soft-Limits niedrig (A${AppState.softLimitA}/B${AppState.softLimitB}) — ≥40 empfohlen`
          : "Soft-Limits setzen (≥20, empfohlen ≥40)",
      ok: softOk,
      warn: softSet && !softOk,
      action: "settings",
      actionLabel: "Einstellungen",
    },
    {
      id: "stim",
      label: stimCalib
        ? `STIM kalibriert (Str ${stim.strengthMin}–${stim.strengthMax})`
        : "STIM Strength Min/Max kalibrieren",
      ok: stimCalib,
      action: "stim-calib",
      actionLabel: "STIM-Kalib",
    },
  ];

  const ok = items.every((i) => i.ok || i.warn);
  return {
    ok: items.filter((i) => i.id === "bt").every((i) => i.ok) && softSet,
    items,
    readyStrict: items.every((i) => i.ok),
  };
}

export function renderReadinessList(container) {
  if (!container) return;
  const { items } = getSessionReadiness();
  container.innerHTML = items
    .map((it) => {
      const cls = it.ok ? "ready-ok" : it.warn ? "ready-warn" : "ready-bad";
      const icon = it.ok ? "✓" : it.warn ? "!" : "○";
      const btn = it.action
        ? `<button type="button" class="btn btn-secondary btn-sm ready-action" data-action="${it.action}">${it.actionLabel || "Fix"}</button>`
        : "";
      return `<div class="ready-row ${cls}" data-id="${it.id}">
        <span class="ready-icon">${icon}</span>
        <span class="ready-label">${it.label}</span>
        ${btn}
      </div>`;
    })
    .join("");
}

export function renderHomeMetrics(el) {
  if (!el) return;
  const s = getAutodriveStatsSummary();
  const sessions = s.sessions || 0;
  if (sessions === 0) {
    el.innerHTML = "<span>Noch keine Autodrive-Sessions — 1-Tap starten.</span>";
    return;
  }
  const pct = Math.round((s.climaxRate || 0) * 100);
  const last = hasLastSuccess() ? " · ⭐ Letzte Erfolg gespeichert" : "";
  el.innerHTML = `<strong>Letzte Aktivität:</strong> ${sessions} Sessions · ${pct}% mit Fertig-Markierung${last}`;
}
