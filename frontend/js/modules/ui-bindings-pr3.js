// ui-bindings-pr3.js - DOM glue for PR3 features.
//
// 1. Pattern import with preview dialog
// 2. Search overlay (Ctrl+K)
// 3. Session scheduler UI
// 4. Recording editor (trim/loop/fade)

import { log } from "../state.js";
import { RECORDER } from "./recorder.js";
import { SESSIONS } from "./sessions.js";
import { parseImportPayload, summarizePattern, mergePatterns } from "./pattern-import.js";
import { buildIndex, searchIndex } from "./search.js";
import { loadEntries, addEntry, updateEntry, removeEntry } from "./scheduler.js";
import {
  trimByTime,
  loopSection,
  fadeIn,
  fadeOut,
  normalize,
  getDuration,
  formatDuration,
} from "./recording-editor.js";
import { PATTERN_EDITOR2 } from "./pattern-editor-v2.js";

// ---------------------------------------------------------------------------
// 1. Pattern Import (Preview)
// ---------------------------------------------------------------------------

let pendingImport = null; // { valid: [], errors: [] }

function openImportDialog() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseImportPayload(text);
      pendingImport = result;
      renderImportPreview();
    } catch (err) {
      log(`Import-Dialog fehlgeschlagen: ${err.message}`, "error");
    }
    input.remove();
  };
  input.click();
}

function renderImportPreview() {
  if (!pendingImport) return;
  let modal = document.getElementById("pattern-import-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "pattern-import-modal";
    modal.style.cssText =
      "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-surface-solid);border:1px solid var(--border-color);border-radius:8px;padding:20px;max-width:560px;max-height:80vh;overflow:auto;z-index:10000;box-shadow:var(--shadow-elevation);";
    document.body.appendChild(modal);
  }
  const { valid, errors, fatalError } = pendingImport;
  modal.innerHTML = `
    <h3 style="margin-top:0;">Pattern-Import Vorschau</h3>
    ${fatalError ? `<p style="color:var(--color-error);">${fatalError}</p>` : ""}
    <p style="color:var(--text-muted);font-size:13px;margin:8px 0;">
      ${valid.length} gültig, ${errors.length} ungültig
    </p>
    <div id="import-preview-list"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button type="button" id="btn-import-cancel" class="btn btn-secondary btn-sm">Abbrechen</button>
      <button type="button" id="btn-import-confirm" class="btn btn-sm" ${
        valid.length === 0 ? "disabled" : ""
      }>Importieren (${valid.length})</button>
    </div>
  `;
  const list = modal.querySelector("#import-preview-list");
  list.innerHTML = valid
    .map(({ name, pattern }) => {
      const s = summarizePattern(pattern);
      return `
        <div class="hotkey-row">
          <span class="hotkey-label">
            <strong>${escapeHtml(name)}</strong>
            <small style="display:block;color:var(--text-muted);">
              ${pattern.steps} Steps · Avg A=${s.avgA} B=${s.avgB} · Max A=${s.maxA} B=${s.maxB}
            </small>
          </span>
        </div>`;
    })
    .join("");
  if (errors.length > 0) {
    list.innerHTML += errors
      .map(
        (e) =>
          `<div class="hotkey-row"><span class="hotkey-label" style="color:var(--color-error);">${escapeHtml(
            e.name
          )}: ${escapeHtml(e.error)}</span></div>`
      )
      .join("");
  }
  modal.querySelector("#btn-import-cancel").onclick = () => {
    modal.remove();
    pendingImport = null;
  };
  modal.querySelector("#btn-import-confirm").onclick = () => {
    const renames = mergePatterns(PATTERN_EDITOR2.customPatterns, valid);
    PATTERN_EDITOR2.saveCustomPatterns();
    PATTERN_EDITOR2.renderSavedList();
    log(`${valid.length} Pattern(s) importiert.`, "success");
    if (renames.some((r) => r.original !== r.storedAs)) {
      log(
        `Umbenannt: ${renames
          .filter((r) => r.original !== r.storedAs)
          .map((r) => `${r.original} → ${r.storedAs}`)
          .join(", ")}`,
        "info"
      );
    }
    modal.remove();
    pendingImport = null;
  };
}

// ---------------------------------------------------------------------------
// 2. Search overlay (Ctrl+K)
// ---------------------------------------------------------------------------

let searchIndexCache = null;
let searchVisible = false;

function openSearch() {
  let overlay = document.getElementById("search-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "search-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;z-index:10001;";
    overlay.innerHTML = `
      <div style="background:var(--bg-surface-solid);border-radius:8px;width:90%;max-width:560px;box-shadow:var(--shadow-elevation);">
        <input type="text" id="search-input" placeholder="Suche Patterns, Sessions, Stats…" style="width:100%;box-sizing:border-box;padding:12px 16px;background:transparent;border:none;border-bottom:1px solid var(--border-color);color:var(--text-primary);font-size:15px;border-radius:8px 8px 0 0;" autocomplete="off">
        <div id="search-results" style="max-height:50vh;overflow-y:auto;"></div>
        <div style="padding:8px 16px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border-color);">ESC zum Schließen · ↑↓ wählen · Enter öffnet</div>
      </div>`;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeSearch();
    });
    document.body.appendChild(overlay);
  }
  searchIndexCache = buildIndex();
  const input = overlay.querySelector("#search-input");
  input.value = "";
  renderSearchResults("");
  input.focus();
  searchVisible = true;
  if (!overlay._wired) {
    input.addEventListener("input", () => renderSearchResults(input.value));
    overlay.addEventListener("keydown", onSearchKey);
    overlay._wired = true;
  }
}

function closeSearch() {
  const overlay = document.getElementById("search-overlay");
  if (overlay) overlay.style.display = "none";
  searchVisible = false;
}

function renderSearchResults(query) {
  const results = searchIndex(searchIndexCache || [], query, 20);
  const container = document.getElementById("search-results");
  if (!container) return;
  if (results.length === 0) {
    container.innerHTML = `<div style="padding:16px;color:var(--text-muted);">Keine Treffer für „${escapeHtml(query)}""</div>`;
    return;
  }
  container.innerHTML = results
    .map(
      (r, i) => `
      <div class="search-result" data-idx="${i}" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border-color);">
        <div style="font-size:14px;">${escapeHtml(r.label)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(r.category)}${
          r.sub ? " · " + escapeHtml(r.sub) : ""
        }</div>
      </div>`
    )
    .join("");
  container.querySelectorAll(".search-result").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.getAttribute("data-idx"), 10);
      const entry = results[idx];
      closeSearch();
      try {
        entry.action();
      } catch (err) {
        console.warn("Search action failed:", err);
      }
    });
    el.addEventListener("mouseenter", () => {
      container.querySelectorAll(".search-result").forEach((e) => e.classList.remove("active"));
      el.classList.add("active");
    });
  });
}

function onSearchKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const container = document.getElementById("search-results");
    if (!container) return;
    const items = Array.from(container.querySelectorAll(".search-result"));
    if (items.length === 0) return;
    const curIdx = items.findIndex((el) => el.classList.contains("active"));
    let nextIdx = curIdx === -1 ? 0 : curIdx + (e.key === "ArrowDown" ? 1 : -1);
    if (nextIdx < 0) nextIdx = items.length - 1;
    if (nextIdx >= items.length) nextIdx = 0;
    items.forEach((el) => el.classList.remove("active"));
    items[nextIdx].classList.add("active");
    items[nextIdx].scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const container = document.getElementById("search-results");
    const active = container?.querySelector(".search-result.active");
    if (active) active.click();
  }
}

// ---------------------------------------------------------------------------
// 3. Session scheduler
// ---------------------------------------------------------------------------

function renderSchedulerList() {
  const list = document.getElementById("scheduler-list");
  if (!list) return;
  const entries = loadEntries();
  if (entries.length === 0) {
    list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">Keine geplanten Sessions.</p>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (e) => `
      <div class="hotkey-row" data-id="${e.id}">
        <span class="hotkey-label">
          <strong>${escapeHtml(e.name)}</strong>
          <small style="display:block;color:var(--text-muted);">
            ${String(e.hour).padStart(2, "0")}:${String(e.minute).padStart(2, "0")}${
              e.repeatDays.length > 0
                ? " · " +
                  e.repeatDays.map((d) => ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d]).join(", ")
                : " · einmalig"
            }${e.enabled ? "" : " · deaktiviert"}
          </small>
        </span>
        <span class="hotkey-combo">
          <button type="button" class="btn btn-secondary btn-sm" data-toggle="${e.id}">${
            e.enabled ? "Deaktivieren" : "Aktivieren"
          }</button>
          <button type="button" class="btn btn-secondary btn-sm" data-del="${e.id}">Löschen</button>
        </span>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = () => {
      const id = b.getAttribute("data-toggle");
      const entries = loadEntries();
      const cur = entries.find((e) => e.id === id);
      if (cur) {
        updateEntry(id, { enabled: !cur.enabled });
        renderSchedulerList();
      }
    };
  });
  list.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      removeEntry(b.getAttribute("data-del"));
      renderSchedulerList();
      log("Scheduler-Eintrag gelöscht.", "info");
    };
  });
}

function bindSchedulerForm() {
  const btnAdd = document.getElementById("btn-scheduler-add");
  if (!btnAdd) return;
  btnAdd.addEventListener("click", () => {
    const sessionSel = document.getElementById("scheduler-session");
    const timeInput = document.getElementById("scheduler-time");
    const daysInput = document.getElementById("scheduler-days");
    const sessionId = sessionSel?.value;
    const name = sessionSel?.selectedOptions?.[0]?.textContent || sessionId;
    const [h, m] = (timeInput?.value || "20:00").split(":").map((x) => parseInt(x, 10));
    let repeatDays = [];
    if (daysInput?.value) {
      repeatDays = daysInput.value
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => n >= 0 && n <= 6);
    }
    if (!sessionId) {
      log("Bitte Session wählen.", "warning");
      return;
    }
    addEntry({ sessionId, name, hour: h, minute: m, repeatDays });
    renderSchedulerList();
    log(`Session „${name}" geplant für ${h}:${String(m).padStart(2, "0")}.`, "success");
  });
}

function populateSessionSelect() {
  const sel = document.getElementById("scheduler-session");
  if (!sel) return;
  sel.innerHTML = Object.values(SESSIONS)
    .map((s) => `<option value="${s.id}">${s.name} (${s.durationSec}s)</option>`)
    .join("");
}

// ---------------------------------------------------------------------------
// 4. Recording editor
// ---------------------------------------------------------------------------

function getSelectionMs() {
  const startEl = document.getElementById("rec-edit-start");
  const endEl = document.getElementById("rec-edit-end");
  return {
    start: parseInt(startEl?.value, 10) || 0,
    end: parseInt(endEl?.value, 10) || getDuration(RECORDER.frames),
  };
}

function applyEdit(op) {
  if (!RECORDER.frames || RECORDER.frames.length === 0) {
    log("Keine Aufnahme zum Bearbeiten.", "warning");
    return;
  }
  let next;
  switch (op) {
    case "trim": {
      const { start, end } = getSelectionMs();
      next = trimByTime(RECORDER.frames, start, end);
      break;
    }
    case "loop": {
      const { start, end } = getSelectionMs();
      const iter = parseInt(document.getElementById("rec-edit-loops")?.value, 10) || 2;
      next = loopSection(RECORDER.frames, start, end, iter);
      break;
    }
    case "fade-in": {
      const dur = parseInt(document.getElementById("rec-edit-fade")?.value, 10) || 2000;
      next = fadeIn(RECORDER.frames, dur);
      break;
    }
    case "fade-out": {
      const dur = parseInt(document.getElementById("rec-edit-fade")?.value, 10) || 2000;
      next = fadeOut(RECORDER.frames, dur);
      break;
    }
    case "normalize": {
      next = normalize(RECORDER.frames, 100);
      break;
    }
    default:
      return;
  }
  RECORDER.frames = next;
  RECORDER.updateUI();
  log(
    `Aufnahme bearbeitet (${op}): ${next.length} Frames, ${formatDuration(getDuration(next))}.`,
    "success"
  );
}

function bindRecordingEditor() {
  document.getElementById("btn-rec-trim")?.addEventListener("click", () => applyEdit("trim"));
  document.getElementById("btn-rec-loop")?.addEventListener("click", () => applyEdit("loop"));
  document.getElementById("btn-rec-fade-in")?.addEventListener("click", () => applyEdit("fade-in"));
  document
    .getElementById("btn-rec-fade-out")
    ?.addEventListener("click", () => applyEdit("fade-out"));
  document
    .getElementById("btn-rec-normalize")
    ?.addEventListener("click", () => applyEdit("normalize"));
}

// ---------------------------------------------------------------------------
// Misc helpers + DOMContentLoaded glue
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  // Pattern import button (added next to the existing export button)
  document.getElementById("btn-pattern-import")?.addEventListener("click", openImportDialog);

  // Search overlay: Ctrl+K
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const overlay = document.getElementById("search-overlay");
      if (overlay && overlay.style.display !== "none") {
        closeSearch();
      } else {
        openSearch();
      }
    }
    if (e.key === "Escape" && searchVisible) {
      closeSearch();
    }
  });

  // Scheduler
  populateSessionSelect();
  renderSchedulerList();
  bindSchedulerForm();

  // Recording editor
  bindRecordingEditor();
});
