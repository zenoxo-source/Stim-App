// remote-server.js - WebSocket remote control server for external tools
// Listens on localhost:8080, accepts JSON commands, forwards to renderer via IPC,
// and routes the renderer's result back to the requesting client.
//
// Token-based auth: clients must send ?token=xxx or first message {"type":"auth","token":"xxx"}.
//
// Hardening:
// - Binds to 127.0.0.1 only (no remote exposure)
// - Rejects any handshake carrying an Origin header (browsers always send one;
//   native clients do not) so a random web page cannot reach the device
// - Constant-time token comparison
// - Token required within AUTH_TIMEOUT_MS of connection, else dropped
// - Max MAX_CLIENTS concurrent connections
// - Max MAX_MESSAGE_BYTES per frame (defuse memory bombs)
// - Max MAX_CMDS_PER_SEC commands/sec per client (defuse tight-loop attackers)

const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const DEFAULT_PORT = 8080;
const AUTH_TIMEOUT_MS = 5000;
const MAX_CLIENTS = 5;
const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB
const MAX_CMDS_PER_SEC = 5;
/** Renderer must answer a forwarded command within this window. */
const RESPONSE_TIMEOUT_MS = 5000;

let wss = null;
let mainWindowRef = null;
let authToken = null;
/** Port we are actually listening on (may differ from DEFAULT_PORT). */
let activePort = null;
/** clientId -> ws, so renderer responses can be routed back to one socket. */
const clients = new Map();
/** reqId -> { clientId, timer } for in-flight renderer round-trips. */
const pending = new Map();
let clientSeq = 0;
let reqSeq = 0;

function log(msg) {
  console.log(`[remote-server] ${msg}`);
}

function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Constant-time token comparison. Length mismatch short-circuits — the token
 * length is fixed and public, so that leaks nothing.
 * @param {unknown} candidate
 * @returns {boolean}
 */
function tokenMatches(candidate) {
  if (typeof candidate !== "string" || !authToken) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(authToken, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function send(ws, payload) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    log(`send failed: ${err.message}`);
  }
}

/**
 * Start the WebSocket server. Resolves only once the socket is actually
 * listening, so a port conflict surfaces as { ok: false } instead of a
 * success that is contradicted by a later 'error' event.
 *
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {number} [port]
 * @returns {Promise<{ok: boolean, port?: number, running?: boolean, token?: string, error?: string}>}
 */
function startRemoteServer(mainWindow, port) {
  if (wss) {
    log("already running");
    return Promise.resolve({ ok: true, port: activePort, running: true, token: authToken });
  }

  const p = port || DEFAULT_PORT;
  mainWindowRef = mainWindow;
  authToken = generateToken();

  return new Promise((resolve) => {
    let settled = false;
    let server;

    try {
      server = new WebSocketServer({
        host: "127.0.0.1",
        port: p,
        // Reject clients sending oversized frames immediately at protocol level.
        maxPayload: MAX_MESSAGE_BYTES,
        // Browsers always send Origin; wscat/websockets/python clients do not.
        // WebSockets are exempt from the same-origin policy, so this is the only
        // thing standing between a visited web page and the handshake.
        verifyClient: ({ origin }) => {
          if (origin) {
            log(`rejecting handshake with Origin: ${origin}`);
            return false;
          }
          return true;
        },
      });
    } catch (err) {
      log(`failed to start: ${err.message}`);
      authToken = null;
      mainWindowRef = null;
      resolve({ ok: false, error: err.message });
      return;
    }

    server.on("listening", () => {
      wss = server;
      activePort = server.address()?.port || p;
      settled = true;
      log(`listening on ws://127.0.0.1:${activePort}`);
      resolve({ ok: true, port: activePort, running: true, token: authToken });
    });

    server.on("error", (err) => {
      log(`server error: ${err.message}`);
      if (!settled) {
        // Startup failure (EADDRINUSE, EACCES, …) — report it to the caller.
        settled = true;
        authToken = null;
        mainWindowRef = null;
        activePort = null;
        try {
          server.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, error: err.message });
        return;
      }
      // Runtime failure after a successful start — tear down so the UI can
      // show "gestoppt" instead of a phantom running server.
      teardown();
    });

    server.on("connection", (ws, req) => {
      // Hard cap on concurrent clients
      if (server.clients.size > MAX_CLIENTS) {
        log(`rejecting client: too many connections (${server.clients.size})`);
        ws.close(1013, "too many connections");
        return;
      }

      const peer = req.socket.remoteAddress;
      const clientId = `c${++clientSeq}`;
      ws._clientId = clientId;
      clients.set(clientId, ws);

      // Check token from URL query string
      const url = new URL(req.url, "http://localhost");
      ws._authed = tokenMatches(url.searchParams.get("token"));

      if (!ws._authed) {
        // Defer auth to first message; kill the socket if it never comes.
        ws._authTimer = setTimeout(() => {
          if (!ws._authed) {
            log(`dropping unauthenticated client: ${peer} (timeout)`);
            try {
              ws.close(4001, "auth timeout");
            } catch {
              /* ignore */
            }
          }
        }, AUTH_TIMEOUT_MS);
      }

      // Simple sliding-window rate limit (MAX_CMDS_PER_SEC per client).
      ws._cmdTimestamps = [];

      log(`client connected: ${peer} (authed: ${ws._authed})`);

      ws.on("message", (raw) => {
        // Re-check frame size even though maxPayload should enforce it.
        if (raw.length > MAX_MESSAGE_BYTES) {
          ws.send(JSON.stringify({ type: "error", message: "message too large" }), () =>
            ws.close(1009, "too big")
          );
          return;
        }

        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          send(ws, { type: "error", message: "invalid JSON" });
          return;
        }

        // Echo the caller's correlation id on every reply so clients can await
        // a specific command instead of guessing which frame belongs to them.
        const reqId = msg && msg.id !== undefined ? String(msg.id) : null;

        // First message can be auth
        if (!ws._authed) {
          if (msg.type === "auth" && tokenMatches(msg.token)) {
            ws._authed = true;
            if (ws._authTimer) {
              clearTimeout(ws._authTimer);
              ws._authTimer = null;
            }
            send(ws, { type: "auth_ok", id: reqId });
            log(`client authenticated: ${peer}`);
            return;
          }
          send(ws, { type: "error", message: "authentication required", id: reqId });
          return;
        }

        // Rate limit (auth messages are exempt; commands are limited).
        const now = Date.now();
        ws._cmdTimestamps = ws._cmdTimestamps.filter((t) => now - t < 1000);
        if (ws._cmdTimestamps.length >= MAX_CMDS_PER_SEC) {
          send(ws, { type: "error", message: "rate limit exceeded", id: reqId });
          return;
        }
        ws._cmdTimestamps.push(now);

        if (!mainWindowRef || mainWindowRef.isDestroyed()) {
          send(ws, { type: "error", message: "app not ready", id: reqId });
          return;
        }

        // Forward command to renderer with routing metadata. The renderer echoes
        // __reqId back on remote:response; see handleRendererResponse.
        const internalId = `r${++reqSeq}`;
        const timer = setTimeout(() => {
          pending.delete(internalId);
          send(ws, {
            type: "response",
            id: reqId,
            command: msg.type,
            ok: false,
            error: "renderer timeout",
          });
        }, RESPONSE_TIMEOUT_MS);
        pending.set(internalId, { clientId, reqId, command: msg.type, timer });

        mainWindowRef.webContents.send("remote-command", { ...msg, __reqId: internalId });
        log(`command: ${msg.type}`);
      });

      ws.on("close", () => {
        if (ws._authTimer) clearTimeout(ws._authTimer);
        clients.delete(clientId);
        log(`client disconnected: ${peer}`);
      });
      ws.on("error", (err) => log(`client error: ${err.message}`));
    });
  });
}

/**
 * Route a renderer result back to the socket that issued the command.
 * Called from main.js on the 'remote:response' IPC channel.
 * @param {{__reqId?: string, result?: object}} payload
 */
function handleRendererResponse(payload) {
  const internalId = payload && payload.__reqId;
  if (!internalId) return;
  const entry = pending.get(internalId);
  if (!entry) return; // already timed out
  pending.delete(internalId);
  clearTimeout(entry.timer);

  const ws = clients.get(entry.clientId);
  if (!ws) return;

  const result = payload.result && typeof payload.result === "object" ? payload.result : {};
  send(ws, {
    type: "response",
    id: entry.reqId,
    command: entry.command,
    ...result,
  });
}

function teardown() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  clients.clear();
  wss = null;
  mainWindowRef = null;
  authToken = null;
  activePort = null;
}

function stopRemoteServer() {
  if (!wss) return { ok: true, running: false };
  try {
    wss.close();
    teardown();
    log("stopped");
    return { ok: true, running: false };
  } catch (err) {
    log(`stop error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function getRemoteStatus() {
  return {
    running: wss !== null,
    port: activePort,
    clients: wss ? wss.clients.size : 0,
    token: authToken,
  };
}

/** Push renderer state to all authenticated clients (unsolicited). */
function broadcastState(stateJson) {
  if (!wss) return;
  const msg = JSON.stringify({ type: "state", data: stateJson });
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1 && ws._authed) ws.send(msg);
  });
}

module.exports = {
  startRemoteServer,
  stopRemoteServer,
  getRemoteStatus,
  handleRendererResponse,
  broadcastState,
};
