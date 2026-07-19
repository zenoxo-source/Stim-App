/**
 * Tests for session-pin.js - hashing, lock state, validation.
 *
 * Note: SHA-256 hashing uses Web Crypto subtle API which IS available in Node 18+.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  hashPin,
  setPin,
  hasPin,
  verifyPin,
  lock,
  unlock,
  forceUnlock,
  isLocked,
  blockIfLocked,
  onLockChange,
  validatePinStrength,
} from "../../frontend/js/modules/session-pin.js";

beforeEach(async () => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  forceUnlock();
});

describe("session-pin.js - hashPin", () => {
  it("returns a deterministic hex string", async () => {
    const h1 = await hashPin("1234");
    const h2 = await hashPin("1234");
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]+$/);
    assert.ok(h1.length >= 32);
  });

  it("different inputs → different hashes", async () => {
    const h1 = await hashPin("1234");
    const h2 = await hashPin("5678");
    assert.notEqual(h1, h2);
  });
});

describe("session-pin.js - setPin + verifyPin", () => {
  it("setPin with valid PIN", async () => {
    const r = await setPin("1234");
    assert.equal(r.ok, true);
    assert.equal(hasPin(), true);
  });

  it("setPin rejects short PIN", async () => {
    const r = await setPin("123");
    assert.equal(r.ok, false);
    assert.match(r.error, /4 Zeichen/);
  });

  it("setPin rejects too-long PIN", async () => {
    const r = await setPin("x".repeat(33));
    assert.equal(r.ok, false);
  });

  it("setPin('') removes PIN", async () => {
    await setPin("1234");
    const r = await setPin("");
    assert.equal(r.ok, true);
    assert.equal(hasPin(), false);
  });

  it("verifyPin accepts correct PIN", async () => {
    await setPin("abcd1234");
    const ok = await verifyPin("abcd1234");
    assert.equal(ok, true);
  });

  it("verifyPin rejects wrong PIN", async () => {
    await setPin("abcd1234");
    const ok = await verifyPin("wrong");
    assert.equal(ok, false);
  });

  it("verifyPin returns true when no PIN set", async () => {
    assert.equal(hasPin(), false);
    const ok = await verifyPin("anything");
    assert.equal(ok, true);
  });
});

describe("session-pin.js - lock/unlock", () => {
  it("lock requires a PIN to be set", () => {
    assert.equal(hasPin(), false);
    const r = lock();
    assert.equal(r.ok, false);
    assert.match(r.error, /Kein PIN/);
  });

  it("lock + isLocked", async () => {
    await setPin("1234");
    const r = lock();
    assert.equal(r.ok, true);
    assert.equal(isLocked(), true);
  });

  it("unlock with correct PIN", async () => {
    await setPin("1234");
    lock();
    const r = await unlock("1234");
    assert.equal(r.ok, true);
    assert.equal(isLocked(), false);
  });

  it("unlock with wrong PIN fails", async () => {
    await setPin("1234");
    lock();
    const r = await unlock("wrong");
    assert.equal(r.ok, false);
    assert.match(r.error, /Falscher PIN/);
    assert.equal(isLocked(), true);
  });

  it("unlock when not locked is no-op success", async () => {
    await setPin("1234");
    // Don't lock
    const r = await unlock("anything");
    assert.equal(r.ok, true);
  });

  it("forceUnlock always unlocks", async () => {
    await setPin("1234");
    lock();
    forceUnlock();
    assert.equal(isLocked(), false);
  });

  it("lock is idempotent", async () => {
    await setPin("1234");
    lock();
    const r = lock();
    assert.equal(r.ok, true);
  });
});

describe("session-pin.js - blockIfLocked", () => {
  it("returns false when unlocked", () => {
    assert.equal(blockIfLocked("test"), false);
  });

  it("returns true when locked", async () => {
    await setPin("1234");
    lock();
    assert.equal(blockIfLocked("test"), true);
  });
});

describe("session-pin.js - onLockChange", () => {
  it("fires when locked", async () => {
    await setPin("1234");
    let fired = false;
    onLockChange((locked) => {
      fired = true;
      assert.equal(locked, true);
    });
    lock();
    assert.equal(fired, true);
  });

  it("fires when unlocked", async () => {
    await setPin("1234");
    lock();
    let fired = false;
    onLockChange((locked) => {
      fired = true;
      assert.equal(locked, false);
    });
    await unlock("1234");
    assert.equal(fired, true);
  });

  it("unsubscribe stops notifications", async () => {
    await setPin("1234");
    let count = 0;
    const unsub = onLockChange(() => count++);
    lock();
    unsub();
    await unlock("1234");
    // count is 1 (from lock); unlock shouldn't fire
    assert.equal(count, 1);
  });
});

describe("session-pin.js - validatePinStrength", () => {
  it("weak: short digits-only", () => {
    const r = validatePinStrength("1234");
    assert.equal(r.ok, true);
    assert.equal(r.strength, "weak");
  });

  it("medium: longer digits or letters only", () => {
    const r = validatePinStrength("123456");
    assert.equal(r.ok, true);
    assert.equal(r.strength, "medium");
  });

  it("strong: mix of letters + digits", () => {
    const r = validatePinStrength("abc123");
    assert.equal(r.ok, true);
    assert.equal(r.strength, "strong");
  });

  it("rejects < 4 chars", () => {
    const r = validatePinStrength("12");
    assert.equal(r.ok, false);
  });
});
