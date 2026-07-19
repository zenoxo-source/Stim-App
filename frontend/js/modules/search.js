// search.js - Lightweight full-text search across patterns, sessions, stats.
//
// Pure index/lookup functions. UI overlay wired in ui-bindings-pr3.js.
// Designed to be cheap: builds a flat array of {category, label, sub, action}
// entries and filters by substring (case-insensitive).

import { SESSIONS } from "./sessions.js";

/**
 * Build a searchable index of items. Called on each open of the search overlay
 * (cheap — usually < 100 items).
 * @typedef {{ category: string, label: string, sub?: string, tab: string, action: () => void }} SearchEntry
 * @returns {SearchEntry[]}
 */
export function buildIndex() {
  const entries = [];

  // Sessions
  if (SESSIONS && typeof SESSIONS === "object") {
    Object.values(SESSIONS).forEach((s) => {
      if (!s || !s.id || !s.name) return;
      entries.push({
        category: "Session",
        label: s.name,
        sub: `${s.durationSec}s · ${s.phases?.length || 0} Phasen`,
        tab: "deck",
        action: () => {
          switchToTab("deck");
          // Trigger session start by clicking its card
          const card = document.querySelector(`[data-session="${s.id}"]`);
          card?.click();
        },
      });
    });
  }

  // Custom patterns from localStorage (kept there by pattern-editor.js / v2)
  try {
    const raw = localStorage.getItem("stim_custom_patterns");
    if (raw) {
      const patterns = JSON.parse(raw);
      Object.entries(patterns).forEach(([name, p]) => {
        if (!p || !Array.isArray(p.channelA)) return;
        entries.push({
          category: "Pattern",
          label: name,
          sub: `${p.steps || p.channelA.length} Steps`,
          tab: "editor",
          action: () => {
            switchToTab("editor");
            // Selection of the pattern in the editor happens by name lookup
            // (the editor's own UI handles this; we just navigate).
            setTimeout(() => {
              const select = document.getElementById("editor-name");
              if (select) {
                select.value = name;
                select.dispatchEvent(new Event("change"));
              }
            }, 200);
          },
        });
      });
    }
  } catch {
    /* localStorage unavailable */
  }

  // Stats entries
  try {
    const raw = localStorage.getItem("stim_app_stats_v2");
    if (raw) {
      const stats = JSON.parse(raw);
      if (stats.patternsUsed) {
        Object.entries(stats.patternsUsed).forEach(([name, count]) => {
          entries.push({
            category: "Stat: Pattern",
            label: name,
            sub: `${count}× verwendet`,
            tab: "settings",
            action: () => switchToTab("settings"),
          });
        });
      }
      if (stats.gamesPlayed) {
        Object.entries(stats.gamesPlayed).forEach(([name, count]) => {
          entries.push({
            category: "Stat: Spiel",
            label: name,
            sub: `${count}× gespielt`,
            tab: "games",
            action: () => switchToTab("games"),
          });
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Tabs themselves (quick nav)
  ["deck", "stim", "games", "editor", "remote", "ai", "settings"].forEach((t) => {
    entries.push({
      category: "Tab",
      label: t,
      sub: "Tab öffnen",
      tab: t,
      action: () => switchToTab(t),
    });
  });

  return entries;
}

/**
 * Filter the index by a query string.
 * @param {SearchEntry[]} index
 * @param {string} query
 * @param {number} [limit=20]
 * @returns {SearchEntry[]}
 */
export function searchIndex(index, query, limit = 20) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return index.slice(0, limit);
  const scored = [];
  for (const entry of index) {
    const label = String(entry.label || "").toLowerCase();
    const sub = String(entry.sub || "").toLowerCase();
    const cat = String(entry.category || "").toLowerCase();
    let score = 0;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (label.includes(q)) score = 60;
    else if (sub.includes(q) || cat.includes(q)) score = 30;
    else continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * Switch the visible tab. Side-effectful helper used by entry actions.
 * @param {string} tabName
 */
function switchToTab(tabName) {
  const nav = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  nav?.click();
}
