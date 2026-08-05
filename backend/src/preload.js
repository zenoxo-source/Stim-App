const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isE2E: process.env.STIM_APP_E2E === "1",
  onBeforeClose: (callback) => ipcRenderer.on("app-before-close", callback),
  confirmClose: () => ipcRenderer.send("close-confirmed"),
  preventClose: () => ipcRenderer.send("close-prevented"),
  setConnected: (connected) => ipcRenderer.send("device-connected", connected),
  // Panic from tray / global hotkey (main → renderer).
  onPanic: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("app-panic", handler);
    return () => ipcRenderer.removeListener("app-panic", handler);
  },
  // User-facing notification (device lost, safety timer, …).
  notify: (title, body) => ipcRenderer.send("app-notify", { title, body }),
  // Global media keys (play/pause/next/prev) → STIM player.
  onMediaKey: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on("media-key", handler);
    return () => ipcRenderer.removeListener("media-key", handler);
  },
  // Buttplug.io server (experimental).
  startButtplug: (port) => ipcRenderer.invoke("buttplug:start", port),
  stopButtplug: () => ipcRenderer.invoke("buttplug:stop"),
  getButtplugStatus: () => ipcRenderer.invoke("buttplug:status"),
  onButtplugVibrate: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("buttplug-vibrate", handler);
    return () => ipcRenderer.removeListener("buttplug-vibrate", handler);
  },
  // Buttplug CLIENT (sync external devices).
  connectButtplugClient: (port) => ipcRenderer.invoke("buttplugClient:connect", port),
  disconnectButtplugClient: () => ipcRenderer.invoke("buttplugClient:disconnect"),
  getButtplugClientStatus: () => ipcRenderer.invoke("buttplugClient:status"),
  syncButtplugClient: (speed) => ipcRenderer.send("buttplugClient:vibrate", speed),
  onButtplugClientStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("buttplug-client-status", handler);
    return () => ipcRenderer.removeListener("buttplug-client-status", handler);
  },
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  isPackaged: () => ipcRenderer.invoke("app:isPackaged"),
  getGithubToken: () => ipcRenderer.invoke("secrets:getGithubToken"),
  setGithubToken: (token) => ipcRenderer.invoke("secrets:setGithubToken", token),
  exportLog: (content) => ipcRenderer.invoke("diagnostics:exportLog", content),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  hasUpdateToken: () => ipcRenderer.invoke("updater:hasToken"),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
});
