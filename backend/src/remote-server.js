// remote-server.js - WebSocket remote control server for external tools
// Listens on localhost:8080, accepts JSON commands, forwards to renderer via IPC.
// Token-based auth: clients must send ?token=xxx or first message {"auth":"xxx"}.
//
// Hardening:
// - Binds to 127.0.0.1 only (no remote exposure)
// - Token required within AUTH_TIMEOUT_MS of connection, else dropped
// - Max MAX_CLIENTS concurrent connections
// - Max MAX_MESSAGE_BYTES per frame (defuse memory bombs)
// - Max 5 commands/sec per client (defuse tight-loop attackers)

const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const DEFAULT_PORT = 8080;
const AUTH_TIMEOUT_MS = 5000;
const MAX_CLIENTS = 5;
const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB
const MAX_CMDS_PER_SEC = 5;

let wss = null;
let mainWindowRef = null;
let authToken = null;

function log(msg) {
  console.log(`[remote-server] ${msg}`);
}

function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

function startRemoteServer(mainWindow, port) {
  if (wss) {
    log("already running");
    return { ok: true, port: DEFAULT_PORT, running: true, token: authToken };
  }

  const p = port || DEFAULT_PORT;
  mainWindowRef = mainWindow;
  authToken = generateToken();
  log(`auth token: ${authToken}`);

  try {
    wss = new WebSocketServer({
      host: "127.0.0.1",
      port: p,
      // Reject clients sending oversized frames immediately at protocol level.
      maxPayload: MAX_MESSAGE_BYTES,
    });
    log(`listening on ws://127.0.0.1:${p}`);

    wss.on("connection", (ws, req) => {
      // Hard cap on concurrent clients
      if (wss.clients.size > MAX_CLIENTS) {
        log(`rejecting client: too many connections (${wss.clients.size})`);
        ws.close(1013, "too many connections");
        return;
      }

      const client = req.socket.remoteAddress;

      // Check token from URL query string
      const url = new URL(req.url, "http://localhost");
      const tokenParam = url.searchParams.get("token");

      if (tokenParam !== authToken) {
        // Defer auth to first message; kill the socket if it never comes.
        ws._authed = false;
        ws._authTimer = setTimeout(() => {
          if (!ws._authed) {
            log(`dropping unauthenticated client: ${client} (timeout)`);
            try {
              ws.close(4001, "auth timeout");
            } catch {
              /* ignore */
            }
          }
        }, AUTH_TIMEOUT_MS);
      } else {
        ws._authed = true;
      }

      // Simple sliding-window rate limit (MAX_CMDS_PER_SEC per client).
      ws._cmdTimestamps = [];

      log(`client connected: ${client} (authed: ${ws._authed})`);

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
          ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
          return;
        }

        // First message can be auth
        if (!ws._authed) {
          if (msg.type === "auth" && msg.token === authToken) {
            ws._authed = true;
            if (ws._authTimer) {
              clearTimeout(ws._authTimer);
              ws._authTimer = null;
            }
            ws.send(JSON.stringify({ type: "auth_ok" }));
            log(`client authenticated: ${client}`);
            return;
          }
          ws.send(JSON.stringify({ type: "error", message: "authentication required" }));
          return;
        }

        // Rate limit (auth messages are exempt; commands are limited).
        const now = Date.now();
        ws._cmdTimestamps = ws._cmdTimestamps.filter((t) => now - t < 1000);
        if (ws._cmdTimestamps.length >= MAX_CMDS_PER_SEC) {
          ws.send(JSON.stringify({ type: "error", message: "rate limit exceeded" }));
          return;
        }
        ws._cmdTimestamps.push(now);

        if (!mainWindowRef || mainWindowRef.isDestroyed()) {
          ws.send(JSON.stringify({ type: "error", message: "app not ready" }));
          return;
        }

        // Forward command to renderer
        mainWindowRef.webContents.send("remote-command", msg);
        log(`command: ${msg.type}`);
      });

      ws.on("close", () => {
        if (ws._authTimer) clearTimeout(ws._authTimer);
        log(`client disconnected: ${client}`);
      });
      ws.on("error", (err) => log(`client error: ${err.message}`));
    });

    wss.on("error", (err) => {
      log(`server error: ${err.message}`);
      wss = null;
    });

    return { ok: true, port: p, running: true, token: authToken };
  } catch (err) {
    log(`failed to start: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function stopRemoteServer() {
  if (!wss) return { ok: true, running: false };
  try {
    wss.close();
    wss = null;
    mainWindowRef = null;
    authToken = null;
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
    port: DEFAULT_PORT,
    clients: wss ? wss.clients.size : 0,
    token: authToken,
  };
}

// Forward renderer state back to all connected WS clients
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
  broadcastState,
};
