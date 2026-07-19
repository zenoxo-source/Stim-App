// ui-bindings-pr2.js - DOM glue for PR2 features (profiles + hotkeys UI).
// Keeps the wiring out of the core modules so they stay DOM-optional (tests).

import { log } from "../state.js";
import {
  listActions,
  setBinding,
  resetBinding,
  resetAllBindings,
  comboFromEvent,
} from "./hotkeys.js";
import {
  loadProfiles,
  createProfile,
  switchProfile,
  deleteProfile,
  renameProfile,
  updateActiveProfile,
  getActiveProfile,
} from "./profiles.js";

// ---------------------------------------------------------------------------
// Hotkey editor
// ---------------------------------------------------------------------------

function renderHotkeyList() {
  const list = document.getElementById("hotkey-list");
  if (!list) return;
  const actions = listActions();
  list.innerHTML = actions
    .map(
      (a) => `
      <div class="hotkey-row" data-action="${a.id}">
        <span class="hotkey-label">${a.label}${a.allowRebind ? "" : " <small>(geschützt)</small>"}</span>
        <span class="hotkey-combo">
          <kbd data-combo="${a.id}">${a.currentCombo || "—"}</kbd>
          ${
            a.allowRebind
              ? `<button type="button" class="btn btn-secondary btn-sm" data-rebind="${a.id}">Ändern</button>
                 <button type="button" class="btn btn-secondary btn-sm" data-reset="${a.id}">Reset</button>`
              : ""
          }
        </span>
      </div>`
    )
    .join("");

  list.querySelectorAll("[data-rebind]").forEach((btn) => {
    btn.addEventListener("click", () => startCapture(btn.getAttribute("data-rebind")));
  });
  list.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-reset");
      resetBinding(id);
      renderHotkeyList();
      log(`Hotkey für ${id} zurückgesetzt.`, "info");
    });
  });
}

function startCapture(actionId) {
  const kbd = document.querySelector(`kbd[data-combo="${actionId}"]`);
  if (!kbd) return;
  kbd.textContent = "… Taste drücken";
  kbd.classList.add("hotkey-capture");

  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const combo = comboFromEvent(e);
    if (!combo) return; // ignore pure modifier presses
    const result = setBinding(actionId, combo);
    if (!result.ok) {
      log(`Hotkey nicht gesetzt: ${result.error}`, "warning");
    } else {
      log(`Hotkey gesetzt: ${combo}`, "success");
    }
    cleanup();
    renderHotkeyList();
  };

  const onEsc = (e) => {
    if (e.key === "Escape") {
      cleanup();
      renderHotkeyList();
    }
  };

  function cleanup() {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keydown", onEsc, true);
  }

  // Capture-phase + stopPropagation so the global hotkey listener doesn't
  // also fire on these keys.
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keydown", onEsc, true);
}

// ---------------------------------------------------------------------------
// Profile manager
// ---------------------------------------------------------------------------

function renderProfileSelect() {
  const sel = document.getElementById("profile-select");
  if (!sel) return;
  const data = loadProfiles();
  const activeId = data.active;
  sel.innerHTML = Object.values(data.profiles)
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === activeId ? " selected" : ""}>${escapeHtml(p.name)}</option>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindProfileButtons() {
  const sel = document.getElementById("profile-select");
  const btnLoad = document.getElementById("btn-profile-load");
  const btnSave = document.getElementById("btn-profile-save");
  const btnNew = document.getElementById("btn-profile-new");
  const btnRename = document.getElementById("btn-profile-rename");
  const btnDelete = document.getElementById("btn-profile-delete");
  const newRow = document.getElementById("profile-new-row");
  const inputNewName = document.getElementById("profile-new-name");
  const btnCreate = document.getElementById("btn-profile-create");
  const btnCancel = document.getElementById("btn-profile-cancel");
  if (!sel) return;

  btnLoad?.addEventListener("click", () => {
    const r = switchProfile(sel.value);
    if (!r.ok) log(`Profil-Laden fehlgeschlagen: ${r.error}`, "error");
  });
  btnSave?.addEventListener("click", () => {
    updateActiveProfile();
    renderProfileSelect();
  });
  btnNew?.addEventListener("click", () => {
    if (newRow) newRow.style.display = "flex";
    inputNewName?.focus();
  });
  btnCancel?.addEventListener("click", () => {
    if (newRow) newRow.style.display = "none";
    if (inputNewName) inputNewName.value = "";
  });
  btnCreate?.addEventListener("click", () => {
    const name = (inputNewName?.value || "").trim() || "Neues Profil";
    createProfile(name);
    if (newRow) newRow.style.display = "none";
    if (inputNewName) inputNewName.value = "";
    renderProfileSelect();
  });
  btnRename?.addEventListener("click", () => {
    const cur = getActiveProfile();
    if (!cur) return;
    const name = prompt("Neuer Name:", cur.name);
    if (name && name.trim()) {
      renameProfile(cur.id, name.trim());
      renderProfileSelect();
    }
  });
  btnDelete?.addEventListener("click", () => {
    const id = sel.value;
    const r = deleteProfile(id);
    if (!r.ok) {
      log(`Löschen fehlgeschlagen: ${r.error}`, "warning");
      return;
    }
    renderProfileSelect();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderHotkeyList();
  renderProfileSelect();
  bindProfileButtons();

  document.getElementById("btn-hotkey-reset")?.addEventListener("click", () => {
    if (confirm("Alle Hotkeys zurücksetzen?")) {
      resetAllBindings();
      renderHotkeyList();
      log("Alle Hotkeys auf Standard zurückgesetzt.", "info");
    }
  });
});
