// backup.js — full local-data backup (settings, patterns, profiles, hotkeys,
// Autodrive learning/history, stats, scheduler, triggers, stories, …).
//
// Exports/imports ALL localStorage keys with the stim_*/coyote_* prefixes as a
// single JSON file. Import validates the envelope + size and only restores
// string values (localStorage cannot store anything else anyway).

import { log } from "../state.js";

const BACKUP_MAX_BYTES = 5 * 1024 * 1024;

function isAppKey(key) {
  return typeof key === "string" && /^(stim_|coyote_)/.test(key);
}

function collectKeys() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!isAppKey(key)) continue;
      try {
        const value = localStorage.getItem(key);
        if (typeof value === "string") out[key] = value;
      } catch {
        /* skip unreadable key */
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Export every app localStorage key as one JSON download. */
export function exportFullBackup() {
  try {
    const payload = {
      app: "StimApp",
      type: "full-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: collectKeys(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stim-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const count = Object.keys(payload.data).length;
    log(`Backup exportiert (${count} Datensätze).`, "success");
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Import + restore a full backup file. */
export async function importFullBackup(file) {
  try {
    if (file && file.size > BACKUP_MAX_BYTES) {
      return { ok: false, error: "Datei zu groß (max 5 MB)." };
    }
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.type !== "full-backup" || !data.data || typeof data.data !== "object") {
      return { ok: false, error: "Keine gültige Backup-Datei." };
    }
    let restored = 0;
    for (const [key, value] of Object.entries(data.data)) {
      if (!isAppKey(key) || key.length > 256) continue;
      if (typeof value !== "string") continue;
      try {
        localStorage.setItem(key, value);
        restored++;
      } catch {
        /* quota — skip */
      }
    }
    log(`Backup importiert (${restored} Datensätze). App-Neustart empfohlen.`, "success");
    return { ok: true, count: restored };
  } catch (err) {
    return { ok: false, error: `Import fehlgeschlagen: ${err.message}` };
  }
}

if (typeof document !== "undefined") {
  const wire = () => {
    document.getElementById("btn-backup-export")?.addEventListener("click", () => {
      const r = exportFullBackup();
      if (!r.ok) log(`Backup-Export fehlgeschlagen: ${r.error}`, "error");
    });
    document.getElementById("btn-backup-import")?.addEventListener("click", () => {
      document.getElementById("input-backup-import")?.click();
    });
    document.getElementById("input-backup-import")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const r = await importFullBackup(file);
        if (!r.ok) log(`Backup-Import fehlgeschlagen: ${r.error}`, "error");
      }
      e.target.value = "";
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
}
