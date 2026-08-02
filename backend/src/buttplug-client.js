// buttplug-client.js — connect to a Buttplug server (e.g. Intiface Central)
// as a CLIENT and drive discovered devices in sync with the stim output.
//
// Complementary to buttplug-server.js: instead of accepting external clients,
// this reaches OUT to a Buttplug server and sends VibrateCmd to any
// discovered device (Lovense, TheHandy, …). Speeds come from the renderer
// (normalized stim strength) and are forwarded to device index 0.

const { WebSocket: WsFallback } = require("ws");
// Native WebSocket is used when available: the `ws` client library has been
// observed to drop server->client frames under load on Windows (loopback
// segment loss), while the native implementation stays reliable.
const WebSocketImpl = globalThis.WebSocket || WsFallback;

const MAX_MESSAGE_BYTES = 64 * 1024;

let ws = null;
let connected = false;
let devices = [];
let deviceSeq = 0;
let serverName = "";
let statusCallback = null;
let manualClose = false;

function log(msg) {
  console.log(`[buttplug-client] ${msg}`);
}

function send(payload) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (e) {
    log(`send failed: ${e.message}`);
  }
}

function emitStatus() {
  if (typeof statusCallback === "function") {
    try {
      statusCallback({ connected, devices: devices.map((d) => d.DeviceName), serverName });
    } catch (e) {
      /* ignore */
    }
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.Type) {
    case "ServerInfo":
      serverName = msg.ServerName || "";
      log(`connected to ${serverName} (spec ${msg.SpecVersion || "?"})`);
      // Request the device list and enable scanning.
      send({ Id: 2, Type: "RequestDeviceList" });
      send({ Id: 3, Type: "StartScanning" });
      break;
    case "DeviceList":
      devices = Array.isArray(msg.Devices) ? msg.Devices : [];
      emitStatus();
      break;
    case "DeviceAdded":
      if (msg.Device && !devices.some((d) => d.DeviceIndex === msg.Device.DeviceIndex)) {
        devices.push(msg.Device);
        log(`device added: ${msg.Device.DeviceName}`);
        emitStatus();
      }
      break;
    case "DeviceRemoved":
      devices = devices.filter((d) => d.DeviceIndex !== msg.DeviceIndex);
      emitStatus();
      break;
    case "ScanningFinished":
      break;
    default:
      break;
  }
}

/**
 * Connect to a Buttplug server.
 * @param {number} port
 * @param {(status: {connected: boolean, devices: string[], serverName: string}) => void} onStatus
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function connectButtplugClient(port, onStatus) {
  statusCallback = onStatus;
  const p = Number(port) || 12345;
  if (ws) disconnectButtplugClient();
  manualClose = false;

  return new Promise((resolve) => {
    try {
      ws = new WebSocketImpl(`ws://127.0.0.1:${p}`);
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    let settled = false;
    ws.addEventListener("open", () => {
      connected = true;
      log(`connected to ws://127.0.0.1:${p}`);
      send({ Id: 1, Type: "RequestServerInfo", ClientName: "StimApp", MessageVersion: 2 });
      emitStatus();
      if (!settled) {
        settled = true;
        resolve({ ok: true });
      }
    });
    ws.addEventListener("message", (ev) => {
      const raw = ev.data;
      if (!raw || raw.length > MAX_MESSAGE_BYTES) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleMessage(msg);
    });
    ws.addEventListener("error", (err) => {
      log(`error: ${err.message || "connection failed"}`);
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: err.message || "connection failed" });
      }
    });
    ws.addEventListener("close", () => {
      connected = false;
      devices = [];
      log("disconnected");
      if (!manualClose) {
        // Auto-reconnect every 5 s while the user keeps it enabled.
        setTimeout(() => {
          if (!manualClose) connectButtplugClient(p, statusCallback);
        }, 5000);
      }
      emitStatus();
    });
  });
}

/** Send a vibration speed (0..1) to the first discovered device. */
function syncVibrate(speed) {
  if (!connected || devices.length === 0) return false;
  const s = Math.max(0, Math.min(1, Number(speed) || 0));
  send({
    Id: 100 + (++deviceSeq % 1000),
    Type: "DeviceMessage",
    DeviceIndex: devices[0].DeviceIndex,
    DeviceMessageType: "VibrateCmd",
    Params: { Speeds: [{ Index: 0, Speed: s }] },
  });
  return true;
}

function disconnectButtplugClient() {
  manualClose = true;
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      /* ignore */
    }
  }
  ws = null;
  connected = false;
  devices = [];
  emitStatus();
}

function getButtplugClientStatus() {
  return { connected, devices: devices.map((d) => d.DeviceName), serverName };
}

module.exports = {
  connectButtplugClient,
  disconnectButtplugClient,
  getButtplugClientStatus,
  syncVibrate,
};
