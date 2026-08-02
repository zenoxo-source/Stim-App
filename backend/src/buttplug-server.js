// buttplug-server.js — minimal Buttplug.io WebSocket server (main process).
//
// Lets Buttplug-capable clients (XToys, Milovana teases, Funscript players,
// VR apps via Intiface Central…) control the connected Coyote as a
// single-motor vibrator device. VibrateCmd speed (0–1) is forwarded to the
// renderer, which maps it to device intensity within soft limits.
//
// Hardening mirrors remote-server.js: 127.0.0.1 only, no Origin handshakes,
// frame size cap, per-client rate limit. Experimental — opt-in via settings.

const { WebSocketServer } = require("ws");
const http = require("http");

const DEFAULT_PORT = 12345;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_MSGS_PER_SEC = 30;

let wss = null;
let httpServer = null;
let activePort = null;
let vibrateCallback = null;

/** @type {Set<import("ws")>} */
const clients = new Set();

function log(msg) {
  console.log(`[buttplug] ${msg}`);
}

function ok(client, id) {
  send(client, { Id: id, Type: "Ok" });
}

function err(client, id, message) {
  send(client, { Id: id, Type: "Error", ErrorCode: "0x10000", ErrorMessage: message });
}

function send(client, payload) {
  if (client.readyState !== 1) return;
  try {
    client.send(JSON.stringify(payload));
  } catch (e) {
    log(`send failed: ${e.message}`);
  }
}

function deviceDescriptor() {
  return {
    DeviceIndex: 0,
    DeviceName: "StimApp Coyote",
    DeviceMessages: { VibrateCmd: { VibratorCount: 1 } },
  };
}

function handleMessage(client, msg) {
  if (!msg || typeof msg !== "object") return;
  const id = Number.isInteger(msg.Id) ? msg.Id : 0;
  switch (msg.Type) {
    case "RequestServerInfo":
      send(client, {
        Id: id,
        Type: "ServerInfo",
        ServerName: "StimApp",
        MessageVersion: 2,
        MaximumPingTime: 60,
        SpecVersion: "2.0",
      });
      break;
    case "Ping":
      send(client, { Id: id, Type: "Pong" });
      break;
    case "RequestDeviceList":
      send(client, { Id: id, Type: "DeviceList", Devices: [deviceDescriptor()] });
      break;
    case "StartScanning":
    case "StopScanning":
      // Spec order: acknowledge the command, then announce the device as an
      // event. Only push DeviceAdded in response to an explicit request —
      // frames sent unrequested right after the handshake race the client's
      // OPEN state and are silently dropped by some ws stacks.
      ok(client, id);
      send(client, { Type: "DeviceAdded", Device: deviceDescriptor() });
      break;
    case "StopAllDevices":
      try {
        vibrateCallback && vibrateCallback(0);
      } catch (e) {
        log(`vibrate callback failed: ${e.message}`);
      }
      ok(client, id);
      break;
    case "StopDeviceCmd":
      try {
        vibrateCallback && vibrateCallback(0);
      } catch (e) {
        log(`vibrate callback failed: ${e.message}`);
      }
      ok(client, id);
      break;
    case "DeviceMessage":
      if (msg.DeviceMessageType === "VibrateCmd" && Array.isArray(msg.Params?.Speeds)) {
        const speed = msg.Params.Speeds[0]?.Speed ?? 0;
        try {
          vibrateCallback && vibrateCallback(Math.max(0, Math.min(1, Number(speed) || 0)));
        } catch (e) {
          log(`vibrate callback failed: ${e.message}`);
        }
      }
      send(client, msg);
      break;
    default:
      err(client, id, `unknown message type: ${msg.Type}`);
  }
}

/**
 * Start the Buttplug server.
 * @param {number} port
 * @param {(speed: number) => void} onVibrate speed 0..1
 * @returns {Promise<{ok: boolean, port?: number, error?: string}>}
 */
function startButtplugServer(port, onVibrate) {
  if (wss) {
    return Promise.resolve({ ok: true, port: activePort });
  }
  const p = Number(port) || DEFAULT_PORT;
  vibrateCallback = onVibrate;

  return new Promise((resolve) => {
    let settled = false;
    httpServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Buttplug.io endpoint — connect with a Buttplug client.");
    });

    wss = new WebSocketServer({
      server: httpServer,
      maxPayload: MAX_MESSAGE_BYTES,
      verifyClient: ({ origin }) => {
        // No browser handshakes — native Buttplug clients only.
        if (origin) {
          log(`rejecting handshake with Origin: ${origin}`);
          return false;
        }
        return true;
      },
    });

    const onError = (err) => {
      log(`server error: ${err.message}`);
      if (!settled) {
        settled = true;
        wss = null;
        try {
          httpServer.close();
        } catch {
          /* ignore */
        }
        httpServer = null;
        resolve({ ok: false, error: err.message });
        return;
      }
      teardown();
    };
    httpServer.on("error", onError);
    wss.on("error", onError);

    wss.on("connection", (client) => {
      if (clients.size >= 5) {
        client.close(1013, "too many clients");
        return;
      }
      clients.add(client);
      const timestamps = [];
      client._rate = timestamps;
      log("buttplug client connected");
      // No unsolicited DeviceAdded here: only push messages in response to
      // client requests (RequestDeviceList / StartScanning). Server-initiated
      // frames at connect time race the client handshake and get dropped.
      client.on("message", (raw) => {
        if (raw.length > MAX_MESSAGE_BYTES) {
          client.close(1009, "too big");
          return;
        }
        const now = Date.now();
        timestamps.push(now);
        while (timestamps.length && now - timestamps[0] > 1000) timestamps.shift();
        if (timestamps.length > MAX_MSGS_PER_SEC) {
          err(client, 0, "rate limit exceeded");
          return;
        }
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          err(client, 0, "invalid JSON");
          return;
        }
        handleMessage(client, msg);
      });
      client.on("close", () => {
        clients.delete(client);
        log("buttplug client disconnected");
      });
      client.on("error", () => clients.delete(client));
    });

    httpServer.listen(p, "127.0.0.1", () => {
      activePort = httpServer.address()?.port || p;
      settled = true;
      log(`listening on ws://127.0.0.1:${activePort}`);
      resolve({ ok: true, port: activePort });
    });
  });
}

function teardown() {
  for (const c of clients) {
    try {
      c.close();
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  wss = null;
  activePort = null;
  vibrateCallback = null;
  if (httpServer) {
    try {
      httpServer.close();
    } catch {
      /* ignore */
    }
    httpServer = null;
  }
}

function stopButtplugServer() {
  if (!wss && !httpServer) return { ok: true, running: false };
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

function getButtplugStatus() {
  return { running: wss !== null, port: activePort, clients: clients.size };
}

module.exports = { startButtplugServer, stopButtplugServer, getButtplugStatus };
