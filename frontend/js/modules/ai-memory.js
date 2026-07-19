// ai-memory.js - Persistent AI preference memory.
//
// Stored as a list of {id, category, content, createdAt, pinned} entries in
// localStorage. Categories: like, dislike, preference, fact, note.
//
// The LLM (llm-service.js) calls getMemorySnapshot() to inject a summary into
// the system prompt, and addMemory() / forgetMemory() from tool calls.

const MEMORY_KEY = "stim_app_ai_memory_v1";

const VALID_CATEGORIES = ["like", "dislike", "preference", "fact", "note"];
const MAX_ENTRIES = 200;
const MAX_CONTENT_LEN = 500;

function makeId() {
  return "mem_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/**
 * @typedef {Object} MemoryEntry
 * @property {string} id
 * @property {"like"|"dislike"|"preference"|"fact"|"note"} category
 * @property {string} content
 * @property {string} createdAt ISO timestamp
 * @property {boolean} pinned
 */

/**
 * Load all memory entries (newest last).
 * @returns {MemoryEntry[]}
 */
export function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist.
 * @param {MemoryEntry[]} list
 */
export function saveMemory(list) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore */
  }
}

/**
 * Add a memory entry. Validates category + content length.
 * @param {string} category
 * @param {string} content
 * @param {boolean} [pinned=false] pinned entries survive `forgetUnpinned`
 * @returns {{ ok: boolean, error?: string, entry?: MemoryEntry }}
 */
export function addMemory(category, content, pinned = false) {
  if (!VALID_CATEGORIES.includes(category)) {
    return { ok: false, error: `Unbekannte Kategorie: ${category}` };
  }
  const text = String(content || "").trim();
  if (!text) return { ok: false, error: "Inhalt fehlt" };
  if (text.length > MAX_CONTENT_LEN) {
    return { ok: false, error: `Inhalt zu lang (max ${MAX_CONTENT_LEN} Zeichen)` };
  }
  const list = loadMemory();
  // Deduplicate: ignore exact content duplicates within same category
  if (list.some((e) => e.category === category && e.content === text)) {
    return { ok: false, error: "Eintrag existiert bereits" };
  }
  const entry = {
    id: makeId(),
    category,
    content: text,
    createdAt: new Date().toISOString(),
    pinned: !!pinned,
  };
  list.push(entry);
  saveMemory(list);
  return { ok: true, entry };
}

/**
 * Remove a single entry by id.
 * @param {string} id
 * @returns {boolean}
 */
export function forgetMemory(id) {
  const list = loadMemory();
  const filtered = list.filter((e) => e.id !== id);
  if (filtered.length === list.length) return false;
  saveMemory(filtered);
  return true;
}

/**
 * Remove all unpinned entries.
 * @returns {number} count removed
 */
export function forgetUnpinned() {
  const list = loadMemory();
  const kept = list.filter((e) => e.pinned);
  const removed = list.length - kept.length;
  if (removed > 0) saveMemory(kept);
  return removed;
}

/**
 * Clear everything.
 */
export function clearMemory() {
  saveMemory([]);
}

/**
 * Get a compact text snapshot suitable for injection into the AI system prompt.
 * Format: one bullet per entry, grouped by category.
 * @returns {string}
 */
export function getMemorySnapshot() {
  const list = loadMemory();
  if (list.length === 0) return "";
  const grouped = {};
  for (const cat of VALID_CATEGORIES) grouped[cat] = [];
  list.forEach((e) => {
    if (grouped[e.category]) grouped[e.category].push(e.content);
  });
  const sections = [];
  const labels = {
    like: "Mag",
    dislike: "Mag nicht",
    preference: "Präferenzen",
    fact: "Fakten",
    note: "Notizen",
  };
  for (const cat of VALID_CATEGORIES) {
    if (grouped[cat].length === 0) continue;
    sections.push(`${labels[cat]}: ${grouped[cat].join("; ")}`);
  }
  return sections.join("\n");
}

/**
 * Get memory count (for UI display).
 * @returns {number}
 */
export function getMemoryCount() {
  return loadMemory().length;
}

/**
 * Search memory by keyword.
 * @param {string} query
 * @returns {MemoryEntry[]}
 */
export function searchMemory(query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return loadMemory();
  return loadMemory().filter((e) => e.content.toLowerCase().includes(q));
}
