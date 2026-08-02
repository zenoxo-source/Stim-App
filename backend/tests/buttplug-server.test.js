// buttplug-server.test.js — Buttplug.io bridge smoke tests (plain Node).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);

// The `ws` client library drops server->client frames on this platform when
// the machine is under load (loopback segment loss, verified with a minimal
// echo repro). The native WebSocket is unaffected — use it as the test client
// (it emulates real external Buttplug clients anyway). Fall back to `ws` on
// Node versions without the global (CI on older Node).
const WebSocketImpl = globalThis.WebSocket || require("ws").WebSocket;

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
  return new WebSocketImpl(`ws://127.0.0.1:${port}`);
}

/**
 * Persistent message queue per socket. The undici WebSocket delivers several
 * frames in a single task; swapping `onmessage` per expected frame loses
 * frames that arrive in the same task. A persistent handler + queue is the
 * only reliable pattern here.
 */
const queues = new WeakMap();

function queueFor(ws) {
  if (queues.has(ws)) return queues.get(ws);
  const q = [];
  let waiter = null;
  const queue = {
    q,
    push(msg) {
      if (waiter) {
        const w = waiter;
        waiter = null;
        clearTimeout(w.t);
        w.res(msg);
      } else {
        q.push(msg);
      }
    },
    wait(timeoutMs) {
      if (q.length) return Promise.resolve(q.shift());
      return new Promise((res, rej) => {
        const t = setTimeout(() => {
          waiter = null;
          rej(new Error("no message within timeout"));
        }, timeoutMs);
        waiter = { res, t };
      });
    },
  };
  ws.onmessage = (ev) => {
    queue.push(
      typeof ev.data === "string" ? JSON.parse(ev.data) : JSON.parse(ev.data.toString())
    );
  };
  queues.set(ws, queue);
  return queue;
}

function nextMessage(ws, timeoutMs = 8000) {
  return queueFor(ws).wait(timeoutMs);
}

function waitOpen(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("open timeout")), timeoutMs);
    const previous = ws.onopen;
    ws.onopen = () => {
      ws.onopen = previous;
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error("connect error"));
    };
  });
}

/**
 * Warm the connection up via RequestServerInfo. The first server->client
 * frame can occasionally be delayed under load; native WebSocket plus this
 * exchange make the handshake deterministic.
 *
 * @param {number} port
 * @returns {Promise<{ws: InstanceType<typeof WebSocketImpl>, info: object}>}
 */
async function connectReliable(port) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const ws = connect(port);
    try {
      await waitOpen(ws);
      ws.send(JSON.stringify({ Id: 1, Type: "RequestServerInfo" }));
      const info = await nextMessage(ws, 2500);
      if (info.Type === "ServerInfo") return { ws, info };
      ws.close();
    } catch {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error("could not establish a reliable connection");
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

  test("handshake: ServerInfo + DeviceAdded on StartScanning", async () => {
    const { ws, info } = await connectReliable(port);
    assert.equal(info.Type, "ServerInfo");
    assert.equal(info.ServerName, "StimApp");
    assert.equal(info.SpecVersion, "2.0");
    ws.send(JSON.stringify({ Id: 2, Type: "StartScanning" }));
    const first = await nextMessage(ws);
    const second = await nextMessage(ws);
    const msgs = [first, second];
    const ok = msgs.find((m) => m.Type === "Ok");
    const added = msgs.find((m) => m.Type === "DeviceAdded");
    assert.ok(ok, "expected an Ok reply to StartScanning");
    assert.equal(added?.Device?.DeviceName, "StimApp Coyote");
    ws.close();
  });

  test("VibrateCmd maps speed 0..1 to the callback", async () => {
    vibrations.length = 0;
    const { ws } = await connectReliable(port);
    ws.send(JSON.stringify({ Id: 2, Type: "StartScanning" }));
    await nextMessage(ws); // Ok
    await nextMessage(ws); // DeviceAdded
    ws.send(
      JSON.stringify({
        Id: 3,
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
    const { ws } = await connectReliable(port);
    ws.send(JSON.stringify({ Id: 2, Type: "StartScanning" }));
    await nextMessage(ws); // Ok
    await nextMessage(ws); // DeviceAdded
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
