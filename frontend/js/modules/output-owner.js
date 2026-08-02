// output-owner.js — Session output ownership mutex.
// System writers (wave-loop / safety / emergency) are never claimable owners.
// Since 4.2.0 the ownership check is ALWAYS strict: a conflicting writer that
// does not own the output is hard-blocked (previously flag-gated via
// `outputOwnerStrict`). "manual" (manual sliders) and "master" (master scale
// / pulse width) are user-driven and always allowed — the mutex arbitrates
// between automated output sources, not the user's own hands.

import { AppState, log } from "../state.js";

/** @typedef {"none"|"manual"|"pattern"|"session"|"audio"|"game"|"ramp"|"director"|"autodrive"|"remote"|"midi"|"replay"|"trigger"} OutputOwnerId */
/** @typedef {"wave-loop"|"safety"|"emergency"} SystemWriterId */

/** System writers are never claimable owners. */
const SYSTEM_WRITERS = new Set(["wave-loop", "safety", "emergency"]);
/** Writers that may always write output (system + user-driven controls). */
const ALWAYS_ALLOWED_WRITERS = new Set(["wave-loop", "safety", "emergency", "manual", "master"]);

/** @type {Map<string, () => void>} */
const stopHandlers = new Map();

/**
 * @param {OutputOwnerId | string} ownerId
 * @param {() => void} fn
 */
export function registerOwnerStop(ownerId, fn) {
  if (typeof fn === "function") stopHandlers.set(String(ownerId), fn);
}

/**
 * @param {OutputOwnerId | string} ownerId
 */
export function unregisterOwnerStop(ownerId) {
  stopHandlers.delete(String(ownerId));
}

/** @returns {OutputOwnerId} */
export function getOutputOwner() {
  return /** @type {OutputOwnerId} */ (AppState.outputOwner || "none");
}

/**
 * @param {OutputOwnerId | string} ownerId
 * @param {{ force?: boolean }} [opts]
 * @returns {{ ok: boolean, error?: string, previous?: OutputOwnerId }}
 */
export function claimOutput(ownerId, opts = {}) {
  const id = String(ownerId || "none");
  if (!id || id === "none" || SYSTEM_WRITERS.has(id)) {
    return { ok: false, error: "Invalid owner id" };
  }
  const previous = getOutputOwner();
  if (previous === id) {
    return { ok: true, previous };
  }
  if (previous !== "none") {
    const stop = stopHandlers.get(previous);
    if (typeof stop === "function") {
      try {
        stop();
      } catch (err) {
        console.warn("output-owner stop-hook failed:", previous, err);
      }
    }
  }
  AppState.outputOwner = id;
  if (previous !== "none") {
    log(`Output-Owner: ${previous} → ${id}`, "info");
  }
  return { ok: true, previous };
}

/**
 * @param {OutputOwnerId | string} ownerId
 * @returns {boolean}
 */
export function releaseOutput(ownerId) {
  const id = String(ownerId || "");
  if (getOutputOwner() !== id) return false;
  AppState.outputOwner = "none";
  return true;
}

/**
 * Panic / killAll / signal-loss — always succeeds.
 * @param {string} [reason]
 */
export function forceReleaseAll(reason = "force") {
  for (const [ownerId, stop] of stopHandlers.entries()) {
    try {
      stop();
    } catch (err) {
      console.warn("forceReleaseAll stop failed:", ownerId, err);
    }
  }
  AppState.outputOwner = "none";
  if (reason && reason !== "force") {
    try {
      log(`Output-Owner freigegeben (${reason})`, "info");
    } catch {
      /* ignore */
    }
  }
}

/**
 * Soft log-only or hard reject depending on policy.
 * @param {OutputOwnerId | SystemWriterId | "external" | string} writerId
 * @param {{ kind: "strength"|"wave" }} opts
 * @returns {boolean} true if write allowed
 */
export function assertCanWrite(writerId, opts = { kind: "strength" }) {
  const writer = String(writerId || "external");
  const owner = getOutputOwner();
  const kind = opts?.kind || "strength";

  if (ALWAYS_ALLOWED_WRITERS.has(writer)) return true;
  if (owner === "none") return true;
  if (writer === owner) return true;

  // Hard reject: the current owner exclusively controls the output.
  log(`Schreibblock (Owner ${owner}): ${writer} / ${kind}`, "warning");
  return false;
}

/**
 * Human-readable owner labels for status UI.
 * @returns {string|null} null → use legacy heuristics
 */
export function getOwnerLabel() {
  const owner = getOutputOwner();
  switch (owner) {
    case "none":
      return null;
    case "autodrive":
      return "Autodrive";
    case "ramp":
      return "Ramp";
    case "director":
      return "Director";
    case "session":
      return "Session";
    case "pattern":
      return AppState.activePattern ? String(AppState.activePattern) : "Pattern";
    case "audio":
      return "STIM";
    case "game":
      return "Game";
    case "manual":
      return "Direkt";
    case "remote":
      return "Remote";
    case "midi":
      return "MIDI";
    case "replay":
      return "Replay";
    case "trigger":
      return "Trigger";
    default:
      return String(owner);
  }
}
