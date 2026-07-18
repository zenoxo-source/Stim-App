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
} = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
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

const BLUETOOTH_SELECT_TIMEOUT_MS = 15000;
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
      fs.writeFileSync(keyPath, text, "utf8");
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
}

function isCoyoteDevice(device) {
  const name = device.deviceName || "";
  return name.includes("47L121") || name.toLowerCase().includes("coyote");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Stim App",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenu(null);

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === "bluetooth";
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "bluetooth");
  });

  // Auto-select Coyote; if several match, show a picker dialog once.
  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    console.log(`Electron Bluetooth scan found ${deviceList.length} devices.`);

    bluetoothSelectCallback = callback;

    const matches = deviceList.filter(isCoyoteDevice);

    if (matches.length === 1) {
      console.log(
        `Auto-selecting matched device: ${matches[0].deviceName} (${matches[0].deviceId})`
      );
      clearBluetoothSelect();
      callback(matches[0].deviceId);
      return;
    }

    if (matches.length > 1 && !bluetoothPickerActive) {
      bluetoothPickerActive = true;
      if (bluetoothSelectTimer) {
        clearTimeout(bluetoothSelectTimer);
        bluetoothSelectTimer = null;
      }

      const buttons = matches.slice(0, 6).map((d) => d.deviceName || d.deviceId);
      buttons.push("Abbrechen");

      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        title: "Coyote Gerät wählen",
        message: "Mehrere passende Geräte gefunden.",
        detail: "Bitte das gewünschte DG-LAB Coyote Gerät auswählen.",
      });

      const selected = matches[choice];
      clearBluetoothSelect();
      if (selected) {
        console.log(`User selected device: ${selected.deviceName} (${selected.deviceId})`);
        callback(selected.deviceId);
      } else {
        console.log("User cancelled device selection.");
        callback("");
      }
      return;
    }

    console.log("No matched device in list yet. Scanning...");
    if (!bluetoothSelectTimer) {
      bluetoothSelectTimer = setTimeout(() => {
        bluetoothSelectTimer = null;
        if (bluetoothSelectCallback) {
          console.warn("Bluetooth scan timed out without matching device.");
          const cb = bluetoothSelectCallback;
          bluetoothSelectCallback = null;
          cb("");
        }
      }, BLUETOOTH_SELECT_TIMEOUT_MS);
    }
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp =
      "default-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; " +
      "script-src 'self'; " +
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
      tray.displayBalloon({
        iconType: "info",
        title: "Stim App",
        content: "Im Hintergrund aktiv (Tray).",
      });
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
  const contextMenu = Menu.buildFromTemplate([
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
      label: "Beenden",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Stim App");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
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
    sendUpdateStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({
      status: "available",
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    sendUpdateStatus({ status: "none", version: info?.version || app.getVersion() });
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
    sendUpdateStatus({ status: "error", message: formatUpdaterError(err) });
  });

  // Delay so the window can subscribe first
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("checkForUpdates failed:", err.message);
      sendUpdateStatus({ status: "error", message: formatUpdaterError(err) });
    });
  }, 4000);
}

function registerIpc() {
  ipcMain.on("device-connected", (event, connected) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(connected ? "Stim App (Verbunden)" : "Stim App");
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

  ipcMain.handle("secrets:getApiKey", () => readSecretFile(API_KEY_FILENAME));
  ipcMain.handle("secrets:setApiKey", (event, apiKey) => writeSecretFile(API_KEY_FILENAME, apiKey));

  ipcMain.handle("secrets:getGithubToken", () => readSecretFile(GH_UPDATE_TOKEN_FILENAME));
  ipcMain.handle("secrets:setGithubToken", (event, token) => {
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
      fs.writeFileSync(filePath, content || "", "utf8");
      return { ok: true, filePath };
    } catch (err) {
      console.warn("Failed to export log:", err.message);
      return { ok: false, error: err.message };
    }
  });
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  console.log("All windows closed. Exiting...");
  app.quit();
});
