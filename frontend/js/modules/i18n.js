// i18n.js - Lightweight internationalization (DE/EN)

const I18N_TRANSLATIONS_DE = {
  nav_deck: "Control Deck",
  nav_stim: "STIM Player",
  nav_games: "Mini-Spiele",
  nav_ai: "AI Chat",
  nav_settings: "Einstellungen",
  btn_connect: "Bluetooth Verbinden",
  btn_disconnect: "Trennen",
  btn_panic: "STOPP",
  conn_disconnected: "Getrennt",
  conn_searching: "Suche...",
  conn_connected: "Verbunden",
  output_off: "Ausgabe: aus",
  output_active: "Ausgabe: aktiv",
  settings_security: "Sicherheit",
  settings_app: "App",
  settings_ai: "AI (LLM)",
  settings_remote: "Remote-Server",
  settings_recorder: "Session Recorder",
  settings_stats: "Statistiken",
  settings_about: "Über Stim App",
  settings_patterns: "Pattern Editor",
  channel_a: "Kanal A",
  channel_b: "Kanal B",
  intensity: "Intensität",
  frequency: "Frequenz",
  pulse_width: "Pulsweite",
  master: "Master",
  soft_limit: "Soft-Limit",
  panic_msg: "PANIC – Ausgabe gestoppt",
  debug_mode: "BLE Debug-Modus (Hex-Dump im Log)",
  swap_channels: "Kanäle tauschen (A ↔ B)",
  hear_audio: "STIM-Audio hörbar",
  patterns: "Muster",
  sessions: "Sessions",
  language: "Sprache",
};

const I18N_TRANSLATIONS_EN = {
  nav_deck: "Control Deck",
  nav_stim: "STIM Player",
  nav_games: "Mini-Games",
  nav_ai: "AI Chat",
  nav_settings: "Settings",
  btn_connect: "Connect Bluetooth",
  btn_disconnect: "Disconnect",
  btn_panic: "STOP",
  conn_disconnected: "Disconnected",
  conn_searching: "Searching...",
  conn_connected: "Connected",
  output_off: "Output: off",
  output_active: "Output: active",
  settings_security: "Safety",
  settings_app: "App",
  settings_ai: "AI (LLM)",
  settings_remote: "Remote Server",
  settings_recorder: "Session Recorder",
  settings_stats: "Statistics",
  settings_about: "About Stim App",
  settings_patterns: "Pattern Editor",
  channel_a: "Channel A",
  channel_b: "Channel B",
  intensity: "Intensity",
  frequency: "Frequency",
  pulse_width: "Pulse Width",
  master: "Master",
  soft_limit: "Soft Limit",
  panic_msg: "PANIC – Output stopped",
  debug_mode: "BLE Debug Mode (hex dump in log)",
  swap_channels: "Swap channels (A ↔ B)",
  hear_audio: "STIM audio audible",
  patterns: "Patterns",
  sessions: "Sessions",
  language: "Language",
};

const I18N = {
  currentLang: "de",
  translations: {
    de: I18N_TRANSLATIONS_DE,
    en: I18N_TRANSLATIONS_EN,
  },

  init() {
    const saved = localStorage.getItem("stim_app_lang");
    if (saved && (saved === "de" || saved === "en")) {
      this.currentLang = saved;
    }
    this.apply();
  },

  setLang(lang) {
    if (lang !== "de" && lang !== "en") return;
    this.currentLang = lang;
    localStorage.setItem("stim_app_lang", lang);
    this.apply();
    log(`Sprache: ${lang === "de" ? "Deutsch" : "English"}`, "info");
  },

  t(key, fallback) {
    const dict = this.translations[this.currentLang] || {};
    return dict[key] || fallback || key;
  },

  apply() {
    document.documentElement.lang = this.currentLang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const translated = this.t(key, el.textContent);
      if (translated) el.textContent = translated;
    });

    const toggle = document.getElementById("btn-lang-toggle");
    if (toggle) {
      toggle.textContent = this.currentLang === "de" ? "EN" : "DE";
    }
  },

  toggle() {
    this.setLang(this.currentLang === "de" ? "en" : "de");
  },
};

document.addEventListener("DOMContentLoaded", () => {
  I18N.init();
  document.getElementById("btn-lang-toggle")?.addEventListener("click", () => I18N.toggle());
});

window.I18N = I18N;
