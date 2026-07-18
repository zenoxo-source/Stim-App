// remote-server.js - WebSocket remote control server for external tools
// Listens on localhost:8080, accepts JSON commands, forwards to renderer via IPC.

const { WebSocketServer } = require("ws");

const DEFAULT_PORT = 8080;
let wss = null;
let mainWindowRef = null;

function log(msg) {
  console.log(`[remote-server] ${msg}`);
}

function startRemoteServer(mainWindow, port) {
  if (wss) {
    log("already running");
    return { ok: true, port: DEFAULT_PORT, running: true };
  }

  const p = port || DEFAULT_PORT;
  mainWindowRef = mainWindow;

  try {
    wss = new WebSocketServer({ host: "127.0.0.1", port: p });
    log(`listening on ws://127.0.0.1:${p}`);

    wss.on("connection", (ws, req) => {
      const client = req.socket.remoteAddress;
      log(`client connected: ${client}`);

      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
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

    return { ok: true, port: p, running: true };
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
  };
}

// Forward renderer state back to all connected WS clients
function broadcastState(stateJson) {
  if (!wss) return;
  const msg = JSON.stringify({ type: "state", data: stateJson });
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

module.exports = {
  startRemoteServer,
  stopRemoteServer,
  getRemoteStatus,
  broadcastState,
};
