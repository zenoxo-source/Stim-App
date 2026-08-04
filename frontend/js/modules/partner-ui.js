// partner-ui.js — Partner control panel (local + remote-friendly feedback)

import {
  injectFeedback,
  isAutodriveActive,
  getAutodriveState,
  pauseAutodrive,
  resumeAutodrive,
  stopAutodrive,
  startQuickClassic,
  startLastSuccess,
  hasLastSuccess,
} from "./autodrive.js";
import { fireShock } from "./shock.js";
import { listStories, runStory } from "./session-stories.js";
import { log } from "../state.js";
import * as ProtocolUtils from "../lib/protocol-utils.js";
import { showFunToast } from "./fun.js";

let shockArmUntil = 0;

function fmtMs(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function openPartnerPanel() {
  const el = document.getElementById("partner-panel");
  if (el) el.style.display = "flex";
  paintPartnerStories();
  paintPartnerStatus();
  const lastBtn = document.getElementById("partner-last");
  if (lastBtn) lastBtn.style.display = hasLastSuccess() ? "" : "none";
}

export function closePartnerPanel() {
  const el = document.getElementById("partner-panel");
  if (el) el.style.display = "none";
  shockArmUntil = 0;
  const shockBtn = document.getElementById("partner-shock");
  if (shockBtn) {
    shockBtn.classList.remove("partner-shock-armed");
    shockBtn.textContent = "⚡ Shock";
  }
}

function paintPartnerStories() {
  const sel = document.getElementById("partner-story");
  if (!sel || sel.dataset.filled === "1") return;
  const stories = listStories();
  const esc = (t) => (ProtocolUtils.escapeHtml ? ProtocolUtils.escapeHtml(t) : t);
  sel.innerHTML =
    `<option value="">Story wählen…</option>` +
    stories.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");
  sel.dataset.filled = "1";
}

function paintPartnerStatus() {
  const stEl = document.getElementById("partner-status");
  const bar = document.getElementById("partner-progress");
  const card = document.querySelector(".partner-card");
  if (!stEl) return;

  if (!isAutodriveActive()) {
    stEl.textContent = "Autodrive aus — Start oder Story";
    if (bar) bar.style.width = "0%";
    if (card) card.dataset.phase = "IDLE";
    return;
  }

  const st = getAutodriveState();
  const phase = st.phaseLabel || st.phase || "—";
  const edge = `${st.edgeCountDone || 0}/${st.edgeCountTarget || 0}`;
  const rel = Math.round((st.relStrength || 0) * 100);
  const rem = fmtMs(st.remainingMs);
  const hint = st.nextStepHint ? ` · ${st.nextStepHint}` : "";
  stEl.textContent = `${phase} · Edge ${edge} · ${rel}% · noch ${rem}${hint}`;

  if (bar) {
    const pct = Math.round(Math.min(100, Math.max(0, (st.progress || 0) * 100)));
    bar.style.width = `${pct}%`;
  }
  if (card) card.dataset.phase = String(st.phase || "IDLE");

  const pauseBtn = document.getElementById("partner-pause");
  if (pauseBtn) pauseBtn.textContent = st.phase === "PAUSED" ? "Weiter" : "Pause";
}

function flashPartner(msg) {
  try {
    showFunToast("Partner", msg);
  } catch {
    log(msg, "info");
  }
}

function doFeedback(fb) {
  if (!isAutodriveActive()) {
    log("Partner: Autodrive läuft nicht.", "warning");
    flashPartner("Autodrive läuft nicht");
    return;
  }
  injectFeedback(fb);
  flashPartner(fb.replace(/_/g, " "));
  paintPartnerStatus();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-partner-open")?.addEventListener("click", openPartnerPanel);
  document.getElementById("partner-close")?.addEventListener("click", closePartnerPanel);

  document.querySelectorAll(".partner-fb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fb = btn.getAttribute("data-fb");
      if (fb) doFeedback(fb);
    });
  });

  document.getElementById("partner-nudge-up")?.addEventListener("click", () => {
    doFeedback("nudge_up");
  });
  document.getElementById("partner-nudge-down")?.addEventListener("click", () => {
    doFeedback("nudge_down");
  });

  document.getElementById("partner-start")?.addEventListener("click", () => {
    const r = startQuickClassic();
    if (!r.ok) {
      log(`Partner-Start: ${r.error}`, "error");
      flashPartner(r.error || "Start fehlgeschlagen");
    } else {
      flashPartner("Klassisch gestartet");
    }
    paintPartnerStatus();
  });

  document.getElementById("partner-last")?.addEventListener("click", () => {
    const r = startLastSuccess();
    if (!r.ok) {
      log(`Partner: ${r.error}`, "error");
      flashPartner(r.error || "Keine letzte Session");
    } else {
      flashPartner("Letzte Erfolgssession");
    }
    paintPartnerStatus();
  });

  document.getElementById("partner-story-run")?.addEventListener("click", () => {
    const id = document.getElementById("partner-story")?.value;
    if (!id) {
      flashPartner("Story wählen");
      return;
    }
    const r = runStory(id);
    if (!r.ok) {
      log(`Partner-Story: ${r.error}`, "error");
      flashPartner(r.error || "Story fehlgeschlagen");
    } else {
      flashPartner("Story gestartet");
    }
    paintPartnerStatus();
  });

  document.getElementById("partner-pause")?.addEventListener("click", () => {
    if (!isAutodriveActive()) {
      flashPartner("Autodrive aus");
      return;
    }
    const st = getAutodriveState();
    if (st.phase === "PAUSED") {
      resumeAutodrive();
      flashPartner("Weiter");
    } else {
      pauseAutodrive();
      flashPartner("Pause");
    }
    paintPartnerStatus();
  });

  document.getElementById("partner-stop")?.addEventListener("click", () => {
    if (isAutodriveActive()) {
      stopAutodrive("partner");
      flashPartner("Gestoppt");
    }
    paintPartnerStatus();
  });

  document.getElementById("partner-fs")?.addEventListener("click", () => {
    if (!isAutodriveActive()) {
      flashPartner("Autodrive aus");
      return;
    }
    const fs = document.getElementById("autodrive-fullscreen");
    if (fs) fs.style.display = "flex";
    closePartnerPanel();
  });

  // Double-tap arm for shock (2.5s window)
  document.getElementById("partner-shock")?.addEventListener("click", () => {
    const btn = document.getElementById("partner-shock");
    const now = Date.now();
    if (now > shockArmUntil) {
      shockArmUntil = now + 2500;
      if (btn) {
        btn.classList.add("partner-shock-armed");
        btn.textContent = "⚡ Nochmal: Shock!";
      }
      flashPartner("Shock: nochmal tippen");
      setTimeout(() => {
        if (Date.now() >= shockArmUntil - 50) {
          shockArmUntil = 0;
          if (btn) {
            btn.classList.remove("partner-shock-armed");
            btn.textContent = "⚡ Shock";
          }
        }
      }, 2600);
      return;
    }
    shockArmUntil = 0;
    if (btn) {
      btn.classList.remove("partner-shock-armed");
      btn.textContent = "⚡ Shock";
    }
    const r = fireShock();
    if (!r.ok) {
      log(`Partner-Shock: ${r.error}`, "error");
      flashPartner(r.error || "Shock fehlgeschlagen");
    } else {
      flashPartner("Shock!");
    }
  });

  // ESC closes partner panel
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const panel = document.getElementById("partner-panel");
    if (panel && panel.style.display !== "none") {
      closePartnerPanel();
    }
  });

  setInterval(paintPartnerStatus, 400);
});
