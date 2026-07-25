// remote-commands.test.js — the renderer half of the remote protocol.
//
// Focus: every command must return a result object (the WebSocket layer
// forwards it verbatim to the client) and the safety gates must hold.
// The transport itself is covered in remote-server.test.js.
import "./helpers/dom-mock.js";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AppState } from "../../frontend/js/state.js";
import { handleRemoteCommand } from "../../frontend/js/modules/remote.js";
import { armPanicCooldown, releasePanicCooldown } from "../../frontend/js/modules/safety-extras.js";
import { lock, forceUnlock, setPin } from "../../frontend/js/modules/session-pin.js";

async function baseline() {
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.softLimitA = 150;
  AppState.softLimitB = 150;
  AppState.frequencyA = 45;
  AppState.frequencyB = 45;
  AppState.masterScale = 1;
  AppState.isConnected = false;
  AppState.activePattern = null;
  AppState.patternCeiling = null;
  releasePanicCooldown();
  forceUnlock();
  // The PIN lives in localStorage, which is shared across tests in this process.
  await setPin("");
}

describe("remote commands — result contract", () => {
  beforeEach(baseline);
  afterEach(baseline);

  test("every handler returns an object with a boolean ok", () => {
    const commands = [
      { type: "set_intensity", channel: "A", value: 20 },
      { type: "set_frequency", channel: "A", value: 60 },
      { type: "set_master", value: 80 },
      { type: "stop_all" },
      { type: "stop_pattern" },
      { type: "get_state" },
      { type: "get_patterns" },
      { type: "get_logs" },
      { type: "autodrive_state" },
    ];
    for (const cmd of commands) {
      const res = handleRemoteCommand(cmd);
      assert.equal(typeof res, "object", `${cmd.type} returned ${typeof res}`);
      assert.notEqual(res, null, `${cmd.type} returned null`);
      assert.equal(typeof res.ok, "boolean", `${cmd.type}.ok is not a boolean`);
    }
  });

  test("an unknown command reports the failure instead of returning undefined", () => {
    const res = handleRemoteCommand({ type: "definitely_not_a_command" });
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown command/);
  });

  test("an empty message is handled gracefully", () => {
    const res = handleRemoteCommand({});
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });

  test("get_state returns a full snapshot", () => {
    AppState.strengthA = 33;
    AppState.softLimitB = 90;
    const res = handleRemoteCommand({ type: "get_state" });
    assert.equal(res.ok, true);
    assert.equal(res.state.strengthA, 33);
    assert.equal(res.state.softLimitB, 90);
    for (const key of ["connected", "frequencyA", "activePattern", "masterScale", "outputOwner"]) {
      assert.ok(key in res.state, `state.${key} missing`);
    }
  });

  test("a throwing handler is reported, not propagated", () => {
    // get_logs reads a count off the message; a hostile value must not escape.
    const res = handleRemoteCommand({ type: "get_logs", count: { toString: null } });
    assert.equal(typeof res.ok, "boolean");
  });
});

describe("remote commands — value clamping", () => {
  beforeEach(baseline);
  afterEach(baseline);

  test("set_intensity respects the soft limit", () => {
    AppState.softLimitA = 70;
    handleRemoteCommand({ type: "set_intensity", channel: "A", value: 999 });
    assert.equal(AppState.strengthA, 70);
  });

  test("set_intensity without a channel sets both", () => {
    handleRemoteCommand({ type: "set_intensity", value: 25 });
    assert.equal(AppState.strengthA, 25);
    assert.equal(AppState.strengthB, 25);
  });

  test("set_frequency clamps to the protocol range", () => {
    handleRemoteCommand({ type: "set_frequency", channel: "A", value: 5000 });
    assert.ok(AppState.frequencyA <= 240, `got ${AppState.frequencyA}`);
  });

  test("set_master clamps to 0–100 percent", () => {
    handleRemoteCommand({ type: "set_master", value: 500 });
    assert.equal(AppState.masterScale, 1);
    handleRemoteCommand({ type: "set_master", value: -20 });
    assert.equal(AppState.masterScale, 0);
  });

  test("set_master honours an explicit 0", () => {
    // Regression: `parseInt(0) || 100` made the quietest request the loudest.
    handleRemoteCommand({ type: "set_master", value: 50 });
    assert.equal(AppState.masterScale, 0.5);
    handleRemoteCommand({ type: "set_master", value: 0 });
    assert.equal(AppState.masterScale, 0, "0 % must mean silence, not full scale");
  });

  test("set_master falls back to full scale only for junk input", () => {
    handleRemoteCommand({ type: "set_master", value: "nonsense" });
    assert.equal(AppState.masterScale, 1);
  });

  test("a non-numeric intensity does not leak NaN into state", () => {
    handleRemoteCommand({ type: "set_intensity", channel: "A", value: "hello" });
    assert.ok(Number.isFinite(AppState.strengthA), `got ${AppState.strengthA}`);
  });
});

describe("remote commands — safety gates", () => {
  beforeEach(baseline);
  afterEach(baseline);

  test("panic cooldown blocks state-changing commands", () => {
    armPanicCooldown();
    const res = handleRemoteCommand({ type: "set_intensity", channel: "A", value: 90 });
    assert.equal(res.ok, false);
    assert.match(res.error, /panic cooldown/);
    assert.equal(AppState.strengthA, 0);
  });

  test("panic cooldown still allows stop and read commands", () => {
    armPanicCooldown();
    for (const type of ["stop_all", "get_state", "get_patterns", "get_logs"]) {
      const res = handleRemoteCommand({ type });
      assert.equal(res.ok, true, `${type} must stay available during cooldown`);
    }
  });

  test("a PIN lock blocks state-changing commands", async () => {
    await setPin("4711");
    assert.equal(lock().ok, true, "lock needs a PIN to be set");
    const res = handleRemoteCommand({ type: "set_master", value: 50 });
    assert.equal(res.ok, false);
    assert.match(res.error, /PIN/i);
    forceUnlock();
  });

  test("stop_all remains available while PIN locked", async () => {
    await setPin("4711");
    lock();
    const res = handleRemoteCommand({ type: "stop_all" });
    assert.equal(res.ok, true);
    forceUnlock();
  });

  test("lock is a no-op when no PIN is configured", () => {
    const res = lock();
    assert.equal(res.ok, false);
    assert.match(res.error, /Kein PIN/);
  });

  test("set_custom_pattern refuses while disconnected", () => {
    AppState.isConnected = false;
    const res = handleRemoteCommand({ type: "set_custom_pattern", channelA: [10, 20] });
    assert.equal(res.ok, false);
    assert.match(res.error, /not connected/);
  });

  test("set_custom_pattern clamps and truncates its arrays", () => {
    AppState.isConnected = true;
    const long = new Array(100).fill(500);
    const res = handleRemoteCommand({ type: "set_custom_pattern", channelA: long });
    assert.equal(res.ok, true);
    assert.equal(AppState.aiCustomPatternA.length, 32, "capped at 32 steps");
    assert.ok(
      AppState.aiCustomPatternA.every((v) => v >= 0 && v <= 100),
      "values clamped to 0–100"
    );
  });
});
