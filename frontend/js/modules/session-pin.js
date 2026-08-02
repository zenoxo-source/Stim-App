// session-pin.js - PIN-based lock for in-session setting changes.
//
// Use-case: a partner locks the controls so the wearer can't disable soft
// limits or change intensity mid-session without consent.
//
// Important safety rule: PANIC + SOFT-STOP are NEVER locked. They override
// the PIN. Safety first.
//
// Storage: PIN is stored as PBKDF2-HMAC-SHA-256 (100k iterations) with a
// per-installation random salt. Format: `pbkdf2$<iterations>$<salt>$<dk>`.
// Legacy SHA-256 hashes (pre-4.2.0) are verified and transparently migrated
// on first successful unlock.

const PIN_KEY = "stim_app_session_pin_v1";
const SALT_KEY = "stim_app_session_pin_salt";
const PBKDF2_ITERATIONS = 100000;
const HASH_BITS = 256;

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

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * PBKDF2-HMAC-SHA-256 derivation via Web Crypto.
 * @param {string} pin
 * @param {string} salt
 * @param {number} iterations
 * @returns {Promise<string>} hex derived key
 */
async function pbkdf2Derive(pin, salt, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(pin || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const dk = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS
  );
  return toHex(dk);
}

/**
 * Hash a PIN with the installation salt. Uses Web Crypto subtle PBKDF2.
 * @param {string} pin
 * @returns {Promise<string>}
 */
export async function hashPin(pin) {
  const salt = getOrCreateSalt();
  if (crypto && crypto.subtle) {
    const dk = await pbkdf2Derive(pin, salt, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${dk}`;
  }
  // Fallback (non-crypto) for very old environments
  let h = 0;
  const str = salt + ":" + pin;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return "weak_" + h.toString(16);
}

/** Legacy pre-4.2.0 SHA-256(salt:pin) — verification + migration only. */
async function legacySha256Hex(pin) {
  const data = new TextEncoder().encode(getOrCreateSalt() + ":" + String(pin || ""));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return toHex(buf);
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
 * Verify a PIN against the stored hash. Legacy SHA-256 hashes are migrated
 * to PBKDF2 on a successful match.
 * @param {string} pin
 * @returns {Promise<boolean>}
 */
export async function verifyPin(pin) {
  try {
    const stored = localStorage.getItem(PIN_KEY);
    if (!stored) return true; // no pin set = always unlocked

    if (stored.startsWith("pbkdf2$")) {
      const [prefix, itersStr, salt, dk] = stored.split("$");
      if (prefix !== "pbkdf2" || !itersStr || !salt || !dk || !(crypto && crypto.subtle)) {
        return false;
      }
      const iterations = parseInt(itersStr, 10);
      if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10000000) {
        return false;
      }
      const candidate = await pbkdf2Derive(pin, salt, iterations);
      return candidate === dk;
    }

    if (stored.startsWith("weak_")) {
      let h = 0;
      const str = getOrCreateSalt() + ":" + pin;
      for (let i = 0; i < str.length; i++) {
        h = (h * 31 + str.charCodeAt(i)) >>> 0;
      }
      return "weak_" + h.toString(16) === stored;
    }

    // Legacy SHA-256 format (pre-4.2.0): verify, then migrate in place.
    const ok = (await legacySha256Hex(pin)) === stored;
    if (ok) {
      try {
        localStorage.setItem(PIN_KEY, await hashPin(pin));
      } catch {
        /* ignore */
      }
    }
    return ok;
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
