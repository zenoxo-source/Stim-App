// protocol-utils.js - Pure helpers (browser global + Node require for tests)
(function (global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    global.ProtocolUtils = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function getDeviceStrength(val, softLimit, masterScale) {
    const clamped = Math.min(softLimit, Math.max(0, Math.round(Number(val) || 0)));
    const scale = typeof masterScale === "number" && !Number.isNaN(masterScale) ? masterScale : 1;
    return Math.min(200, Math.max(0, Math.round(clamped * scale)));
  }

  function scaleWaveAmp(amp, masterScale) {
    const scale = typeof masterScale === "number" && !Number.isNaN(masterScale) ? masterScale : 1;
    return Math.min(100, Math.max(0, Math.round((Number(amp) || 0) * scale)));
  }

  /**
   * Pulse-width slider (0–100) as wave amplitude scale. Default 100 = full amp.
   */
  function applyPulseWidthScale(amp, pulseWidth) {
    const pw = Number(pulseWidth);
    const scale = Number.isNaN(pw) ? 1 : Math.min(100, Math.max(0, pw)) / 100;
    return Math.min(100, Math.max(0, Math.round((Number(amp) || 0) * scale)));
  }

  /**
   * Coyote V3: intensity 0–100 active, 101 = inactive channel segment.
   * Freq 0 when inactive.
   */
  function resolveWaveSegment(freq, amp) {
    const a = Math.round(Number(amp) || 0);
    if (a <= 0) {
      return { freq: 0, intensity: 101 };
    }
    const f = Math.max(10, Math.min(240, Math.round(Number(freq) || 45)));
    return { freq: f, intensity: Math.min(100, a) };
  }

  function fillChannelWave(data, freqOffset, intOffset, freq, intensity) {
    for (let i = 0; i < 4; i++) {
      data[freqOffset + i] = freq;
      data[intOffset + i] = intensity;
    }
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
    resolveWaveSegment,
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
