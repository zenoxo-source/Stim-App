// bluetooth.js - BLE connection and V3 protocol for DG-LAB Coyote 3.0
// Based on DG-Kit reference implementation (github.com/0xNullAI/DG-Kit)

// V3 Protocol overview:
//   0xB0 packet (20 bytes): combined strength + waveform, sent every 100ms
//     byte 0:  0xB0
//     byte 1:  ((seq & 0x0f) << 4) | (mode & 0x0f)
//               mode bits 4-5: channel A (0=none, 1=+delta, 2=-delta, 3=absolute)
//               mode bits 0-1: channel B
//     byte 2:  strengthA (0-200)
//     byte 3:  strengthB (0-200)
//     bytes 4-7:   frequency[4] for channel A (0=inactive, 10-240=active)
//     bytes 8-11:  intensity[4] for channel A (0-100=active, 101=inactive)
//     bytes 12-15: frequency[4] for channel B
//     bytes 16-19: intensity[4] for channel B
//
//   0xBF packet (7 bytes): set device limits
//     byte 0: 0xBF, bytes 1-2: limitA/B, bytes 3-4: 0xA0, bytes 5-6: 0x00
//
//   0xB1 notification: device ACK + strength feedback
//     byte 0: 0xB1, byte 1: ackSeq, byte 2: strengthA, byte 3: strengthB

function sendBluetoothCommand(data) {
  return new Promise((resolve) => {
    if (!AppState.writeChar) {
      resolve();
      return;
    }
    try {
      const writeOp = AppState.writeChar.writeValueWithoutResponse
        ? AppState.writeChar.writeValueWithoutResponse(data)
        : AppState.writeChar.writeValue(data);
      if (writeOp && writeOp.then) {
        writeOp
          .then(() => resolve())
          .catch((err) => {
            if (err && err.message && !err.message.includes("GATT operation already in progress")) {
              console.error("BT Write Error:", err);
            }
            resolve();
          });
      } else {
        resolve();
      }
    } catch (err) {
      if (err && err.message && !err.message.includes("GATT operation already in progress")) {
        console.error("BT Write Error:", err);
      }
      resolve();
    }
  });
}

async function drainBluetoothQueue() {
  if (AppState.isBluetoothWriting || !AppState.writeChar) return;

  let dataToWrite = null;
  if (AppState.pendingStrengthData) {
    dataToWrite = AppState.pendingStrengthData;
    AppState.pendingStrengthData = null;
  } else if (AppState.pendingWaveformData) {
    dataToWrite = AppState.pendingWaveformData;
    AppState.pendingWaveformData = null;
  } else {
    return;
  }

  AppState.isBluetoothWriting = true;
  await sendBluetoothCommand(dataToWrite);
  AppState.isBluetoothWriting = false;

  drainBluetoothQueue();
}

// ==========================================
// V3 PROTOCOL FUNCTIONS
// ==========================================

function sendV3Init() {
  if (!AppState.writeChar) return;
  const limitA = Math.min(200, Math.max(0, AppState.softLimitA));
  const limitB = Math.min(200, Math.max(0, AppState.softLimitB));
  const payload = new Uint8Array([0xbf, limitA, limitB, 0xa0, 0xa0, 0x00, 0x00]);
  sendBluetoothCommand(payload);
  log(`V3 Limit-Paket gesendet (Limit A: ${limitA}, Limit B: ${limitB})`, "info");
}

function getDeviceStrength(val, softLimit) {
  // UI/logical intensity stays unscaled; masterScale applies only to device output.
  if (typeof ProtocolUtils !== "undefined") {
    return ProtocolUtils.getDeviceStrength(val, softLimit, AppState.masterScale);
  }
  const clamped = Math.min(softLimit, Math.max(0, Math.round(val)));
  return Math.min(200, Math.max(0, Math.round(clamped * AppState.masterScale)));
}

function sendStrengthCommand(valA, valB) {
  if (!AppState.writeChar) return;

  // Keep AppState as logical (UI) values; do not bake masterScale into state.
  AppState.strengthA = Math.min(AppState.softLimitA, Math.max(0, Math.round(valA)));
  AppState.strengthB = Math.min(AppState.softLimitB, Math.max(0, Math.round(valB)));
  AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
}

function sendWaveformCommand(freqA, ampA, freqB, ampB) {
  if (!AppState.writeChar) return;

  let outFreqA = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, freqA));
  let outFreqB = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, freqB));
  // Master scale applies to wave amplitudes as well as channel strength
  let outAmpA =
    typeof ProtocolUtils !== "undefined"
      ? ProtocolUtils.scaleWaveAmp(ampA, AppState.masterScale)
      : Math.min(100, Math.max(0, Math.round(ampA * AppState.masterScale)));
  let outAmpB =
    typeof ProtocolUtils !== "undefined"
      ? ProtocolUtils.scaleWaveAmp(ampB, AppState.masterScale)
      : Math.min(100, Math.max(0, Math.round(ampB * AppState.masterScale)));

  if (AppState.swapChannels) {
    const tmpF = outFreqA;
    outFreqA = outFreqB;
    outFreqB = tmpF;
    const tmpA = outAmpA;
    outAmpA = outAmpB;
    outAmpB = tmpA;
  }

  const data = new Uint8Array(20);
  data[0] = 0xb0;

  let mode = 0;
  let seq = 0;
  if (!AppState.btAwaitingAck && AppState.btPendingMode !== 0) {
    AppState.btSeq = AppState.btSeq >= 15 ? 1 : AppState.btSeq + 1;
    seq = AppState.btSeq;
    mode = AppState.btPendingMode;
    AppState.btAwaitingAck = true;
    AppState.btPendingMode = 0;
    // Fallback: clear awaitingAck after 300ms if no matching ACK arrives
    const sentSeq = seq;
    setTimeout(() => {
      if (AppState.btAwaitingAck && AppState.btSeq === sentSeq) {
        AppState.btAwaitingAck = false;
        AppState.btSeq = 0;
      }
    }, 300);
  }

  data[1] = ((seq & 0x0f) << 4) | (mode & 0x0f);
  data[2] = getDeviceStrength(AppState.strengthA, AppState.softLimitA);
  data[3] = getDeviceStrength(AppState.strengthB, AppState.softLimitB);

  // Channel A waveform: freq[4] at bytes 4-7, int[4] at bytes 8-11
  data[4] = outFreqA;
  data[5] = outFreqA;
  data[6] = outFreqA;
  data[7] = outFreqA;
  data[8] = outAmpA;
  data[9] = outAmpA;
  data[10] = outAmpA;
  data[11] = outAmpA;

  // Channel B waveform: freq[4] at bytes 12-15, int[4] at bytes 16-19
  data[12] = outFreqB;
  data[13] = outFreqB;
  data[14] = outFreqB;
  data[15] = outFreqB;
  data[16] = outAmpB;
  data[17] = outAmpB;
  data[18] = outAmpB;
  data[19] = outAmpB;

  AppState.pendingWaveformData = data;
  drainBluetoothQueue();
}

function sendV3EmergencyStop() {
  if (!AppState.writeChar) return;

  const data =
    typeof ProtocolUtils !== "undefined"
      ? ProtocolUtils.buildEmergencyStopBytes()
      : (() => {
          const d = new Uint8Array(20);
          d[0] = 0xb0;
          d[1] = 0x0f;
          for (let i = 8; i <= 11; i++) d[i] = 101;
          for (let i = 16; i <= 19; i++) d[i] = 101;
          return d;
        })();

  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.btPendingMode = 0;
  AppState.btSeq = 0;
  AppState.btAwaitingAck = false;

  // Bypass queue coalescing: emergency stop must go out immediately
  AppState.pendingStrengthData = null;
  AppState.pendingWaveformData = data;
  drainBluetoothQueue();
}

function handleDeviceNotification(event) {
  const value = event.target.value;
  const data = new Uint8Array(value.buffer);

  if (data[0] === 0xb1 && data.length >= 4) {
    const ackSeq = data[1];
    const ackSeqNum = (ackSeq >> 4) & 0x0f;

    if (AppState.btAwaitingAck && (ackSeq === AppState.btSeq || ackSeqNum === AppState.btSeq)) {
      AppState.btAwaitingAck = false;
      AppState.btSeq = 0;
    }
  }
}

function updateBatteryUI(level) {
  if (DOM["battery-level-bar"]) DOM["battery-level-bar"].style.height = `${level}%`;
  if (DOM["battery-text"]) DOM["battery-text"].textContent = `${level}%`;
}

async function readBatteryStatus() {
  if (!AppState.batteryChar) return;
  try {
    const value = await AppState.batteryChar.readValue();
    AppState.batteryLevel = value.getUint8(0);
    updateBatteryUI(AppState.batteryLevel);
    log(`Batterieladestand: ${AppState.batteryLevel}%`, "info");
  } catch (err) {
    console.warn("Could not read battery level:", err);
  }
}

function setReconnectStatus(message) {
  const el = document.getElementById("reconnect-status");
  if (!el) return;
  if (!message) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = message;
}

function setDeviceListHint(names) {
  const el = document.getElementById("bt-device-list");
  if (!el) return;
  if (!names || names.length === 0) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.style.display = "block";
  el.innerHTML = names.map((n) => `<div class="bt-device-item">${escapeBtHtml(n)}</div>`).join("");
}

function escapeBtHtml(value) {
  if (typeof ProtocolUtils !== "undefined" && ProtocolUtils.escapeHtml) {
    return ProtocolUtils.escapeHtml(value);
  }
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function friendlyBtError(err) {
  const msg = err?.message || String(err || "Unbekannter Fehler");
  if (/User cancelled|NotFoundError|canceled/i.test(msg)) {
    return "Verbindung abgebrochen – kein Gerät ausgewählt.";
  }
  if (/NetworkError|GATT Server is disconnected/i.test(msg)) {
    return "Bluetooth-Verbindung unterbrochen (GATT). Bitte erneut verbinden.";
  }
  if (/SecurityError|NotAllowedError/i.test(msg)) {
    return "Bluetooth-Zugriff verweigert. Berechtigung prüfen und erneut versuchen.";
  }
  if (/Unsupported|NotSupportedError/i.test(msg)) {
    return "Web Bluetooth wird hier nicht unterstützt.";
  }
  return `Verbindungsfehler: ${msg}`;
}

function scheduleReconnect() {
  if (AppState.reconnectTimer) return;
  if (AppState.reconnectAttempts >= CONSTANTS.MAX_RECONNECT_ATTEMPTS) {
    log("Maximale Reconnect-Versuche erreicht.", "error");
    setReconnectStatus("Reconnect fehlgeschlagen – manuell verbinden.");
    return;
  }
  AppState.reconnectAttempts += 1;
  const attempt = AppState.reconnectAttempts;
  const max = CONSTANTS.MAX_RECONNECT_ATTEMPTS;
  const secs = CONSTANTS.RECONNECT_DELAY_MS / 1000;
  log(`Versuche Reconnect in ${secs}s (Versuch ${attempt}/${max})...`, "warning");
  setReconnectStatus(`Reconnect ${attempt}/${max} in ${secs}s…`);
  AppState.reconnectTimer = setTimeout(() => {
    AppState.reconnectTimer = null;
    setReconnectStatus(`Reconnect ${attempt}/${max} läuft…`);
    DOM["btn-connect"]?.click();
  }, CONSTANTS.RECONNECT_DELAY_MS);
}

function clearReconnect() {
  if (AppState.reconnectTimer) {
    clearTimeout(AppState.reconnectTimer);
    AppState.reconnectTimer = null;
  }
  setReconnectStatus("");
}

function clearBatteryPolling() {
  if (AppState.batteryIntervalId) {
    clearInterval(AppState.batteryIntervalId);
    AppState.batteryIntervalId = null;
  }
}

function onDisconnected() {
  AppState.isConnected = false;
  AppState.writeChar = null;
  AppState.notifyChar = null;
  AppState.batteryChar = null;
  AppState.btSeq = 0;
  AppState.btAwaitingAck = false;
  AppState.btPendingMode = 0;
  clearBatteryPolling();
  stopWaveLoop();

  log("Bluetooth-Verbindung zum Coyote verloren.", "warning");
  if (DOM["connection-text"]) DOM["connection-text"].textContent = "Getrennt";
  if (DOM["connection-indicator"]) DOM["connection-indicator"].className = "status-indicator";
  if (DOM["btn-connect"]) DOM["btn-connect"].style.display = "block";
  if (DOM["btn-disconnect"]) DOM["btn-disconnect"].style.display = "none";
  if (DOM["battery-text"]) DOM["battery-text"].textContent = "--%";
  if (DOM["battery-level-bar"]) DOM["battery-level-bar"].style.height = "0%";
  setDeviceListHint([]);
  if (typeof updateOutputStatus === "function") updateOutputStatus();

  if (DOM["info-device-name"]) DOM["info-device-name"].textContent = "Nicht verbunden";
  if (DOM["info-manufacturer"]) DOM["info-manufacturer"].textContent = "--";
  if (DOM["info-firmware"]) DOM["info-firmware"].textContent = "--";
  if (DOM["info-hardware"]) DOM["info-hardware"].textContent = "--";

  if (window.electronAPI && typeof window.electronAPI.setConnected === "function") {
    window.electronAPI.setConnected(false);
  }

  scheduleReconnect();
}

function resetUIOnDisconnect() {
  AppState.isConnected = false;
  AppState.writeChar = null;
  AppState.notifyChar = null;
  AppState.batteryChar = null;
  clearBatteryPolling();
  if (DOM["connection-text"]) DOM["connection-text"].textContent = "Getrennt";
  if (DOM["connection-indicator"]) DOM["connection-indicator"].className = "status-indicator";
  if (DOM["btn-connect"]) DOM["btn-connect"].style.display = "block";
  if (DOM["btn-disconnect"]) DOM["btn-disconnect"].style.display = "none";
  if (window.electronAPI && typeof window.electronAPI.setConnected === "function") {
    window.electronAPI.setConnected(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  DOM["check-swap-channels"]?.addEventListener("change", (e) => {
    AppState.swapChannels = e.target.checked;
    log(`Kan\u00e4le tauschen: ${AppState.swapChannels ? "Aktiv" : "Inaktiv"}`, "info");
  });

  DOM["btn-connect"]?.addEventListener("click", async () => {
    if (!navigator.bluetooth) {
      log("Web Bluetooth wird von diesem System/Browser nicht unterst\u00fctzt.", "error");
      return;
    }

    clearReconnect();

    log("Suche nach DG-LAB Coyote 3.0...", "info");
    if (DOM["connection-text"]) DOM["connection-text"].textContent = "Suche...";
    if (DOM["connection-indicator"])
      DOM["connection-indicator"].className = "status-indicator connecting";
    setReconnectStatus("Bluetooth-Suche läuft…");
    setDeviceListHint([`Filter: Prefix ${CONSTANTS.COYOTE_NAME_PREFIX} / „coyote“`]);

    try {
      AppState.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: CONSTANTS.COYOTE_NAME_PREFIX }],
        optionalServices: [
          CONSTANTS.SERVICE_UUID,
          CONSTANTS.DEVICE_INFO_SERVICE,
          CONSTANTS.BATTERY_SERVICE,
          CONSTANTS.CUSTOM_BATTERY_SERVICE,
        ],
      });

      log(`Ger\u00e4t gefunden: ${AppState.device.name}. Verbinde...`, "info");
      setDeviceListHint([AppState.device.name || "Coyote"]);
      setReconnectStatus("GATT-Verbindung wird aufgebaut…");

      AppState.device.addEventListener("gattserverdisconnected", onDisconnected);

      AppState.server = await AppState.device.gatt.connect();
      log("GATT Server verbunden. Suche Services...", "info");

      const service = await AppState.server.getPrimaryService(CONSTANTS.SERVICE_UUID);
      log("E-Stim Steuer-Service geladen.", "info");

      AppState.writeChar = await service.getCharacteristic(CONSTANTS.WRITE_UUID);
      AppState.notifyChar = await service.getCharacteristic(CONSTANTS.NOTIFY_UUID);

      await AppState.notifyChar.startNotifications();
      AppState.notifyChar.addEventListener("characteristicvaluechanged", handleDeviceNotification);

      try {
        const deviceInfoService = await AppState.server.getPrimaryService(
          CONSTANTS.DEVICE_INFO_SERVICE
        );
        AppState.batteryChar = await deviceInfoService.getCharacteristic(CONSTANTS.BATTERY_UUID);
        log("Batterie in Device Information (V3) gefunden.", "info");
      } catch (e1) {
        try {
          AppState.batteryChar = await service.getCharacteristic(CONSTANTS.BATTERY_UUID);
          log("Batterie auf Haupt-Service gefunden.", "info");
        } catch (e2) {
          try {
            const customService = await AppState.server.getPrimaryService(
              CONSTANTS.CUSTOM_BATTERY_SERVICE
            );
            AppState.batteryChar = await customService.getCharacteristic(CONSTANTS.BATTERY_UUID);
            log("Custom Batterie-Service gefunden.", "info");
          } catch (e3) {
            try {
              const stdService = await AppState.server.getPrimaryService(CONSTANTS.BATTERY_SERVICE);
              AppState.batteryChar = await stdService.getCharacteristic("battery_level");
              log("Standard Batterie-Service gefunden.", "info");
            } catch (e4) {
              log(
                "Batterieanzeige nicht unterst\u00fctzt (Hardware liefert keine Daten).",
                "warning"
              );
            }
          }
        }
      }

      if (DOM["info-device-name"])
        DOM["info-device-name"].textContent = AppState.device.name || "Coyote 3.0";
      try {
        const deviceInfoService = await AppState.server.getPrimaryService(
          CONSTANTS.DEVICE_INFO_SERVICE
        );
        try {
          const allChars = await deviceInfoService.getCharacteristics();
          allChars.forEach((c) => log(`Gefundene Info-Charakteristik: ${c.uuid}`, "info"));
        } catch (e) {
          // ignore optional device info characteristics
        }

        const tryReadHex = async (uuid, elementId) => {
          try {
            const char = await deviceInfoService.getCharacteristic(uuid);
            const val = await char.readValue();
            const bytes = new Uint8Array(val.buffer);
            const hex = Array.from(bytes)
              .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
              .join(":");
            if (DOM[elementId]) DOM[elementId].textContent = hex || "Leer";
          } catch (e) {
            if (DOM[elementId]) DOM[elementId].textContent = "Nicht verf\u00fcgbar";
          }
        };

        await tryReadHex(CONSTANTS.DEVICE_INFO_MANUFACTURER, "info-manufacturer");
        await tryReadHex(CONSTANTS.DEVICE_INFO_FIRMWARE, "info-firmware");
        await tryReadHex(CONSTANTS.DEVICE_INFO_HARDWARE, "info-hardware");
      } catch (e) {
        log("Ger\u00e4te-Informationen nicht abrufbar.", "warning");
        if (DOM["info-manufacturer"]) DOM["info-manufacturer"].textContent = "Nicht abrufbar";
        if (DOM["info-firmware"]) DOM["info-firmware"].textContent = "Nicht abrufbar";
        if (DOM["info-hardware"]) DOM["info-hardware"].textContent = "Nicht abrufbar";
      }

      log("Abonniere Bluetooth-Notifications...", "info");

      if (AppState.batteryChar) {
        try {
          await AppState.batteryChar.startNotifications();
          AppState.batteryChar.addEventListener("characteristicvaluechanged", (e) => {
            const val = new Uint8Array(e.target.value.buffer);
            AppState.batteryLevel = val[0];
            updateBatteryUI(AppState.batteryLevel);
          });
          log("Abonnement f\u00fcr Akku-Meldungen aktiv.", "info");
        } catch (subErr) {
          console.warn(
            "Konnte Akku-Benachrichtigungen nicht aktivieren, verwende nur Read:",
            subErr
          );
        }
        await readBatteryStatus();
        clearBatteryPolling();
        AppState.batteryIntervalId = setInterval(
          readBatteryStatus,
          CONSTANTS.BATTERY_READ_INTERVAL_MS
        );
      }

      AppState.isConnected = true;
      AppState.reconnectAttempts = 0;
      log("Erfolgreich mit Coyote 3.0 verbunden!", "success");
      if (typeof unlockAchievement === "function") unlockAchievement("first_connect");
      setReconnectStatus("");
      setDeviceListHint([AppState.device?.name || "Coyote 3.0 · verbunden"]);

      if (DOM["connection-text"]) DOM["connection-text"].textContent = "Verbunden";
      if (DOM["connection-indicator"])
        DOM["connection-indicator"].className = "status-indicator connected";
      if (DOM["btn-connect"]) DOM["btn-connect"].style.display = "none";
      if (DOM["btn-disconnect"]) DOM["btn-disconnect"].style.display = "block";

      if (window.electronAPI && typeof window.electronAPI.setConnected === "function") {
        window.electronAPI.setConnected(true);
      }

      // V3 Protocol: Send 0xBF limit init packet
      sendV3Init();

      // Initialize strength to 0 with absolute mode
      AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;

      startWaveLoop();
      if (typeof updateOutputStatus === "function") updateOutputStatus();
    } catch (err) {
      const friendly = friendlyBtError(err);
      log(friendly, "error");
      setReconnectStatus(friendly);
      setDeviceListHint([]);
      resetUIOnDisconnect();
    }
  });

  DOM["btn-disconnect"]?.addEventListener("click", () => {
    if (AppState.device && AppState.device.gatt && AppState.device.gatt.connected) {
      log("Trenne Verbindung manuell...", "info");
      clearReconnect();
      AppState.device.gatt.disconnect();
    }
  });
});

window.sendBluetoothCommand = sendBluetoothCommand;
window.sendStrengthCommand = sendStrengthCommand;
window.sendWaveformCommand = sendWaveformCommand;
window.sendV3Init = sendV3Init;
window.sendV3EmergencyStop = sendV3EmergencyStop;
window.updateBatteryUI = updateBatteryUI;
window.resetUIOnDisconnect = resetUIOnDisconnect;
window.clearReconnect = clearReconnect;
