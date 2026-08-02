// buttplug-server.test.js — Buttplug.io bridge smoke tests (plain Node).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const {
  startButtplugServer,
  stopButtplugServer,
  getButtplugStatus,
} = require("../src/buttplug-server.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function connect(port) {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function nextMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no message within timeout")), timeoutMs);
    ws.once("message", (raw) => {
      clearTimeout(t);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

function waitOpen(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("open timeout")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.once("error", reject);
  });
}

describe("buttplug-server", () => {
  let port;
  let vibrations = [];

  before(async () => {
    port = await freePort();
    const r = await startButtplugServer(port, (speed) => vibrations.push(speed));
    assert.equal(r.ok, true);
  });

  after(() => stopButtplugServer());

  test("handshake: ServerInfo + DeviceAdded", async () => {
    const ws = connect(port);
    await waitOpen(ws);
    const added = await nextMessage(ws);
    assert.equal(added.Type, "DeviceAdded");
    assert.equal(added.Device.DeviceName, "StimApp Coyote");
    ws.send(JSON.stringify({ Id: 1, Type: "RequestServerInfo" }));
    const info = await nextMessage(ws);
    assert.equal(info.Type, "ServerInfo");
    assert.equal(info.ServerName, "StimApp");
    assert.equal(info.SpecVersion, "2.0");
    ws.close();
  });

  test("VibrateCmd maps speed 0..1 to the callback", async () => {
    vibrations.length = 0;
    const ws = connect(port);
    await waitOpen(ws);
    await nextMessage(ws); // DeviceAdded
    ws.send(
      JSON.stringify({
        Id: 2,
        Type: "DeviceMessage",
        DeviceIndex: 0,
        DeviceMessageType: "VibrateCmd",
        Params: { Speeds: [{ Index: 0, Speed: 0.42 }] },
      })
    );
    const resp = await nextMessage(ws);
    assert.equal(resp.Type, "DeviceMessage");
    assert.equal(vibrations.length, 1);
    assert.ok(Math.abs(vibrations[0] - 0.42) < 0.001);
    ws.close();
  });

  test("StopAllDevices zeroes output", async () => {
    vibrations.length = 0;
    const ws = connect(port);
    await waitOpen(ws);
    await nextMessage(ws);
    ws.send(JSON.stringify({ Id: 3, Type: "StopAllDevices" }));
    await nextMessage(ws); // Ok
    assert.equal(vibrations.at(-1), 0);
    ws.close();
  });

  test("status reflects running state", () => {
    const s = getButtplugStatus();
    assert.equal(s.running, true);
    assert.equal(s.port, port);
  });
});
