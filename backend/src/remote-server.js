// remote-server.js - WebSocket remote control server for external tools
// Listens on localhost:8080, accepts JSON commands, forwards to renderer via IPC.
// Token-based auth: clients must send ?token=xxx or first message {"auth":"xxx"}.

const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const DEFAULT_PORT = 8080;
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
    wss = new WebSocketServer({ host: "127.0.0.1", port: p });
    log(`listening on ws://127.0.0.1:${p}`);

    wss.on("connection", (ws, req) => {
      const client = req.socket.remoteAddress;

      // Check token from URL query string
      const url = new URL(req.url, "http://localhost");
      const tokenParam = url.searchParams.get("token");

      if (tokenParam !== authToken) {
        // Defer auth to first message
        ws._authed = false;
      } else {
        ws._authed = true;
      }

      log(`client connected: ${client} (authed: ${ws._authed})`);

      ws.on("message", (raw) => {
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
            ws.send(JSON.stringify({ type: "auth_ok" }));
            log(`client authenticated: ${client}`);
            return;
          }
          ws.send(JSON.stringify({ type: "error", message: "authentication required" }));
          return;
        }

        if (!mainWindowRef || mainWindowRef.isDestroyed()) {
          ws.send(JSON.stringify({ type: "error", message: "app not ready" }));
          return;
        }

        // Forward command to renderer
        mainWindowRef.webContents.send("remote-command", msg);
        log(`command: ${msg.type}`);
      });

      ws.on("close", () => log(`client disconnected: ${client}`));
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
