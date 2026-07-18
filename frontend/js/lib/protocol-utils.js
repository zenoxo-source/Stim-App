// protocol-utils.js - Pure helpers (browser global + Node require for tests)
(function (global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    global.ProtocolUtils = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * @param {number} val
   * @param {number} softLimit
   * @param {number} [masterScale=1]
   * @returns {number}
   */
  function getDeviceStrength(val, softLimit, masterScale) {
    const clamped = Math.min(softLimit, Math.max(0, Math.round(Number(val) || 0)));
    const scale = typeof masterScale === "number" && !Number.isNaN(masterScale) ? masterScale : 1;
    return Math.min(200, Math.max(0, Math.round(clamped * scale)));
  }

  /**
   * @param {number} amp
   * @param {number} masterScale
   * @returns {number}
   */
  function scaleWaveAmp(amp, masterScale) {
    const scale = typeof masterScale === "number" && !Number.isNaN(masterScale) ? masterScale : 1;
    return Math.min(100, Math.max(0, Math.round((Number(amp) || 0) * scale)));
  }

  /**
   * Pulse-width slider (0–100) as wave amplitude scale. Default 100 = full amp.
   * @param {number} amp
   * @param {number} pulseWidth
   * @returns {number}
   */
  function applyPulseWidthScale(amp, pulseWidth) {
    const pw = Number(pulseWidth);
    const scale = Number.isNaN(pw) ? 1 : Math.min(100, Math.max(0, pw)) / 100;
    return Math.min(100, Math.max(0, Math.round((Number(amp) || 0) * scale)));
  }

  /**
   * Official V3 optional mapping: logical program range 10–1000 → wire 10–240.
   * Stim App primarily uses wire values; this helps STIM/audio mapping.
   * @param {number} input
   * @returns {number}
   */
  function encodeWaveFreqLogical(input) {
    const v = Math.round(Number(input) || 10);
    if (v < 10) return 10;
    if (v <= 100) return v;
    if (v <= 600) return Math.min(240, Math.round((v - 100) / 5 + 100));
    if (v <= 1000) return Math.min(240, Math.round((v - 600) / 10 + 200));
    return 240;
  }

  /** Clamp already-wire frequency (10–240).
   * @param {number} freq
   * @returns {number}
   */
  function clampWireFreq(freq) {
    const f = Math.round(Number(freq) || 45);
    if (f <= 0) return 0;
    return Math.max(10, Math.min(240, f));
  }

  /**
   * Human-readable sensation label for wire freq (not literal Hz).
   * @param {number} wire
   * @returns {string}
   */
  function waveFreqLabel(wire) {
    const f = clampWireFreq(wire);
    if (f <= 0) return "aus";
    if (f <= 15) return "sehr weich";
    if (f <= 30) return "weich";
    if (f <= 50) return "standard";
    if (f <= 80) return "kräftig";
    if (f <= 120) return "hoch";
    if (f <= 180) return "sehr hoch";
    return "maximum";
  }

  /**
   * Coyote V3: intensity 0–100 active, 101 = inactive channel segment.
   * Freq 0 when inactive. Wire freq is 10–240 (not labeled Hz in protocol).
   * @param {number} freq
   * @param {number} amp
   * @returns {{ freq: number, intensity: number }}
   */
  function resolveWaveSegment(freq, amp) {
    const a = Math.round(Number(amp) || 0);
    if (a <= 0) {
      return { freq: 0, intensity: 101 };
    }
    return { freq: clampWireFreq(freq), intensity: Math.min(100, a) };
  }

  /**
   * @param {Uint8Array} data
   * @param {number} freqOffset
   * @param {number} intOffset
   * @param {number} freq
   * @param {number} intensity
   */
  function fillChannelWave(data, freqOffset, intOffset, freq, intensity) {
    for (let i = 0; i < 4; i++) {
      data[freqOffset + i] = freq;
      data[intOffset + i] = intensity;
    }
  }

  /**
   * Build a complete V3 0xB0 packet (20 bytes).
   * @param {object} opts
   * @param {number} [opts.sequence=0] sequence number 0–15
   * @param {number} [opts.mode=0] mode nibble (0bLLLL for A, 0b00LL for B)
   * @param {number} [opts.strengthA=0] channel A strength 0–200
   * @param {number} [opts.strengthB=0] channel B strength 0–200
   * @param {number} [opts.freqA=0] channel A wire frequency 10–240 (0 = inactive)
   * @param {number} [opts.intensityA=101] channel A wave intensity 0–100 (101 = inactive)
   * @param {number} [opts.freqB=0] channel B wire frequency 10–240 (0 = inactive)
   * @param {number} [opts.intensityB=101] channel B wave intensity 0–100 (101 = inactive)
   * @returns {Uint8Array} 20-byte B0 packet
   */
  function buildB0Packet(opts) {
    const o = opts || {};
    const data = new Uint8Array(20);
    data[0] = 0xb0;
    data[1] = ((o.sequence & 0x0f) << 4) | (o.mode & 0x0f);
    data[2] = Math.min(200, Math.max(0, Math.round(Number(o.strengthA) || 0)));
    data[3] = Math.min(200, Math.max(0, Math.round(Number(o.strengthB) || 0)));
    fillChannelWave(data, 4, 8, o.freqA | 0, o.intensityA | 0);
    fillChannelWave(data, 12, 16, o.freqB | 0, o.intensityB | 0);
    return data;
  }

  /**
   * Convert a Uint8Array to a hex string for debugging.
   * @param {Uint8Array} bytes
   * @returns {string} e.g. "B0 0F 00 00 2D 2D 2D 2D 64 64 64 64 00 00 00 00 65 65 65 65"
   */
  function bytesToHex(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i++) {
      parts.push(bytes[i].toString(16).padStart(2, "0").toUpperCase());
    }
    return parts.join(" ");
  }

  function buildEmergencyStopBytes() {
    return buildSoftStopBytes({ strengthA: 0, strengthB: 0, modeNibble: 0x0f });
  }

  /**
   * Soft-stop 0xB0: inactive waveforms (freq 0, intensity 101).
   * @param {{ strengthA?: number, strengthB?: number, modeNibble?: number }} opts
   */
  function buildSoftStopBytes(opts) {
    const o = opts || {};
    const data = new Uint8Array(20);
    data[0] = 0xb0;
    data[1] = (o.modeNibble !== undefined ? o.modeNibble : 0x0f) & 0xff;
    data[2] = Math.min(200, Math.max(0, Math.round(Number(o.strengthA) || 0)));
    data[3] = Math.min(200, Math.max(0, Math.round(Number(o.strengthB) || 0)));
    fillChannelWave(data, 4, 8, 0, 101);
    fillChannelWave(data, 12, 16, 0, 101);
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isCoyoteDeviceName(name) {
    const n = String(name || "");
    return n.includes("47L121") || n.toLowerCase().includes("coyote");
  }

  /**
   * Build a portable settings object (no secrets).
   * @param {object} state partial AppState-like fields
   * @param {object} aiFields provider/endpoint/model/prompt
   */
  function buildSettingsExport(state, aiFields) {
    const s = state || {};
    const ai = aiFields || {};
    return {
      format: "stim-app-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        softLimitA: Number(s.softLimitA) || 150,
        softLimitB: Number(s.softLimitB) || 150,
        masterScale: typeof s.masterScale === "number" ? s.masterScale : 1,
        frequencyA: Number(s.frequencyA) || 45,
        frequencyB: Number(s.frequencyB) || 45,
        pulseWidthA: Number(s.pulseWidthA) || 100,
        pulseWidthB: Number(s.pulseWidthB) || 100,
        freqBalanceA: clampInt(s.freqBalanceA, 0, 255, 160),
        freqBalanceB: clampInt(s.freqBalanceB, 0, 255, 160),
        waveBalanceA: clampInt(s.waveBalanceA, 0, 255, 0),
        waveBalanceB: clampInt(s.waveBalanceB, 0, 255, 0),
        swapChannels: !!s.swapChannels,
        audioHearSound: s.audioHearSound !== false,
        aiProvider: ai.aiProvider || "ollama",
        aiEndpoint: ai.aiEndpoint || "http://localhost:11434/v1/chat/completions",
        aiModel: ai.aiModel || "qwen2.5",
        aiSystemPrompt: ai.aiSystemPrompt || "",
      },
    };
  }

  function parseSettingsImport(raw) {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") throw new Error("Ungültige Datei");
    const settings = data.settings || data;
    if (typeof settings !== "object") throw new Error("Keine settings gefunden");
    // Strip secrets if present
    delete settings.aiApiKey;
    delete settings.githubToken;
    delete settings.ghToken;
    return {
      softLimitA: clampInt(settings.softLimitA, 10, 200, 150),
      softLimitB: clampInt(settings.softLimitB, 10, 200, 150),
      masterScale: clampNum(settings.masterScale, 0, 1, 1),
      frequencyA: clampInt(settings.frequencyA, 10, 240, 45),
      frequencyB: clampInt(settings.frequencyB, 10, 240, 45),
      pulseWidthA: clampInt(settings.pulseWidthA, 0, 100, 100),
      pulseWidthB: clampInt(settings.pulseWidthB, 0, 100, 100),
      freqBalanceA: clampInt(settings.freqBalanceA, 0, 255, 160),
      freqBalanceB: clampInt(settings.freqBalanceB, 0, 255, 160),
      waveBalanceA: clampInt(settings.waveBalanceA, 0, 255, 0),
      waveBalanceB: clampInt(settings.waveBalanceB, 0, 255, 0),
      swapChannels: !!settings.swapChannels,
      audioHearSound: settings.audioHearSound !== false,
      aiProvider: String(settings.aiProvider || "ollama"),
      aiEndpoint: String(settings.aiEndpoint || "http://localhost:11434/v1/chat/completions"),
      aiModel: String(settings.aiModel || "qwen2.5"),
      aiSystemPrompt: String(settings.aiSystemPrompt || ""),
    };
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clampNum(v, min, max, fallback) {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** Pure highscore merge (for tests / shared logic). */
  function mergeHighscore(store, gameId, score) {
    const all = { ...(store || {}) };
    const prev = Number(all[gameId] || 0);
    const n = Number(score) || 0;
    if (n > prev) {
      all[gameId] = n;
      return { store: all, isNew: true, best: n };
    }
    return { store: all, isNew: false, best: prev };
  }

  return {
    getDeviceStrength,
    scaleWaveAmp,
    applyPulseWidthScale,
    encodeWaveFreqLogical,
    clampWireFreq,
    waveFreqLabel,
    resolveWaveSegment,
    buildB0Packet,
    bytesToHex,
    buildEmergencyStopBytes,
    buildSoftStopBytes,
    fillChannelWave,
    escapeHtml,
    isCoyoteDeviceName,
    buildSettingsExport,
    parseSettingsImport,
    mergeHighscore,
  };
});
