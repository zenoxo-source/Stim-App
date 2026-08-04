const {
  app,
  BrowserWindow,
  session,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  safeStorage,
  dialog,
  globalShortcut,
  Notification,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");
const { runLLMRequest, abortLLM } = require("./llm-proxy");
const { startButtplugServer, stopButtplugServer, getButtplugStatus } = require("./buttplug-server");
const {
  connectButtplugClient,
  disconnectButtplugClient,
  getButtplugClientStatus,
  syncVibrate,
} = require("./buttplug-client");

// Single instance lock (skipped in E2E tests so parallel launches work).
const gotTheLock = process.env.STIM_APP_E2E === "1" ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("Another instance is already running. Exiting...");
  app.quit();
  return;
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let closeFallbackTimer = null;
let bluetoothSelectCallback = null;
let bluetoothSelectTimer = null;
let bluetoothPickerActive = false;
/** Latest scan snapshot for timeout fallbacks (names often fill in late on Windows). */
let lastBluetoothDeviceList = [];
/** True while a Coyote is connected (drives tray status + title). */
let trayConnected = false;

// Windows BLE often needs >15s until the advertised name is populated.
const BLUETOOTH_SELECT_TIMEOUT_MS = 30000;
/** Silent background update checks (no UI unless an update is found). */
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const API_KEY_FILENAME = "ai-api-key.enc";
const GH_UPDATE_TOKEN_FILENAME = "gh-update-token.enc";
const UPDATE_OWNER = "zenoxo-source";
const UPDATE_REPO = "Stim-App";

function secretPath(filename) {
  return path.join(app.getPath("userData"), filename);
}

function readSecretFile(filename) {
  try {
    const keyPath = secretPath(filename);
    if (!fs.existsSync(keyPath)) return "";
    const buf = fs.readFileSync(keyPath);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return buf.toString("utf8");
  } catch (err) {
    console.warn(`Failed to read secret ${filename}:`, err.message);
    return "";
  }
}

function writeSecretFile(filename, value) {
  try {
    const keyPath = secretPath(filename);
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
      return true;
    }
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(keyPath, safeStorage.encryptString(text));
    } else {
      // Fallback: plaintext. safeStorage is unavailable (e.g. headless Linux);
      // warn loudly and restrict the file to the current user so other local
      // accounts cannot read the secret.
      console.warn(
        `safeStorage unavailable — storing ${filename} in PLAINTEXT at ${keyPath} (user-only permissions).`
      );
      fs.writeFileSync(keyPath, text, { encoding: "utf8", mode: 0o600 });
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(keyPath, 0o600);
        } catch (err) {
          console.warn(`Failed to set 0600 permissions on ${filename}:`, err.message);
        }
      }
    }
    return true;
  } catch (err) {
    console.warn(`Failed to store secret ${filename}:`, err.message);
    return false;
  }
}

/** Token for private GitHub releases: env first, then safeStorage. */
function getGithubUpdateToken() {
  const fromEnv = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  return readSecretFile(GH_UPDATE_TOKEN_FILENAME);
}

function clearBluetoothSelect() {
  if (bluetoothSelectTimer) {
    clearTimeout(bluetoothSelectTimer);
    bluetoothSelectTimer = null;
  }
  bluetoothSelectCallback = null;
  bluetoothPickerActive = false;
  lastBluetoothDeviceList = [];
}

/**
 * Match DG-LAB Coyote hosts (and similar names). Empty names are common mid-scan
 * on Windows and are handled separately in the select handler.
 */
function isCoyoteDevice(device) {
  const name = (device.deviceName || "").trim();
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    name.includes("47L121") ||
    name.includes("47L12") ||
    n.includes("coyote") ||
    n.includes("dg-lab") ||
    n.includes("dglab") ||
    n.includes("dungeon")
  );
}

/**
 * Match heart-rate monitors (Polar H10, Wahoo TICKR, …) so the
 * select-bluetooth-device flow can auto-select them for biofeedback.
 */
function isHeartRateDevice(device) {
  const name = (device.deviceName || "").trim().toLowerCase();
  if (!name) return false;
  return (
    name.includes("polar") ||
    name.includes("h10") ||
    name.includes("tickr") ||
    name.includes("wahoo") ||
    name.includes("heart rate") ||
    name.includes("hr")
  );
}

function deviceLabel(device) {
  return (device.deviceName || "").trim() || device.deviceId || "(unbekannt)";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Stim App",
    // Match app chrome so resize/drag does not flash a different color
    backgroundColor: "#1b1b1c",
    show: false,
    webPreferences: {
      // Security defaults — explicit even though most are Electron defaults,
      // so a future Electron version changing defaults can't silently weaken us.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      javascript: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenu(null);

  // Lock down permissions: only bluetooth is ever granted.
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === "bluetooth";
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "bluetooth");
  });

  // Block all navigation away from the bundled file:// document.
  // Any external redirect is treated as a potential phishing / RCE vector.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith("file://");
    if (!allowed) {
      console.warn(`Blocked navigation to external URL: ${url}`);
      event.preventDefault();
    }
  });

  // Deny all new-window / popup attempts (target=_blank, window.open, etc.).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`Blocked new-window attempt: ${url}`);
    return { action: "deny" };
  });

  // Defense in depth: even if webviewTag were flipped on by accident,
  // refuse to attach any <webview>.
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  // Auto-select Coyote; if several match, show a picker dialog once.
  // Windows often reports empty deviceName on early scan events — keep scanning.
  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    bluetoothSelectCallback = callback;
    lastBluetoothDeviceList = Array.isArray(deviceList) ? deviceList.slice() : [];

    const names = lastBluetoothDeviceList.map(deviceLabel);
    console.log(
      `Electron Bluetooth scan: ${lastBluetoothDeviceList.length} device(s): ${
        names.join(" | ") || "(none)"
      }`
    );

    const matches = lastBluetoothDeviceList.filter(isCoyoteDevice);

    if (matches.length === 1) {
      console.log(`Auto-selecting: ${deviceLabel(matches[0])} (${matches[0].deviceId})`);
      const id = matches[0].deviceId;
      clearBluetoothSelect();
      callback(id);
      return;
    }

    // Biofeedback: no Coyote present, but exactly one HR monitor → auto-select.
    if (matches.length === 0) {
      const hrMatches = lastBluetoothDeviceList.filter(isHeartRateDevice);
      if (hrMatches.length === 1) {
        console.log(
          `Auto-selecting heart-rate device: ${deviceLabel(hrMatches[0])} (${hrMatches[0].deviceId})`
        );
        const id = hrMatches[0].deviceId;
        clearBluetoothSelect();
        callback(id);
        return;
      }
    }

    if (matches.length > 1 && !bluetoothPickerActive) {
      bluetoothPickerActive = true;
      if (bluetoothSelectTimer) {
        clearTimeout(bluetoothSelectTimer);
        bluetoothSelectTimer = null;
      }

      const buttons = matches.slice(0, 6).map((d) => deviceLabel(d));
      buttons.push("Abbrechen");

      dialog
        .showMessageBox(mainWindow, {
          type: "question",
          buttons,
          defaultId: 0,
          cancelId: buttons.length - 1,
          title: "Coyote Gerät wählen",
          message: "Mehrere passende Geräte gefunden.",
          detail: "Bitte das gewünschte DG-LAB Coyote Gerät auswählen.",
        })
        .then(({ response }) => {
          const selected = matches[response];
          clearBluetoothSelect();
          if (selected) {
            console.log(`User selected: ${deviceLabel(selected)} (${selected.deviceId})`);
            callback(selected.deviceId);
          } else {
            console.log("User cancelled device selection.");
            callback("");
          }
        })
        .catch((err) => {
          console.warn("Device picker dialog failed:", err.message);
          clearBluetoothSelect();
          callback("");
        });
      return;
    }

    // Picker dialog is open — ignore new scan events until the user decides.
    // (The old sync dialog blocked the main process, hiding this race; the
    // async dialog must not re-arm the timeout fallback while it is up.)
    if (bluetoothPickerActive) return;

    // Still scanning — arm timeout once with best-effort fallbacks.
    if (!bluetoothSelectTimer) {
      bluetoothSelectTimer = setTimeout(() => {
        bluetoothSelectTimer = null;
        if (!bluetoothSelectCallback) return;
        const cb = bluetoothSelectCallback;
        bluetoothSelectCallback = null;

        const list = lastBluetoothDeviceList || [];
        const lateMatches = list.filter(isCoyoteDevice);
        if (lateMatches.length >= 1) {
          console.warn(`BT timeout: selecting match ${deviceLabel(lateMatches[0])}`);
          clearBluetoothSelect();
          cb(lateMatches[0].deviceId);
          return;
        }
        // Single BLE device (often name still empty under the namePrefix filter)
        if (list.length === 1 && list[0].deviceId) {
          console.warn(
            `BT timeout: only one BLE device (${deviceLabel(list[0])}) — attempting connect.`
          );
          clearBluetoothSelect();
          cb(list[0].deviceId);
          return;
        }
        console.warn(
          "Bluetooth scan timed out without matching Coyote (expect name 47L121* / coyote)."
        );
        clearBluetoothSelect();
        cb("");
      }, BLUETOOTH_SELECT_TIMEOUT_MS);
    }
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Tightened CSP. Notes:
    // - script-src 'self' → only bundle.min.js from file://
    // - object-src 'none' → no Flash/Java/PDF embeds
    // - base-uri 'self' → can't override <base>
    // - form-action 'none' → no form submissions
    // - frame-ancestors 'none' → can't be framed
    // - connect-src explicit allow-list for AI providers + local Ollama
    const csp =
      "default-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; " +
      "script-src 'self'; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "form-action 'none'; " +
      "frame-ancestors 'none'; " +
      "connect-src 'self' http://localhost:11434 https://openrouter.ai https://api.openrouter.ai https://api.z.ai; " +
      "img-src 'self' data: blob:; " +
      "media-src 'self' blob:;";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  let frontendPath = path.join(__dirname, "..", "frontend", "index.html");
  if (!fs.existsSync(frontendPath)) {
    frontendPath = path.join(__dirname, "..", "..", "frontend", "index.html");
  }

  console.log(`Loading frontend from: ${frontendPath}`);
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.loadFile(frontendPath);

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.webContents.send("app-before-close");

    closeFallbackTimer = setTimeout(() => {
      console.warn("Renderer did not confirm close. Forcing exit.");
      isQuitting = true;
      if (mainWindow) mainWindow.close();
    }, 3000);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    clearBluetoothSelect();
    if (closeFallbackTimer) {
      clearTimeout(closeFallbackTimer);
      closeFallbackTimer = null;
    }
  });

  mainWindow.on("minimize", () => {
    if (tray) {
      mainWindow.hide();
      // Tray balloon notifications are Windows-only; on mac/linux the tray
      // icon + context menu is enough, the user sees the hidden window anyway.
      if (process.platform === "win32" && typeof tray.displayBalloon === "function") {
        tray.displayBalloon({
          iconType: "info",
          title: "Stim App",
          content: "Im Hintergrund aktiv (Tray).",
        });
      }
    }
  });
}

function createTray() {
  const trayIconPath = path.join(__dirname, "..", "assets", "icon.png");
  const trayFallback = path.join(__dirname, "..", "assets", "tray.png");
  let trayIcon;
  if (fs.existsSync(trayIconPath)) {
    trayIcon = nativeImage.createFromPath(trayIconPath);
  } else if (fs.existsSync(trayFallback)) {
    trayIcon = nativeImage.createFromPath(trayFallback);
  } else {
    const placeholder = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5QYbBzIIGon8dwAAAB1pVFh0Q29tbWVudAAAAAAAKz1rZTMyLTAwMDAwMDAwMDAAM78E7gAAAFhJREFUOMu9jrENgDAMBE+cTjA6o2R11gh7YI+MkkGywH8R+ZKtyOdT7rOklGdmZnZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmb2Yw/3GwkGU5VoewAAAABJRU5ErkJggg==",
      "base64"
    );
    trayIcon = nativeImage.createFromBuffer(placeholder);
  }

  tray = new Tray(trayIcon);
  rebuildTrayMenu();
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Rebuild the tray context menu. Called on create and whenever the device
 * connection state changes, so the menu always shows live status + STOPP.
 */
function rebuildTrayMenu() {
  if (!tray) return;
  const statusLabel = trayConnected ? "Coyote verbunden" : "Nicht verbunden";
  const contextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: "separator" },
    {
      label: "Anzeigen",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "STOPP (Panik)",
      click: () => triggerPanic("tray"),
    },
    { type: "separator" },
    {
      label: "Beenden",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip(`Stim App – ${statusLabel}`);
  tray.setContextMenu(contextMenu);
}

/**
 * Emergency stop, reachable from tray/global hotkey even while the window is
 * hidden. The renderer does the actual device write (killAllOutput).
 */
function triggerPanic(source) {
  console.warn(`[panic] triggered via ${source}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-panic");
  } else {
    console.warn("[panic] no window available – renderer must handle it");
  }
  if (process.platform === "win32" && typeof tray?.displayBalloon === "function") {
    tray.displayBalloon({
      iconType: "error",
      title: "Stim App",
      content: "STOPP ausgelöst – Ausgabe wurde gestoppt.",
    });
  } else if (Notification.isSupported()) {
    new Notification({
      title: "Stim App",
      body: "STOPP ausgelöst – Ausgabe wurde gestoppt.",
    }).show();
  }
}

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", payload);
  }
}

function formatUpdaterError(err) {
  const raw = err?.message || String(err || "unbekannt");
  if (/Cannot find latest\.yml/i.test(raw)) {
    return (
      "Update-Metadaten (latest.yml) fehlen oder sind nicht öffentlich ladbar. " +
      "Bitte prüfen, ob das Release-Asset auf GitHub erreichbar ist. " +
      raw
    );
  }
  if (/404/i.test(raw) && /github\.com|releases/i.test(raw)) {
    return (
      "GitHub-Release nicht erreichbar (404). " +
      "Repo öffentlich? latest.yml im neuesten Release vorhanden? " +
      raw
    );
  }
  if (/401|403/i.test(raw)) {
    return "GitHub-Zugriff verweigert (401/403). " + raw;
  }
  return raw;
}

/**
 * Public GitHub Releases feed for zenoxo-source/Stim-App.
 * Optional token only if the repo is later made private again.
 */
function configureUpdaterFeed() {
  const token = getGithubUpdateToken();
  const feed = {
    provider: "github",
    owner: UPDATE_OWNER,
    repo: UPDATE_REPO,
    releaseType: "release",
    // Always public feed for open releases; token upgrades to private access if set
    private: Boolean(token),
  };
  if (token) {
    feed.token = token;
    process.env.GH_TOKEN = token;
  } else {
    // Ensure no stale private-token mode from a previous session
    delete process.env.GH_TOKEN;
  }
  autoUpdater.setFeedURL(feed);
  return true;
}

function setupAutoUpdater() {
  // Only check GitHub releases when packaged (NSIS / portable)
  if (!app.isPackaged) {
    console.log("Auto-updater skipped (development mode).");
    return;
  }

  // Silent background checks don't spam the UI with "checking"/"none".
  let silentUpdateCheck = false;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (...args) => console.log("[updater]", ...args),
    warn: (...args) => console.warn("[updater]", ...args),
    error: (...args) => console.error("[updater]", ...args),
    debug: (...args) => console.log("[updater:debug]", ...args),
  };

  try {
    configureUpdaterFeed();
  } catch (err) {
    console.warn("configureUpdaterFeed failed:", err.message);
  }

  if (!getGithubUpdateToken()) {
    console.log("[updater] No GitHub token – using public release feed (ok if repo is public).");
  }

  autoUpdater.on("checking-for-update", () => {
    if (!silentUpdateCheck) sendUpdateStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({
      status: "available",
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    if (!silentUpdateCheck) {
      sendUpdateStatus({ status: "none", version: info?.version || app.getVersion() });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({
      status: "downloading",
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({ status: "ready", version: info.version });
  });

  autoUpdater.on("error", (err) => {
    if (silentUpdateCheck) {
      console.warn("[updater] silent periodic check failed:", err.message);
      return;
    }
    sendUpdateStatus({ status: "error", message: formatUpdaterError(err) });
  });

  // Delay so the window can subscribe first
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("checkForUpdates failed:", err.message);
      sendUpdateStatus({ status: "error", message: formatUpdaterError(err) });
    });
  }, 4000);

  // Periodic silent check: no UI unless an update is actually found.
  setInterval(() => {
    silentUpdateCheck = true;
    autoUpdater
      .checkForUpdates()
      .catch((err) => {
        console.warn("[updater] periodic check failed:", err.message);
      })
      .finally(() => {
        silentUpdateCheck = false;
      });
  }, UPDATE_CHECK_INTERVAL_MS);
}

function registerIpc() {
  ipcMain.on("device-connected", (event, connected) => {
    trayConnected = Boolean(connected);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(connected ? "Stim App (Verbunden)" : "Stim App");
    }
    rebuildTrayMenu();
  });

  // Generic user-facing notification (device lost, safety timer, …).
  ipcMain.on("app-notify", (_event, payload) => {
    const title = typeof payload?.title === "string" ? payload.title.slice(0, 120) : "Stim App";
    const body =
      typeof payload?.body === "string" && payload.body ? payload.body.slice(0, 300) : "";
    if (!body) return;
    if (process.platform === "win32" && typeof tray?.displayBalloon === "function") {
      tray.displayBalloon({ iconType: "info", title, content: body });
    } else if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  ipcMain.on("close-confirmed", () => {
    isQuitting = true;
    if (closeFallbackTimer) {
      clearTimeout(closeFallbackTimer);
      closeFallbackTimer = null;
    }
    if (mainWindow) mainWindow.close();
  });

  ipcMain.on("close-prevented", () => {
    if (closeFallbackTimer) {
      clearTimeout(closeFallbackTimer);
      closeFallbackTimer = null;
    }
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:isPackaged", () => app.isPackaged);

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) {
      return { ok: false, reason: "dev-mode" };
    }
    try {
      configureUpdaterFeed();
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        updateInfo: result?.updateInfo ? { version: result.updateInfo.version } : null,
      };
    } catch (err) {
      return { ok: false, error: formatUpdaterError(err) };
    }
  });

  ipcMain.handle("updater:install", () => {
    if (!app.isPackaged) return { ok: false, reason: "dev-mode" };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });

  ipcMain.handle("updater:hasToken", () => Boolean(getGithubUpdateToken()));

  // LLM/vision API key (Webcam-Vision): stored via safeStorage, raw key never
  // crosses the IPC boundary.
  ipcMain.handle("secrets:keyStatus", () => {
    const key = readSecretFile(API_KEY_FILENAME);
    const hasKey = Boolean(key);
    return { hasKey, hint: hasKey ? `••••${key.slice(-4)}` : "" };
  });
  ipcMain.handle("secrets:setApiKey", (event, apiKey) => {
    if (typeof apiKey !== "string") return false;
    if (apiKey.length > 4096) return false;
    return writeSecretFile(API_KEY_FILENAME, apiKey);
  });

  ipcMain.handle("secrets:getGithubToken", () => readSecretFile(GH_UPDATE_TOKEN_FILENAME));
  ipcMain.handle("secrets:setGithubToken", (event, token) => {
    if (typeof token !== "string") return false;
    if (token.length > 4096) return false;
    const ok = writeSecretFile(GH_UPDATE_TOKEN_FILENAME, token);
    // Re-apply feed so the next check uses the new token
    try {
      configureUpdaterFeed();
    } catch (e) {
      // ignore if not packaged / updater not ready
    }
    return ok;
  });

  ipcMain.handle("diagnostics:exportLog", async (event, content) => {
    if (typeof content !== "string") return { ok: false, error: "invalid content" };
    if (content.length > 5 * 1024 * 1024) return { ok: false, error: "log too large (max 5 MB)" };
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: "Diagnose-Log speichern",
        defaultPath: `coyote-diagnose-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`,
        filters: [
          { name: "Log", extensions: ["log", "txt"] },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      fs.writeFileSync(filePath, content, "utf8");
      return { ok: true, filePath };
    } catch (err) {
      console.warn("Failed to export log:", err.message);
      return { ok: false, error: err.message };
    }
  });

  // LLM proxy (see llm-proxy.js): used by Webcam-Vision. The API key stays in
  // the main process; streaming chunks are routed back via webContents.send.
  ipcMain.handle("llm:chat", async (event, payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "payload fehlt oder ist ungültig." };
    }
    const sender = event.sender;
    const send = (channel, data) => {
      if (sender && !sender.isDestroyed()) sender.send(channel, data);
    };
    return runLLMRequest({
      ...payload,
      apiKey: readSecretFile(API_KEY_FILENAME),
      send,
    });
  });

  ipcMain.on("llm:abort", (_event, reqId) => {
    if (typeof reqId === "string" && reqId) abortLLM(reqId);
  });

  // Buttplug.io server (experimental): VibrateCmd speed → renderer intensity.
  ipcMain.handle("buttplug:start", async (_event, port) => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      return { ok: false, error: "port must be an integer in 1024–65535" };
    }
    return startButtplugServer(p, (speed) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("buttplug-vibrate", { speed });
      }
    });
  });
  ipcMain.handle("buttplug:stop", () => stopButtplugServer());
  ipcMain.handle("buttplug:status", () => getButtplugStatus());

  // Buttplug CLIENT: drive external devices in sync with the stim output.
  ipcMain.handle("buttplugClient:connect", (_event, port) =>
    connectButtplugClient(port, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("buttplug-client-status", status);
      }
    })
  );
  ipcMain.handle("buttplugClient:disconnect", () => disconnectButtplugClient());
  ipcMain.handle("buttplugClient:status", () => getButtplugClientStatus());
  ipcMain.on("buttplugClient:vibrate", (_event, speed) => syncVibrate(speed));
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  createTray();
  setupAutoUpdater();

  // Global panic hotkey — works even while the window is hidden in the tray.
  try {
    const ok = globalShortcut.register("CommandOrControl+Alt+S", () => triggerPanic("hotkey"));
    if (ok) {
      console.log("Globaler Panic-Hotkey registriert: Strg+Alt+S");
    } else {
      console.warn("Globaler Panic-Hotkey konnte nicht registriert werden (Konflikt?).");
    }
  } catch (err) {
    console.warn("globalShortcut registration failed:", err.message);
  }

  // Global media keys: STIM play/pause + track navigation while hidden.
  const mediaKeys = [
    ["MediaPlayPause", "play_pause"],
    ["MediaNextTrack", "next"],
    ["MediaPreviousTrack", "prev"],
  ];
  for (const [accelerator, action] of mediaKeys) {
    try {
      globalShortcut.register(accelerator, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("media-key", action);
        }
      });
    } catch (err) {
      console.warn(`Media-Key ${accelerator} konnte nicht registriert werden:`, err.message);
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
});

app.on("window-all-closed", () => {
  // Tray app convention: on macOS keep running in the tray when the window is
  // closed (the dock "activate" handler recreates it); everywhere else quit.
  if (process.platform !== "darwin") {
    console.log("All windows closed. Exiting...");
    app.quit();
  }
});
