// ui-bindings-pr5.js - DOM glue for PR5 features.
// 1. MIDI controller manager (init + mapping editor)
// 2. Session-PIN lock (set/change/lock/unlock UI)

import { log } from "../state.js";
import {
  initMidi,
  isMidiActive,
  listInputNames,
  loadMappings,
  addMapping,
  updateMapping,
  removeMapping,
} from "./midi-controller.js";
import {
  hasPin,
  setPin,
  lock,
  unlock,
  isLocked,
  onLockChange,
  validatePinStrength,
} from "./session-pin.js";

// ---------------------------------------------------------------------------
// MIDI manager
// ---------------------------------------------------------------------------

async function refreshMidiStatus() {
  const status = document.getElementById("midi-status");
  if (!status) return;
  if (isMidiActive()) {
    const inputs = listInputNames();
    status.textContent = `Aktiv — ${inputs.length} Gerät(e): ${inputs.join(", ") || "(keine)"}`;
    status.style.color = "var(--color-success)";
  } else {
    status.textContent = "Nicht aktiv";
    status.style.color = "var(--text-muted)";
  }
}

function renderMidiMappings() {
  const list = document.getElementById("midi-mapping-list");
  if (!list) return;
  const mappings = loadMappings();
  if (mappings.length === 0) {
    list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">Keine Mappings.</p>`;
    return;
  }
  list.innerHTML = mappings
    .map(
      (m) => `
      <div class="hotkey-row" data-id="${m.id}">
        <span class="hotkey-label">
          <strong>${escapeHtml(m.type.toUpperCase())} ${m.number}</strong>${
            m.inputName ? ` @ ${escapeHtml(m.inputName)}` : ""
          } → <strong>${escapeHtml(m.action.type)}</strong>
          <small style="display:block;color:var(--text-muted);">${escapeHtml(
            JSON.stringify(m.action)
          )}${m.enabled ? "" : " · aus"}</small>
        </span>
        <span class="hotkey-combo">
          <button type="button" class="btn btn-secondary btn-sm" data-toggle="${m.id}">${
            m.enabled ? "Aus" : "An"
          }</button>
          <button type="button" class="btn btn-secondary btn-sm" data-del="${m.id}">Löschen</button>
        </span>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = () => {
      const id = b.getAttribute("data-toggle");
      const mappings = loadMappings();
      const cur = mappings.find((m) => m.id === id);
      if (cur) {
        updateMapping(id, { enabled: !cur.enabled });
        renderMidiMappings();
      }
    };
  });
  list.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      removeMapping(b.getAttribute("data-del"));
      renderMidiMappings();
    };
  });
}

async function bindMidiControls() {
  const btnInit = document.getElementById("btn-midi-init");
  const btnAdd = document.getElementById("btn-midi-add");
  if (btnInit) {
    btnInit.onclick = async () => {
      const r = await initMidi();
      if (!r.ok) {
        log(`MIDI: ${r.error}`, "error");
        return;
      }
      log(`MIDI aktiviert. Geräte: ${r.inputs.join(", ") || "(keine)"}`, "success");
      refreshMidiStatus();
    };
  }
  btnAdd?.addEventListener("click", () => {
    const inputName = document.getElementById("midi-input-name")?.value || "";
    const type = document.getElementById("midi-type")?.value || "cc";
    const channel = parseInt(document.getElementById("midi-channel")?.value, 10);
    const number = parseInt(document.getElementById("midi-number")?.value, 10);
    const actionType = document.getElementById("midi-action-type")?.value || "set-strength";
    const actionChannel = document.getElementById("midi-action-channel")?.value || "A";
    const minV = parseInt(document.getElementById("midi-min")?.value, 10);
    const maxV = parseInt(document.getElementById("midi-max")?.value, 10);
    const patternName = document.getElementById("midi-pattern-name")?.value || "";

    const action = { type: actionType };
    if (actionType === "set-strength" || actionType === "set-frequency") {
      action.channel = actionChannel;
      action.min = Number.isFinite(minV) ? minV : 0;
      action.max = Number.isFinite(maxV) ? maxV : 200;
    } else if (actionType === "trigger-pattern") {
      action.patternName = patternName;
    }

    const r = addMapping({ inputName, type, channel, number, action });
    if (!r.ok) {
      log(`Mapping ungültig: ${r.error}`, "error");
      return;
    }
    renderMidiMappings();
    log(`Mapping hinzugefügt: ${type} ${number} → ${actionType}`, "success");
  });
}

// ---------------------------------------------------------------------------
// Session-PIN
// ---------------------------------------------------------------------------

function updatePinStatus() {
  const status = document.getElementById("pin-status");
  const btnLock = document.getElementById("btn-pin-lock");
  const btnUnlock = document.getElementById("btn-pin-unlock");
  if (status) {
    if (!hasPin()) {
      status.textContent = "Kein PIN gesetzt";
    } else if (isLocked()) {
      status.textContent = "Gesperrt 🔒";
      status.style.color = "var(--color-warning)";
    } else {
      status.textContent = "Entsperrt 🔓";
      status.style.color = "var(--color-success)";
    }
  }
  if (btnLock) btnLock.disabled = !hasPin() || isLocked();
  if (btnUnlock) btnUnlock.disabled = !isLocked();
}

function bindPinControls() {
  document.getElementById("btn-pin-set")?.addEventListener("click", async () => {
    const pin = prompt("Neuer PIN (4–32 Zeichen):");
    if (pin === null) return;
    const strength = validatePinStrength(pin);
    if (!strength.ok) {
      log(`PIN ungültig: ${strength.error}`, "error");
      return;
    }
    if (strength.strength === "weak") {
      if (!confirm("PIN ist schwach (kurz, nur Ziffern). Trotzdem verwenden?")) return;
    }
    const r = await setPin(pin);
    if (!r.ok) {
      log(`PIN setzen fehlgeschlagen: ${r.error}`, "error");
      return;
    }
    log("PIN gesetzt.", "success");
    updatePinStatus();
  });

  document.getElementById("btn-pin-clear")?.addEventListener("click", async () => {
    if (!confirm("PIN wirklich entfernen?")) return;
    await setPin("");
    log("PIN entfernt.", "info");
    updatePinStatus();
  });

  document.getElementById("btn-pin-lock")?.addEventListener("click", () => {
    const r = lock();
    if (!r.ok) {
      log(`Sperren fehlgeschlagen: ${r.error}`, "error");
      return;
    }
    log("Sitzung gesperrt.", "warning");
    updatePinStatus();
  });

  document.getElementById("btn-pin-unlock")?.addEventListener("click", async () => {
    const pin = prompt("PIN eingeben zum Entsperren:");
    if (pin === null) return;
    const r = await unlock(pin);
    if (!r.ok) {
      log(`Entsperren fehlgeschlagen: ${r.error}`, "error");
      return;
    }
    log("Sitzung entsperrt.", "success");
    updatePinStatus();
  });

  onLockChange(updatePinStatus);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  refreshMidiStatus();
  renderMidiMappings();
  bindMidiControls();
  updatePinStatus();
  bindPinControls();
});
