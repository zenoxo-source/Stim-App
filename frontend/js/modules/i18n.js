// i18n.js - Internationalization (DE / EN).
//
// STRATEGY: rather than requiring data-i18n attributes on every element
// (which would need ~200 manual annotations in index.html alone), we scan
// ALL text-bearing DOM nodes on language switch and replace known German
// strings with their English equivalents (and vice-versa). Dynamic strings
// set via JS use the exported t() / i18nText() helpers.
//
// Translations are keyed by their German form (the default UI language).
// When switching to EN we walk the DOM and replace each match; switching
// back to DE reverses the lookup.

import { log } from "../state.js";

// -------------------------------------------------------------------------
// Complete translation map — one entry per user-visible string.
// Keys are stable identifiers; DE/EN are the actual rendered strings.
// -------------------------------------------------------------------------

const MAP = [
  // -- sidebar / navigation --------------------------------------------
  { key: "nav_deck", de: "Control Deck", en: "Control Deck" },
  { key: "nav_stim", de: "STIM Player", en: "STIM Player" },
  { key: "nav_games", de: "Mini-Spiele", en: "Mini-Games" },
  { key: "nav_editor", de: "Pattern Editor", en: "Pattern Editor" },
  { key: "nav_remote", de: "Remote", en: "Remote" },
  { key: "nav_ai", de: "AI Chat", en: "AI Chat" },
  { key: "nav_settings", de: "Einstellungen", en: "Settings" },
  { key: "btn_connect", de: "Bluetooth Verbinden", en: "Connect Bluetooth" },
  { key: "btn_disconnect", de: "Trennen", en: "Disconnect" },
  { key: "btn_panic", de: "STOPP", en: "STOP" },
  { key: "conn_disconnected", de: "Getrennt", en: "Disconnected" },
  { key: "conn_searching", de: "Suche...", en: "Searching..." },
  { key: "conn_connected", de: "Verbunden", en: "Connected" },
  { key: "output_off", de: "Ausgabe: aus", en: "Output: off" },
  { key: "output_active", de: "Ausgabe: aktiv", en: "Output: active" },
  { key: "panic_stopped", de: "PANIC – Ausgabe gestoppt", en: "PANIC – Output stopped" },
  { key: "connected_ready", de: "Verbunden · bereit", en: "Connected · ready" },
  { key: "ready_chip", de: "Bereit", en: "Ready" },
  { key: "language", de: "Sprache", en: "Language" },
  { key: "theme", de: "Theme", en: "Theme" },

  // -- header / presets --------------------------------------------------
  { key: "preset_gentle", de: "Sanft", en: "Gentle" },
  { key: "preset_medium", de: "Mittel", en: "Medium" },
  { key: "preset_intense", de: "Intensiv", en: "Intense" },
  { key: "timer_out", de: "Timer aus", en: "Timer off" },
  { key: "master", de: "Master:", en: "Master:" },

  // -- channels ----------------------------------------------------------
  { key: "channel_a", de: "Kanal A", en: "Channel A" },
  { key: "channel_b", de: "Kanal B", en: "Channel B" },
  { key: "intensity", de: "Intensität", en: "Intensity" },
  { key: "frequency", de: "Frequenz", en: "Frequency" },
  { key: "pulse_width", de: "Pulsweite", en: "Pulse Width" },
  { key: "wave_freq", de: "Wave-Freq", en: "Wave-Freq" },
  { key: "wave_amp", de: "Wave-Amp %", en: "Wave-Amp %" },
  { key: "direct", de: "Direkt", en: "Direct" },
  { key: "soft_limit", de: "Soft-Limit", en: "Soft Limit" },
  { key: "master_chip", de: "Master", en: "Master" },

  // -- freq labels -------------------------------------------------------
  { key: "freq_very_soft", de: "sehr weich", en: "very soft" },
  { key: "freq_soft", de: "weich", en: "soft" },
  { key: "freq_gentle", de: "sanft", en: "gentle" },
  { key: "freq_standard", de: "standard", en: "standard" },
  { key: "freq_medium", de: "mittel", en: "medium" },
  { key: "freq_strong", de: "kräftig", en: "strong" },
  { key: "freq_high", de: "hoch", en: "high" },
  { key: "freq_very_high", de: "sehr hoch", en: "very high" },
  { key: "freq_extreme", de: "extrem", en: "extreme" },
  { key: "freq_maximum", de: "maximum", en: "maximum" },

  // -- patterns ----------------------------------------------------------
  { key: "patterns", de: "Muster", en: "Patterns" },
  { key: "sessions", de: "Sessions", en: "Sessions" },
  { key: "stop_pattern", de: "Pattern stoppen", en: "Stop Pattern" },
  { key: "dice_mode", de: "Dice", en: "Dice" },
  { key: "music_sync", de: "Music-Sync", en: "Music-Sync" },
  { key: "stop", de: "Stop", en: "Stop" },

  // -- ramp --------------------------------------------------------------
  { key: "ramp_title", de: "Strength Ramp (Trainingsmodus)", en: "Strength Ramp (Training Mode)" },
  {
    key: "ramp_desc",
    de: "Linear hochfahren auf Ziel-Strength über X Minuten. Respektiert Soft-Limits, Panic-Cooldown und ist jederzeit abbrechbar.",
    en: "Ramp linearly to target strength over X minutes. Respects soft limits, panic cooldown, cancelable at any time.",
  },
  { key: "ramp_target_a", de: "Ziel A", en: "Target A" },
  { key: "ramp_target_b", de: "Ziel B", en: "Target B" },
  { key: "ramp_duration", de: "Dauer (Min)", en: "Duration (Min)" },
  { key: "ramp_inactive", de: "Keine aktive Ramp", en: "No active ramp" },
  { key: "ramp_start", de: "Start", en: "Start" },

  // -- sessions ----------------------------------------------------------
  { key: "multi_phase_title", de: "Multi-Phase Sessions", en: "Multi-Phase Sessions" },
  {
    key: "multi_phase_desc",
    de: "Choreografierte Verläufe mit mehreren Phasen – wie ein Stim-Track.",
    en: "Choreographed progressions with multiple phases – like a stim track.",
  },

  // -- stim player -------------------------------------------------------
  {
    key: "stim_import_title",
    de: "STIM-Datei Import (MP3 / Audio)",
    en: "STIM File Import (MP3 / Audio)",
  },
  {
    key: "stim_drop_text",
    de: "Klicke zum Auswählen oder ziehe Audio-Dateien hierher",
    en: "Click to select or drag audio files here",
  },
  { key: "stim_no_file", de: "Keine Datei geladen", en: "No file loaded" },
  { key: "stim_hear_audio", de: "Audio hören:", en: "Hear audio:" },
  { key: "stim_ear_audio", de: "STIM-Audio hörbar", en: "STIM audio audible" },

  // -- games -------------------------------------------------------------
  { key: "game_play_btn", de: "Spiel starten", en: "Start Game" },
  { key: "game_exit", de: "Beenden", en: "Exit" },
  { key: "game_start_prompt", de: "Klicke um zu starten", en: "Click to start" },
  { key: "game_hold", de: "GEDRÜCKT HALTEN", en: "HOLD DOWN" },
  { key: "game_surrender", de: "Aufgeben", en: "Surrender" },
  { key: "game_tap", de: "JETZT TAPPEN!", en: "TAP NOW!" },
  { key: "achievements", de: "Erfolge", en: "Achievements" },
  { key: "game_searching", de: "Suche Spieler...", en: "Searching player..." },
  { key: "challenge_start", de: "Challenge starten", en: "Start Challenge" },
  { key: "game_config_btn", de: "Spiel-Einstellungen", en: "Game Settings" },
  { key: "game_reset", de: "Zurücksetzen", en: "Reset" },

  // -- editor ------------------------------------------------------------
  { key: "editor_save", de: "Speichern", en: "Save" },
  { key: "editor_play", de: "Abspielen", en: "Play" },
  { key: "editor_stop", de: "Stop", en: "Stop" },
  { key: "editor_clear", de: "Leeren", en: "Clear" },
  { key: "editor_random", de: "Zufall", en: "Random" },
  { key: "editor_smooth", de: "Glätten", en: "Smooth" },
  { key: "editor_export", de: "Export", en: "Export" },
  { key: "editor_import", de: "Import", en: "Import" },
  { key: "editor_steps", de: "Schritte:", en: "Steps:" },
  { key: "editor_shift_left", de: "Nach links schieben", en: "Shift left" },
  { key: "editor_shift_right", de: "Nach rechts schieben", en: "Shift right" },
  { key: "editor_invert", de: "Invertieren", en: "Invert" },
  { key: "editor_mirror", de: "Spiegeln", en: "Mirror" },
  { key: "editor_fade_in", de: "Einblenden", en: "Fade In" },
  { key: "editor_fade_out", de: "Ausblenden", en: "Fade Out" },
  { key: "editor_copy_a2b", de: "Kopiere A → B", en: "Copy A → B" },
  { key: "editor_copy_b2a", de: "Kopiere B → A", en: "Copy B → A" },
  { key: "editor_saved", de: "Gespeicherte Patterns", en: "Saved Patterns" },
  { key: "editor_preset_sine", de: "Sinus", en: "Sine" },
  { key: "editor_preset_saw", de: "Sägezahn", en: "Sawtooth" },
  { key: "editor_preset_square", de: "Rechteck", en: "Square" },
  { key: "editor_preset_ramp", de: "Rampe", en: "Ramp" },
  { key: "editor_preset_triangle", de: "Dreieck", en: "Triangle" },
  { key: "editor_live_playing", de: "Live: Pattern wird abgespielt", en: "Live: Pattern playing" },
  { key: "editor_schritt", de: "Schritt", en: "Step" },

  // -- remote ------------------------------------------------------------
  { key: "remote_server_title", de: "WebSocket-Server", en: "WebSocket Server" },
  { key: "remote_status", de: "gestoppt", en: "stopped" },
  { key: "remote_start", de: "Server starten", en: "Start Server" },
  { key: "remote_stop", de: "Server stoppen", en: "Stop Server" },
  { key: "remote_copy_token", de: "Token kopieren", en: "Copy Token" },
  { key: "remote_waiting", de: "Warte auf Befehle", en: "Waiting for commands" },
  { key: "remote_send", de: "Senden", en: "Send" },
  { key: "remote_code_title", de: "Client-Codebeispiele", en: "Client Code Examples" },
  { key: "remote_api_title", de: "API-Referenz", en: "API Reference" },
  { key: "remote_log_clear", de: "Löschen", en: "Delete" },
  { key: "remote_filter_all", de: "Alle", en: "All" },
  { key: "remote_filter_ok", de: "Nur OK", en: "OK Only" },
  { key: "remote_filter_err", de: "Nur Fehler", en: "Errors Only" },
  { key: "remote_filter_warn", de: "Nur Warnungen", en: "Warnings Only" },

  // -- AI chat -----------------------------------------------------------
  { key: "ai_ready", de: "Bereit.", en: "Ready." },
  { key: "ai_placeholder", de: "Schreibe eine Anweisung...", en: "Write a command..." },
  { key: "ai_panic", de: "PANIC / STOPP", en: "PANIC / STOP" },
  { key: "ai_new_chat", de: "Neuer Chat", en: "New Chat" },
  { key: "ai_last_sessions", de: "Letzte Sessions", en: "Last Sessions" },
  { key: "ai_welcome", de: "Willkommen im AI-Control Raum", en: "Welcome to the AI-Control Room" },
  { key: "ai_start_session", de: "Session Starten", en: "Start Session" },

  // -- settings ----------------------------------------------------------
  { key: "settings_security", de: "Sicherheit", en: "Safety" },
  { key: "settings_app", de: "App", en: "App" },
  { key: "settings_ai", de: "AI (LLM)", en: "AI (LLM)" },
  { key: "settings_remote", de: "Remote-Server", en: "Remote Server" },
  { key: "settings_recorder", de: "Session Recorder", en: "Session Recorder" },
  { key: "settings_stats", de: "Statistiken", en: "Statistics" },
  { key: "settings_about", de: "Über Stim App", en: "About Stim App" },
  { key: "settings_patterns", de: "Pattern Editor", en: "Pattern Editor" },
  { key: "settings_device", de: "Gerät", en: "Device" },
  { key: "settings_swap", de: "Kanäle tauschen (A ↔ B)", en: "Swap channels (A ↔ B)" },
  {
    key: "settings_debug",
    de: "BLE Debug-Modus (Hex-Dump im Log)",
    en: "BLE Debug Mode (hex dump in log)",
  },
  {
    key: "debug_mode",
    de: "BLE Debug-Modus (Hex-Dump im Log)",
    en: "BLE Debug Mode (hex dump in log)",
  },
  { key: "settings_export", de: "Export", en: "Export" },
  { key: "settings_import", de: "Import", en: "Import" },
  { key: "settings_onboarding", de: "Einführung", en: "Onboarding" },
  { key: "panorama_protect", de: "Nicht verbunden", en: "Not connected" },
  {
    key: "settings_balance_title",
    de: "Wellenform-Balance (Gerät)",
    en: "Waveform Balance (Device)",
  },
  { key: "settings_balance_reset", de: "Balance zurücksetzen", en: "Reset Balance" },
  { key: "settings_anbieter", de: "Anbieter", en: "Provider" },
  { key: "settings_model", de: "Modell", en: "Model" },
  { key: "settings_ollama", de: "Ollama (lokal)", en: "Ollama (local)" },
  { key: "settings_update_check", de: "Nach Updates suchen", en: "Check for Updates" },
  { key: "settings_update_install", de: "Jetzt installieren", en: "Install Now" },
  {
    key: "settings_diag_title",
    de: "Diagnose & Konsolen-Protokoll",
    en: "Diagnostics & Console Log",
  },

  // -- profile -----------------------------------------------------------
  { key: "profile_select", de: "Profil wählen", en: "Select Profile" },
  { key: "profile_load", de: "Laden", en: "Load" },
  { key: "profile_update", de: "Aktualisieren", en: "Update" },
  { key: "profile_new", de: "Neu", en: "New" },
  { key: "profile_rename", de: "Umbenennen", en: "Rename" },
  { key: "profile_delete", de: "Löschen", en: "Delete" },
  { key: "profile_create", de: "Erstellen", en: "Create" },
  { key: "profile_cancel", de: "Abbrechen", en: "Cancel" },

  // -- hotkeys -----------------------------------------------------------
  { key: "hotkeys_title", de: "Tastatur-Shortcuts", en: "Keyboard Shortcuts" },
  { key: "hotkeys_reset", de: "Alle zurücksetzen", en: "Reset All" },

  // -- recorder ----------------------------------------------------------
  { key: "rec_start", de: "Aufnahme starten", en: "Start Recording" },
  { key: "rec_stop", de: "Aufnahme stoppen", en: "Stop Recording" },
  { key: "rec_play", de: "Abspielen", en: "Play" },
  { key: "rec_save", de: "Speichern", en: "Save" },
  { key: "rec_no_recording", de: "Keine Aufnahme", en: "No recording" },

  // -- scheduler ---------------------------------------------------------
  { key: "sched_title", de: "Session-Scheduler", en: "Session Scheduler" },
  { key: "sched_add", de: "Planen", en: "Schedule" },

  // -- triggers ----------------------------------------------------------
  { key: "trig_title", de: "Trigger-System", en: "Trigger System" },
  { key: "trig_add", de: "Hinzufügen", en: "Add" },
  { key: "trig_arm", de: "Scharfstellen", en: "Arm" },

  // -- AI memory ---------------------------------------------------------
  { key: "mem_title", de: "AI-Memory", en: "AI Memory" },
  { key: "mem_like", de: "Mag", en: "Like" },
  { key: "mem_dislike", de: "Mag nicht", en: "Dislike" },
  { key: "mem_preference", de: "Präferenz", en: "Preference" },
  { key: "mem_fact", de: "Fakt", en: "Fact" },
  { key: "mem_note", de: "Notiz", en: "Note" },

  // -- MIDI --------------------------------------------------------------
  { key: "midi_title", de: "MIDI-Controller", en: "MIDI Controller" },
  { key: "midi_activate", de: "MIDI aktivieren", en: "Activate MIDI" },
  { key: "midi_not_active", de: "Nicht aktiv", en: "Not active" },

  // -- Session-PIN -------------------------------------------------------
  { key: "pin_title", de: "Session-PIN", en: "Session PIN" },
  { key: "pin_set", de: "PIN setzen", en: "Set PIN" },
  { key: "pin_remove", de: "Entfernen", en: "Remove" },
  { key: "pin_lock", de: "Sperren", en: "Lock" },
  { key: "pin_unlock", de: "Entsperren", en: "Unlock" },
  { key: "pin_not_set", de: "Kein PIN gesetzt", en: "No PIN set" },

  // -- keyboard help -----------------------------------------------------
  { key: "hotkey_help", de: "Tastatur", en: "Keyboard" },
  { key: "hotkey_panic", de: "Panic", en: "Panic" },
  { key: "hotkey_close", de: "Schließen", en: "Close" },

  // -- onboarding --------------------------------------------------------
  { key: "onboarding_welcome", de: "Willkommen bei Stim App", en: "Welcome to Stim App" },
  { key: "onboarding_skip", de: "Überspringen", en: "Skip" },
  { key: "onboarding_next", de: "Weiter", en: "Next" },
  { key: "onboarding_done", de: "Fertig", en: "Done" },

  // -- connection labels -------------------------------------------------
  { key: "conn_label", de: "Verbindung:", en: "Connection:" },
];

// -------------------------------------------------------------------------
// Fast-lookup indices (built once at init, rebuilt on addTranslation).
// -------------------------------------------------------------------------

/** @type {Record<string, {key:string,de:string,en:string}>} key -> entry */
const byKey = {};

/** DE text -> entry (for scanning DOM when switching to EN) */
const deIndex = {};

/** EN text -> entry (for scanning DOM when switching back to DE) */
const enIndex = {};

function rebuildIndices() {
  for (const e of MAP) {
    byKey[e.key] = e;
    deIndex[e.de] = e;
    enIndex[e.en] = e;
  }
}
rebuildIndices();

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

export const I18N = {
  currentLang: "de",

  /** Map of keys to the current-language text for quick JS lookups. */
  _currentMap: null,

  init() {
    const saved = localStorage.getItem("stim_app_lang");
    if (saved === "en") {
      this.currentLang = "en";
    }
    this._currentMap = this.currentLang === "en" ? enIndex : deIndex;
    this.apply();
  },

  setLang(lang) {
    if (lang !== "de" && lang !== "en") return;
    this.currentLang = lang;
    this._currentMap = lang === "en" ? enIndex : deIndex;
    localStorage.setItem("stim_app_lang", lang);
    this.apply();
    log(`Sprache: ${lang === "de" ? "Deutsch" : "English"}`, "info");

    const toggle = document.getElementById("btn-lang-toggle");
    if (toggle) {
      toggle.textContent = lang === "de" ? "EN" : "DE";
    }
  },

  /**
   * Translate a key to the current language text.
   * @param {string} key
   * @param {string} [fallback]
   * @returns {string}
   */
  t(key, fallback) {
    const entry = byKey[key];
    if (!entry) return fallback || key;
    return this.currentLang === "en" ? entry.en : entry.de;
  },

  /**
   * Walk the entire DOM tree and swap all known text nodes between DE ↔ EN.
   * Called on language switch AND on first init.
   *
   * Strategy: for every TEXT node in the document, check if its content
   * appears in the source-language index and replace it with the
   * target-language equivalent. This catches dynamically-set text too.
   */
  apply() {
    document.documentElement.lang = this.currentLang;

    const sourceIdx = this.currentLang === "en" ? deIndex : enIndex;
    walkTextNodes(document.body, sourceIdx);

    // Also update the lang toggle button
    const toggle = document.getElementById("btn-lang-toggle");
    if (toggle) {
      toggle.textContent = this.currentLang === "de" ? "EN" : "DE";
    }
  },

  toggle() {
    this.setLang(this.currentLang === "de" ? "en" : "de");
  },
};

// -------------------------------------------------------------------------
// Text-node walker — the core of the auto-translation engine.
// -------------------------------------------------------------------------

/**
 * Recursively walk all text nodes under `root` and replace known strings.
 *
 * @param {Node} root
 * @param {Record<string, object>} sourceIdx  map of old-text -> {key, de, en}
 */
function walkTextNodes(root, sourceIdx) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const toReplace = [];
  // Collect first (don't mutate during walk)
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    if (!text || !text.trim()) continue;
    for (const sourceText of Object.keys(sourceIdx)) {
      if (text.includes(sourceText)) {
        toReplace.push({ node, sourceText, entry: sourceIdx[sourceText] });
      }
    }
  }
  // Replace (batch-apply to avoid modifying DOM during tree-walk)
  for (const { node, sourceText, entry } of toReplace) {
    const targetText = I18N.currentLang === "en" ? entry.en : entry.de;
    node.textContent = node.textContent.replace(sourceText, targetText);
  }
}

/**
 * Re-scan the DOM for updates (called after dynamic content changes).
 * Debounced — safe to call frequently.
 */
export function refreshI18n() {
  // Simple debounce using a module-level timer
  if (refreshI18n._timer) clearTimeout(refreshI18n._timer);
  refreshI18n._timer = setTimeout(() => I18N.apply(), 100);
}
refreshI18n._timer = null;

// -------------------------------------------------------------------------
// Convenience shortcut for JavaScript code that sets text programmatically.
// Use:   el.textContent = i18nText("Cancel", "Abbrechen");
// Always pass the GERMAN form as the fallback (it's the default language).
// -------------------------------------------------------------------------

/**
 * Return the current-language text for a given key.
 * If no key exists, returns the key itself as fallback.
 *
 * @param {string} key  stable i18n key (see MAP above)
 * @param {string} [fallback]  text to use when key is unknown
 * @returns {string}
 */
export function i18nText(key, fallback) {
  const entry = byKey[key];
  if (!entry) return fallback || key;
  return I18N.currentLang === "en" ? entry.en : entry.de;
}

// Register the DOMContentLoaded handler
document.addEventListener("DOMContentLoaded", () => {
  I18N.init();
  document.getElementById("btn-lang-toggle")?.addEventListener("click", () => I18N.toggle());
});
