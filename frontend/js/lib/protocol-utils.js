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

  return {
    getDeviceStrength,
    scaleWaveAmp,
    buildEmergencyStopBytes,
    escapeHtml,
    isCoyoteDeviceName,
  };
});
