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

  function buildEmergencyStopBytes() {
    const data = new Uint8Array(20);
    data[0] = 0xb0;
    data[1] = 0x0f; // seq=0, mode both absolute
    data[2] = 0;
    data[3] = 0;
    // Inactive waveform: freq 0, intensity 101
    for (let i = 4; i <= 7; i++) data[i] = 0;
    for (let i = 8; i <= 11; i++) data[i] = 101;
    for (let i = 12; i <= 15; i++) data[i] = 0;
    for (let i = 16; i <= 19; i++) data[i] = 101;
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
        pulseWidthA: Number(s.pulseWidthA) || 15,
        pulseWidthB: Number(s.pulseWidthB) || 15,
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
      pulseWidthA: clampInt(settings.pulseWidthA, 1, 100, 15),
      pulseWidthB: clampInt(settings.pulseWidthB, 1, 100, 15),
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

  return {
    getDeviceStrength,
    scaleWaveAmp,
    buildEmergencyStopBytes,
    escapeHtml,
    isCoyoteDeviceName,
    buildSettingsExport,
    parseSettingsImport,
  };
});
