// ui-bindings-pr4.js - DOM glue for PR4 features.
// 1. Dice toggle (uses active button label)
// 2. Music-Sync toggle
// 3. Trigger manager UI
// 4. AI-Memory viewer

import { log } from "../state.js";
import {
  startDice,
  stopDice,
  isDiceActive,
  loadConfig as loadDiceConfig,
  saveConfig as saveDiceConfig,
} from "./dice.js";
import { startMusicSync, stopMusicSync, isMusicSyncActive } from "./music-sync.js";
import { loadTriggers, addTrigger, updateTrigger, removeTrigger, armTriggers } from "./triggers.js";
import {
  loadMemory,
  addMemory,
  forgetMemory,
  forgetUnpinned,
  clearMemory,
  getMemoryCount,
} from "./ai-memory.js";

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

function updateDiceButton() {
  const btn = document.getElementById("btn-dice-toggle");
  if (!btn) return;
  btn.textContent = isDiceActive() ? "⏹ Dice Stop" : "🎲 Dice";
  btn.classList.toggle("btn-secondary", !isDiceActive());
}

function openDiceConfig() {
  const cfg = loadDiceConfig();
  const interval = prompt("Interval (ms, min 500):", cfg.intervalMs);
  if (interval === null) return;
  const min = prompt("Min-Stärke (0-200):", cfg.min);
  if (min === null) return;
  const max = prompt("Max-Stärke (0-200):", cfg.max);
  if (max === null) return;
  const channel = prompt("Kanal (A / B / both):", cfg.channel);
  if (channel === null) return;
  saveDiceConfig({
    intervalMs: parseInt(interval, 10) || cfg.intervalMs,
    min: parseInt(min, 10) || cfg.min,
    max: parseInt(max, 10) || cfg.max,
    channel: ["A", "B", "both"].includes(channel) ? channel : cfg.channel,
  });
}

// ---------------------------------------------------------------------------
// Music-Sync
// ---------------------------------------------------------------------------

function updateMusicButton() {
  const btn = document.getElementById("btn-music-sync");
  if (!btn) return;
  btn.textContent = isMusicSyncActive() ? "⏹ Stop" : "🎵 Music-Sync";
  btn.classList.toggle("btn-secondary", !isMusicSyncActive());
}

// ---------------------------------------------------------------------------
// Triggers UI
// ---------------------------------------------------------------------------

function renderTriggerList() {
  const list = document.getElementById("trigger-list");
  if (!list) return;
  const triggers = loadTriggers();
  if (triggers.length === 0) {
    list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">Keine Trigger definiert.</p>`;
    return;
  }
  list.innerHTML = triggers
    .map(
      (t) => `
      <div class="hotkey-row" data-id="${t.id}">
        <span class="hotkey-label">
          <strong>${escapeHtml(t.condition.type)}</strong> → <strong>${escapeHtml(
            t.action.type
          )}</strong>
          <small style="display:block;color:var(--text-muted);">${escapeHtml(
            JSON.stringify(t.condition)
          )} → ${escapeHtml(JSON.stringify(t.action))}${t.enabled ? "" : " · aus"}</small>
        </span>
        <span class="hotkey-combo">
          <button type="button" class="btn btn-secondary btn-sm" data-toggle="${t.id}">${
            t.enabled ? "Aus" : "An"
          }</button>
          <button type="button" class="btn btn-secondary btn-sm" data-del="${t.id}">Löschen</button>
        </span>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = () => {
      const id = b.getAttribute("data-toggle");
      const triggers = loadTriggers();
      const cur = triggers.find((t) => t.id === id);
      if (cur) {
        updateTrigger(id, { enabled: !cur.enabled });
        renderTriggerList();
      }
    };
  });
  list.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      removeTrigger(b.getAttribute("data-del"));
      renderTriggerList();
    };
  });
}

function bindTriggerForm() {
  const btnAdd = document.getElementById("btn-trigger-add");
  const btnArm = document.getElementById("btn-trigger-arm");
  if (btnAdd) {
    btnAdd.onclick = () => {
      const condType = document.getElementById("trigger-cond-type")?.value;
      const condVal = document.getElementById("trigger-cond-value")?.value;
      const actionType = document.getElementById("trigger-action-type")?.value;
      const actionVal = document.getElementById("trigger-action-value")?.value;

      const condition = { type: condType };
      if (condType === "strength-above" || condType === "strength-below") {
        condition.channel = "A";
        condition.value = parseInt(condVal, 10) || 0;
      } else if (condType === "time-elapsed") {
        condition.seconds = parseInt(condVal, 10) || 0;
      } else if (condType === "pattern-active") {
        condition.name = condVal || "wave";
      }

      const action = { type: actionType };
      if (actionType === "set-strength") {
        action.channel = "both";
        action.value = parseInt(actionVal, 10) || 0;
      } else if (actionType === "log" || actionType === "toast") {
        action.message = actionVal || "(leer)";
      } else if (actionType === "start-pattern") {
        action.name = actionVal || "wave";
      }

      const r = addTrigger({ condition, action });
      if (!r.ok) {
        log(`Trigger ungültig: ${r.error}`, "error");
        return;
      }
      renderTriggerList();
      log(`Trigger hinzugefügt: ${condType} → ${actionType}`, "success");
    };
  }
  btnArm?.addEventListener("click", () => {
    armTriggers();
    log("Trigger scharfgestellt.", "success");
  });
}

// ---------------------------------------------------------------------------
// AI-Memory UI
// ---------------------------------------------------------------------------

function renderMemoryList() {
  const list = document.getElementById("ai-memory-list");
  const countEl = document.getElementById("ai-memory-count");
  if (countEl) countEl.textContent = getMemoryCount();
  if (!list) return;
  const memory = loadMemory();
  if (memory.length === 0) {
    list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Noch keine Erinnerungen.</p>`;
    return;
  }
  list.innerHTML = memory
    .slice(-25)
    .reverse()
    .map(
      (m) => `
      <div class="hotkey-row" data-id="${m.id}">
        <span class="hotkey-label">
          <strong>${escapeHtml(m.category)}</strong>${m.pinned ? " 📌" : ""}
          <span style="margin-left: 8px;">${escapeHtml(m.content)}</span>
        </span>
        <span class="hotkey-combo">
          <button type="button" class="btn btn-secondary btn-sm" data-mem-del="${m.id}">🗑</button>
        </span>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-mem-del]").forEach((b) => {
    b.onclick = () => {
      forgetMemory(b.getAttribute("data-mem-del"));
      renderMemoryList();
    };
  });
}

function bindMemoryForm() {
  const btnAdd = document.getElementById("btn-memory-add");
  if (!btnAdd) return;
  btnAdd.onclick = () => {
    const cat = document.getElementById("memory-category")?.value || "preference";
    const content = document.getElementById("memory-content")?.value?.trim();
    if (!content) {
      log("Inhalt fehlt.", "warning");
      return;
    }
    const r = addMemory(cat, content);
    if (!r.ok) {
      log(`Speichern fehlgeschlagen: ${r.error}`, "warning");
      return;
    }
    document.getElementById("memory-content").value = "";
    renderMemoryList();
  };
  document.getElementById("btn-memory-clear-unpinned")?.addEventListener("click", () => {
    const n = forgetUnpinned();
    log(`${n} unpinned Einträge gelöscht.`, "info");
    renderMemoryList();
  });
  document.getElementById("btn-memory-clear-all")?.addEventListener("click", () => {
    if (confirm("Wirklich alle Erinnerungen löschen?")) {
      clearMemory();
      renderMemoryList();
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers + DOMContentLoaded
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  // Dice
  updateDiceButton();
  document.getElementById("btn-dice-toggle")?.addEventListener("click", () => {
    if (isDiceActive()) {
      stopDice("user");
    } else {
      openDiceConfig();
      const r = startDice();
      if (!r.ok) log(`Dice-Start: ${r.error}`, "warning");
    }
    updateDiceButton();
  });

  // Music-Sync
  updateMusicButton();
  document.getElementById("btn-music-sync")?.addEventListener("click", async () => {
    if (isMusicSyncActive()) {
      stopMusicSync("user");
      updateMusicButton();
      return;
    }
    const r = await startMusicSync();
    if (!r.ok) {
      log(`Music-Sync: ${r.error}`, "error");
    }
    updateMusicButton();
  });

  // Triggers
  renderTriggerList();
  bindTriggerForm();

  // AI-Memory
  renderMemoryList();
  bindMemoryForm();
});
