// session-pin.js - PIN-based lock for in-session setting changes.
//
// Use-case: a partner locks the controls so the wearer can't disable soft
// limits or change intensity mid-session without consent.
//
// Important safety rule: PANIC + SOFT-STOP are NEVER locked. They override
// the PIN. Safety first.
//
// Storage: PIN is stored as SHA-256(salt + pin). The salt is per-installation
// random. This isn't a strong KDF (use argon2/bcrypt for that), but for a
// local 4-8 digit PIN against a casual attacker it's adequate.

const PIN_KEY = "stim_app_session_pin_v1";
const SALT_KEY = "stim_app_session_pin_salt";

let locked = false;
/** Callbacks fired when lock state changes. */
const listeners = new Set();

/**
 * Generate + persist a per-installation salt.
 * @returns {string}
 */
function getOrCreateSalt() {
  let salt;
  try {
    salt = localStorage.getItem(SALT_KEY);
    if (!salt) {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      salt = Array.from(arr)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      localStorage.setItem(SALT_KEY, salt);
    }
  } catch {
    salt = "fallback-salt-not-stored";
  }
  return salt;
}

/**
 * Hash a PIN with the installation salt. Uses Web Crypto subtle SHA-256.
 * @param {string} pin
 * @returns {Promise<string>}
 */
export async function hashPin(pin) {
  const salt = getOrCreateSalt();
  const data = new TextEncoder().encode(salt + ":" + String(pin || ""));
  if (crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback (non-crypto) for very old environments
  let h = 0;
  const str = salt + ":" + pin;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return "weak_" + h.toString(16);
}

/**
 * Set or change the PIN. Pass empty/null to remove.
 * @param {string} pin plaintext pin (4–32 chars)
 * @returns {{ ok: boolean, error?: string }}
 */
export async function setPin(pin) {
  const p = String(pin || "");
  if (p === "") {
    try {
      localStorage.removeItem(PIN_KEY);
    } catch {
      /* ignore */
    }
    locked = false;
    notifyListeners();
    return { ok: true };
  }
  if (p.length < 4) return { ok: false, error: "PIN muss mindestens 4 Zeichen" };
  if (p.length > 32) return { ok: false, error: "PIN max 32 Zeichen" };
  const hash = await hashPin(p);
  try {
    localStorage.setItem(PIN_KEY, hash);
  } catch {
    /* ignore */
  }
  return { ok: true };
}

/** @returns {boolean} whether a PIN is currently configured. */
export function hasPin() {
  try {
    return !!localStorage.getItem(PIN_KEY);
  } catch {
    return false;
  }
}

/**
 * Verify a PIN against the stored hash.
 * @param {string} pin
 * @returns {Promise<boolean>}
 */
export async function verifyPin(pin) {
  try {
    const stored = localStorage.getItem(PIN_KEY);
    if (!stored) return true; // no pin set = always unlocked
    const hash = await hashPin(String(pin || ""));
    return hash === stored;
  } catch {
    return false;
  }
}

/**
 * Activate the lock. Requires a PIN to be set.
 * @returns {{ ok: boolean, error?: string }}
 */
export function lock() {
  if (!hasPin()) return { ok: false, error: "Kein PIN gesetzt" };
  if (locked) return { ok: true };
  locked = true;
  notifyListeners();
  return { ok: true };
}

/**
 * Try to unlock with the given PIN.
 * @param {string} pin
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function unlock(pin) {
  if (!locked) return { ok: true };
  const ok = await verifyPin(pin);
  if (!ok) return { ok: false, error: "Falscher PIN" };
  locked = false;
  notifyListeners();
  return { ok: true };
}

/** Force-unlock (e.g. via Settings → "Reset PIN" — admin escape hatch). */
export function forceUnlock() {
  if (!locked) return;
  locked = false;
  notifyListeners();
}

/** @returns {boolean} */
export function isLocked() {
  return locked;
}

/**
 * Check whether a setting change should be BLOCKED by the PIN lock.
 * Panic / soft-stop / killAllOutput always bypass this check.
 * @param {string} [label] optional human-readable label for the change
 * @returns {boolean} true if the change must be blocked
 */
export function blockIfLocked(label = "Änderung") {
  if (!locked) return false;
  console.warn(`Settings change blocked by Session-PIN: ${label}`);
  return true;
}

/**
 * Subscribe to lock-state changes.
 * @param {(locked: boolean) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onLockChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn(locked);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Validate PIN strength (basic).
 * @param {string} pin
 * @returns {{ ok: boolean, error?: string, strength: "weak"|"medium"|"strong" }}
 */
export function validatePinStrength(pin) {
  const p = String(pin || "");
  if (p.length < 4) return { ok: false, error: "Mindestens 4 Zeichen", strength: "weak" };
  if (p.length > 32) return { ok: false, error: "Maximal 32 Zeichen", strength: "weak" };
  // All digits + short = weak
  if (/^\d+$/.test(p) && p.length < 6) {
    return { ok: true, strength: "weak" };
  }
  // Mix of letters + digits
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) {
    return { ok: true, strength: "strong" };
  }
  return { ok: true, strength: "medium" };
}
