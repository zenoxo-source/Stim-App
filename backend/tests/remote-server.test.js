// remote-server.test.js — end-to-end tests against a real WebSocketServer.
//
// Unlike the frontend tests these do not need dom-mock: remote-server.js is
// plain Node. A fake BrowserWindow captures what would be sent to the renderer.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import net from "node:net";
import http from "node:http";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const {
  startRemoteServer,
  stopRemoteServer,
  getRemoteStatus,
  handleRendererResponse,
  broadcastState,
} = require("../src/remote-server.js");

/** Commands the fake renderer received, newest last. */
let forwarded = [];

const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, payload) => {
      if (channel === "remote-command") forwarded.push(payload);
    },
  },
};

/** Grab a port the OS says is free, to avoid clashing with a real instance. */
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

function connect(port, token) {
  const suffix = token === undefined ? "" : `?token=${token}`;
  return new WebSocket(`ws://127.0.0.1:${port}${suffix}`);
}

/** Resolve with the next parsed message, or reject on timeout. */
function nextMessage(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message within timeout")), timeoutMs);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

function waitOpen(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("open timeout")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Wait until the renderer has been handed a command. */
async function waitForward(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (forwarded.length === 0) {
    if (Date.now() > deadline) throw new Error("command never reached renderer");
    await new Promise((r) => setTimeout(r, 10));
  }
  return forwarded[forwarded.length - 1];
}

describe("remote-server — startup", () => {
  afterEach(() => stopRemoteServer());

  test("reports the port it actually bound to", async () => {
    const port = await freePort();
    const res = await startRemoteServer(fakeWindow, port);
    assert.equal(res.ok, true);
    assert.equal(res.port, port);
    assert.match(res.token, /^[0-9a-f]{32}$/);
  });

  test("getRemoteStatus reflects the real port, not the default", async () => {
    const port = await freePort();
    assert.notEqual(port, 8080, "test needs a non-default port");
    await startRemoteServer(fakeWindow, port);
    const status = getRemoteStatus();
    assert.equal(status.running, true);
    assert.equal(status.port, port);
  });

  test("a port conflict resolves to ok:false instead of a phantom success", async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    try {
      const res = await startRemoteServer(fakeWindow, port);
      assert.equal(res.ok, false);
      assert.match(res.error, /EADDRINUSE/i);
      assert.equal(getRemoteStatus().running, false);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  test("status after stop is clean", async () => {
    const port = await freePort();
    await startRemoteServer(fakeWindow, port);
    stopRemoteServer();
    const status = getRemoteStatus();
    assert.equal(status.running, false);
    assert.equal(status.port, null);
    assert.equal(status.token, null);
  });
});

describe("remote-server — auth", () => {
  let port;
  let token;

  before(async () => {
    port = await freePort();
    const res = await startRemoteServer(fakeWindow, port);
    token = res.token;
  });

  after(() => stopRemoteServer());
  afterEach(() => {
    forwarded = [];
  });

  test("rejects a handshake carrying a cross-origin header (random web page)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`, {
      origin: "https://evil.example",
    });
    await assert.rejects(waitOpen(ws), /401|unexpected server response/i);
  });

  test("accepts a same-origin handshake (bundled mobile control page)", async () => {
    // Browsers always send an Origin header — even same-origin. The control
    // page served at GET / connects with Origin == its own host, which must
    // pass verifyClient; the token still authenticates the commands.
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`, {
      origin: `http://127.0.0.1:${port}`,
    });
    await waitOpen(ws);
    ws.send(JSON.stringify({ id: 9, type: "get_state" }));
    const cmd = await waitForward();
    assert.equal(cmd.type, "get_state");
    ws.close();
  });

  test("a wrong token cannot issue commands", async () => {
    const ws = connect(port, "deadbeef".repeat(4));
    await waitOpen(ws);
    ws.send(JSON.stringify({ id: 1, type: "get_state" }));
    const reply = await nextMessage(ws);
    assert.equal(reply.type, "error");
    assert.match(reply.message, /authentication required/);
    assert.equal(forwarded.length, 0, "unauthenticated command must not reach the renderer");
    ws.close();
  });

  test("a token of the wrong length is rejected without throwing", async () => {
    // Guards the constant-time comparison: timingSafeEqual throws on length
    // mismatch, so tokenMatches must short-circuit first.
    const ws = connect(port, "short");
    await waitOpen(ws);
    ws.send(JSON.stringify({ type: "get_state" }));
    const reply = await nextMessage(ws);
    assert.equal(reply.type, "error");
    ws.close();
  });

  test("auth via first message works", async () => {
    const ws = connect(port, undefined);
    await waitOpen(ws);
    ws.send(JSON.stringify({ id: "a1", type: "auth", token }));
    const reply = await nextMessage(ws);
    assert.equal(reply.type, "auth_ok");
    assert.equal(reply.id, "a1");
    ws.close();
  });

  test("a valid token in the URL authenticates immediately", async () => {
    const ws = connect(port, token);
    await waitOpen(ws);
    ws.send(JSON.stringify({ id: 7, type: "get_state" }));
    const cmd = await waitForward();
    assert.equal(cmd.type, "get_state");
    assert.ok(cmd.__reqId, "renderer needs a correlation id to reply with");
    ws.close();
  });
});

describe("remote-server — response routing", () => {
  let port;
  let token;
  let ws;

  before(async () => {
    port = await freePort();
    const res = await startRemoteServer(fakeWindow, port);
    token = res.token;
  });

  after(() => stopRemoteServer());

  afterEach(() => {
    forwarded = [];
    if (ws && ws.readyState === 1) ws.close();
  });

  test("a renderer result reaches the client that asked", async () => {
    ws = connect(port, token);
    await waitOpen(ws);
    ws.send(JSON.stringify({ id: 42, type: "get_state" }));

    const cmd = await waitForward();
    handleRendererResponse({
      __reqId: cmd.__reqId,
      result: { ok: true, state: { strengthA: 30 } },
    });

    const reply = await nextMessage(ws);
    assert.equal(reply.type, "response");
    assert.equal(reply.id, "42", "client id is echoed back for correlation");
    assert.equal(reply.command, "get_state");
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.state, { strengthA: 30 });
  });

  test("an error result is forwarded verbatim", async () => {
    ws = connect(port, token);
    await waitOpen(ws);
    ws.send(JSON.stringify({ id: 43, type: "set_master", value: 50 }));

    const cmd = await waitForward();
    handleRendererResponse({
      __reqId: cmd.__reqId,
      result: { ok: false, error: "panic cooldown active" },
    });

    const reply = await nextMessage(ws);
    assert.equal(reply.ok, false);
    assert.equal(reply.error, "panic cooldown active");
  });

  test("an unknown correlation id is ignored, not crashed on", () => {
    assert.doesNotThrow(() => handleRendererResponse({ __reqId: "nope", result: { ok: true } }));
    assert.doesNotThrow(() => handleRendererResponse({}));
    assert.doesNotThrow(() => handleRendererResponse(null));
  });

  test("broadcastState pushes to authenticated clients", async () => {
    ws = connect(port, token);
    await waitOpen(ws);
    // Give the server a tick to mark the socket authenticated.
    await new Promise((r) => setTimeout(r, 50));

    broadcastState({ strengthA: 12, strengthB: 0 });
    const push = await nextMessage(ws);
    assert.equal(push.type, "state");
    assert.deepEqual(push.data, { strengthA: 12, strengthB: 0 });
  });
});

describe("remote-server — limits", () => {
  let port;
  let token;

  before(async () => {
    port = await freePort();
    const res = await startRemoteServer(fakeWindow, port);
    token = res.token;
  });

  after(() => stopRemoteServer());
  afterEach(() => {
    forwarded = [];
  });

  test("invalid JSON gets an error, not a crash", async () => {
    const ws = connect(port, token);
    await waitOpen(ws);
    ws.send("{not json");
    const reply = await nextMessage(ws);
    assert.equal(reply.type, "error");
    assert.match(reply.message, /invalid JSON/);
    ws.close();
  });

  test("more than 5 commands per second are rate limited", async () => {
    const ws = connect(port, token);
    await waitOpen(ws);
    const replies = [];
    ws.on("message", (raw) => replies.push(JSON.parse(raw.toString())));

    for (let i = 0; i < 8; i++) {
      ws.send(JSON.stringify({ id: i, type: "get_state" }));
    }
    await new Promise((r) => setTimeout(r, 200));

    const limited = replies.filter((m) => m.type === "error" && /rate limit/.test(m.message));
    assert.ok(limited.length >= 3, `expected ≥3 rate-limit errors, got ${limited.length}`);
    assert.ok(forwarded.length <= 5, `only 5 commands may reach the renderer, got ${forwarded.length}`);
    ws.close();
  });
});

describe("remote-server — mobile control page (F9)", () => {
  afterEach(() => stopRemoteServer());

  test("GET / serves the control page HTML", async () => {
    const port = await freePort();
    const res = await startRemoteServer(fakeWindow, port);
    assert.equal(res.ok, true);
    const body = await new Promise((resolve, reject) => {
      httpGet(port, (err, text) => (err ? reject(err) : resolve(text)));
    });
    assert.match(body, /Stim App Remote/);
    assert.match(body, /new WebSocket/);
  });

  test("start accepts a lan option", async () => {
    const port = await freePort();
    const res = await startRemoteServer(fakeWindow, port, { lan: true });
    assert.equal(res.ok, true);
    assert.equal(res.lan, true);
  });
});

function httpGet(port, cb) {
  const req = http.get({ host: "127.0.0.1", port, path: "/" }, (r) => {
    let data = "";
    r.on("data", (c) => (data += c));
    r.on("end", () => cb(null, data));
  });
  req.on("error", (err) => cb(err));
}
