// scheduler.js - Session scheduler.
//
// Persists scheduled session runs in localStorage. Each entry knows:
//   - sessionId (matches SESSIONS[id])
//   - triggerAt (ISO timestamp)
//   - repeatDays (array of weekday numbers 0–6; empty = one-shot)
//   - enabled (boolean)
//
// Tick: every 30 s, find entries where triggerAt's HH:MM matches "now" and
// (weekday matches repeatDays OR no repeatDays + not yet fired today).
//
// Cross-platform: pure JS + Date. No platform code.

import { log } from "../state.js";
import { SESSION_STATE } from "./sessions.js";

const SCHEDULER_KEY = "stim_app_scheduler_v1";
const TICK_MS = 30_000;

let intervalId = null;
/** Tracks which entries fired on which YYYY-MM-DD to avoid double-fire. */
const firedToday = new Map(); // entryId → YYYY-MM-DD

/**
 * @typedef {Object} ScheduleEntry
 * @property {string} id
 * @property {string} sessionId
 * @property {string} name Human-readable session name (snapshot at creation)
 * @property {number} hour 0–23
 * @property {number} minute 0–59
 * @property {number[]} repeatDays Weekday numbers 0 (Sun) – 6 (Sat). Empty = one-shot.
 * @property {string} createdAt ISO timestamp
 * @property {boolean} enabled
 * @property {?string} lastFired ISO timestamp of last firing
 * @property {?string} nextFireAt ISO timestamp of next scheduled fire (computed)
 */

function makeId() {
  return "sch_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Load all entries.
 * @returns {ScheduleEntry[]}
 */
export function loadEntries() {
  try {
    const raw = localStorage.getItem(SCHEDULER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist entries.
 * @param {ScheduleEntry[]} entries
 */
export function saveEntries(entries) {
  try {
    localStorage.setItem(SCHEDULER_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn("Failed to save scheduler entries:", err);
  }
}

/**
 * Add a new schedule entry.
 * @param {{sessionId: string, name: string, hour: number, minute: number, repeatDays?: number[]}} opts
 * @returns {ScheduleEntry}
 */
export function addEntry({ sessionId, name, hour, minute, repeatDays }) {
  if (!sessionId) throw new Error("sessionId fehlt");
  const h = Math.max(0, Math.min(23, parseInt(hour, 10)));
  const m = Math.max(0, Math.min(59, parseInt(minute, 10)));
  const days = Array.isArray(repeatDays) ? repeatDays.filter((d) => d >= 0 && d <= 6) : [];
  const entry = {
    id: makeId(),
    sessionId,
    name: name || sessionId,
    hour: h,
    minute: m,
    repeatDays: days,
    createdAt: new Date().toISOString(),
    enabled: true,
    lastFired: null,
    nextFireAt: null,
  };
  entry.nextFireAt = computeNextFire(entry);
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  return entry;
}

/**
 * Update an entry (e.g. enable/disable, change time).
 * @param {string} id
 * @param {Partial<ScheduleEntry>} patch
 * @returns {ScheduleEntry|null}
 */
export function updateEntry(id, patch) {
  const entries = loadEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated = { ...entries[idx], ...patch };
  if (typeof patch.hour === "number" || typeof patch.minute === "number") {
    updated.hour = Math.max(0, Math.min(23, parseInt(updated.hour, 10)));
    updated.minute = Math.max(0, Math.min(59, parseInt(updated.minute, 10)));
  }
  if (Array.isArray(patch.repeatDays)) {
    updated.repeatDays = patch.repeatDays.filter((d) => d >= 0 && d <= 6);
  }
  updated.nextFireAt = computeNextFire(updated);
  entries[idx] = updated;
  saveEntries(entries);
  return updated;
}

/**
 * Remove an entry.
 * @param {string} id
 */
export function removeEntry(id) {
  const entries = loadEntries().filter((e) => e.id !== id);
  saveEntries(entries);
}

/**
 * Compute the next fire timestamp for an entry.
 * @param {ScheduleEntry} entry
 * @param {Date} [from=new Date()]
 * @returns {string} ISO timestamp
 */
export function computeNextFire(entry, from = new Date()) {
  if (!entry || !entry.enabled) return null;
  const target = new Date(from);
  target.setHours(entry.hour, entry.minute, 0, 0);
  // If today's slot already passed, advance
  if (target <= from) target.setDate(target.getDate() + 1);
  if (entry.repeatDays && entry.repeatDays.length > 0) {
    // Find next weekday that matches
    for (let i = 0; i < 7; i++) {
      const day = target.getDay();
      if (entry.repeatDays.includes(day)) {
        return target.toISOString();
      }
      target.setDate(target.getDate() + 1);
    }
    return null; // shouldn't happen
  }
  return target.toISOString();
}

/**
 * Determine whether an entry should fire "now".
 * @param {ScheduleEntry} entry
 * @param {Date} now
 * @returns {boolean}
 */
export function shouldFireNow(entry, now = new Date()) {
  if (!entry || !entry.enabled) return false;
  if (entry.hour !== now.getHours()) return false;
  if (entry.minute !== now.getMinutes()) return false;
  const todayKey = todayStamp(now);
  if (entry.repeatDays && entry.repeatDays.length > 0) {
    if (!entry.repeatDays.includes(now.getDay())) return false;
  } else {
    // One-shot: fire only once total
    if (entry.lastFired) return false;
  }
  // Already fired today
  if (firedToday.get(entry.id) === todayKey) return false;
  return true;
}

/**
 * Fire an entry (start its session). Returns true if the session actually started.
 * @param {ScheduleEntry} entry
 * @returns {boolean}
 */
export function fireEntry(entry) {
  if (!entry) return false;
  if (typeof SESSION_STATE.start !== "function") return false;
  try {
    SESSION_STATE.start(entry.sessionId);
    log(`Scheduler: "${entry.name}" gestartet.`, "success");
    const now = new Date();
    firedToday.set(entry.id, todayStamp(now));
    // Update lastFired + nextFireAt
    updateEntry(entry.id, {
      lastFired: now.toISOString(),
      nextFireAt: computeNextFire({ ...entry, lastFired: now.toISOString() }, now),
    });
    // Disable one-shot entries after firing
    if (!entry.repeatDays || entry.repeatDays.length === 0) {
      updateEntry(entry.id, { enabled: false });
    }
    return true;
  } catch (err) {
    console.warn(`Scheduler: failed to fire ${entry.id}:`, err);
    return false;
  }
}

/** @returns {string} YYYY-MM-DD for "today" */
function todayStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Tick — call this periodically (every 30s). Iterates enabled entries, fires
 * those whose HH:MM matches now and that haven't fired today.
 */
export function tick() {
  const now = new Date();
  const entries = loadEntries();
  for (const entry of entries) {
    if (shouldFireNow(entry, now)) {
      fireEntry(entry);
    }
  }
}

/**
 * Arm the scheduler tick. Idempotent.
 */
export function armScheduler() {
  if (intervalId) return;
  intervalId = setInterval(tick, TICK_MS);
  // Run once shortly after arm so we don't miss a slot by being slow to boot
  setTimeout(tick, 2000);
}

/**
 * Disarm.
 */
export function disarmScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  armScheduler();
});
