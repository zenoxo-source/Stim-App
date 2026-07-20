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

  // -- onboarding paragraphs --------------------------------------------
  {
    key: "ob_intro_p",
    de: "Kurzer Einstieg: Sicherheit, Bluetooth und Notstopp. Du kannst das jederzeit überspringen.",
    en: "Quick intro: safety, Bluetooth and emergency stop. You can skip this at any time.",
  },
  { key: "ob_step1_h", de: "1 · Soft-Limits setzen", en: "1 · Set Soft-Limits" },
  {
    key: "ob_step1_p",
    de: "Unter Einstellungen Soft-Limits festlegen und mit niedriger Intensität (Strength) starten. Wave-Freq ist ein Protokollwert 10–240 (kein Hertz). Master im Header skaliert den Output global.",
    en: "Set soft-limits under Settings and start with low intensity (Strength). Wave-Freq is a protocol value 10–240 (not Hertz). Master in the header scales the output globally.",
  },
  { key: "ob_step2_h", de: "2 · Bluetooth verbinden", en: "2 · Connect Bluetooth" },
  {
    key: "ob_step2_p",
    de: "In der Sidebar Bluetooth Verbinden tippen und dein Coyote-Gerät (Prefix 47L121) auswählen. Der Status zeigt Verbindung und Reconnects.",
    en: "Tap Connect Bluetooth in the sidebar and select your Coyote device (prefix 47L121). The status shows connection and reconnects.",
  },
  { key: "ob_step3_h", de: "3 · Panic / STOPP", en: "3 · Panic / STOP" },
  {
    key: "ob_step3_p",
    de: "Rote Taste STOPP, Strg+Leertaste oder ESC lang setzen die Ausgabe sofort auf 0 – die Verbindung bleibt bestehen.",
    en: "Red STOP button, Ctrl+Space or long ESC set output to 0 immediately – the connection remains.",
  },
  {
    key: "ob_done_p",
    de: "Du kannst Control Deck, STIM Player, Spiele und AI nutzen. Viel Spaß – und bleib im sicheren Bereich.",
    en: "You can use Control Deck, STIM Player, games and AI. Have fun – and stay in the safe zone.",
  },

  // -- sidebar / header attributes --------------------------------------
  { key: "title_lang_switch", de: "Sprache wechseln", en: "Switch language" },
  { key: "title_theme_switch", de: "Theme wechseln", en: "Switch theme" },
  { key: "title_device_output", de: "Geräte-Ausgabe", en: "Device output" },
  { key: "aria_conn_status", de: "Verbindungsstatus", en: "Connection status" },
  { key: "aria_bt_connect", de: "Bluetooth verbinden", en: "Connect Bluetooth" },
  { key: "aria_bt_disconnect", de: "Bluetooth trennen", en: "Disconnect Bluetooth" },
  { key: "title_panic", de: "Notstopp (Strg+Leertaste)", en: "Emergency stop (Ctrl+Space)" },
  {
    key: "aria_panic",
    de: "Notstopp – Ausgabe sofort stoppen",
    en: "Emergency stop – stop output immediately",
  },
  { key: "title_keyboard", de: "Tastatur (?)", en: "Keyboard (?)" },

  // -- channel cards -----------------------------------------------------
  { key: "ch_a_blue", de: "Kanal A (Blau)", en: "Channel A (Blue)" },
  { key: "ch_b_red", de: "Kanal B (Rot)", en: "Channel B (Red)" },
  { key: "intensity_range", de: "Intensität (0 - 200)", en: "Intensity (0 - 200)" },
  { key: "hint_no_hz", de: "(10–240, kein Hz)", en: "(10–240, not Hz)" },
  { key: "title_quick_select", de: "Schnellwahl", en: "Quick select" },
  { key: "title_fine_tune_freq", de: "Feinabstimmung Wave-Freq", en: "Fine-tune Wave-Freq" },
  {
    key: "title_scales_amp",
    de: "Skaliert Wellenform-Amplitude",
    en: "Scales waveform amplitude",
  },
  { key: "scope_ch_a", de: "Oszilloskop Kanal A", en: "Oscilloscope Channel A" },
  { key: "scope_ch_b", de: "Oszilloskop Kanal B", en: "Oscilloscope Channel B" },
  { key: "ch_a_scope", de: "CH A Oszilloskop", en: "CH A Oscilloscope" },
  { key: "ch_b_scope", de: "CH B Oszilloskop", en: "CH B Oscilloscope" },
  {
    key: "standard_patterns_title",
    de: "Standard DG-LAB Waveform-Patterns",
    en: "Standard DG-LAB Waveform Patterns",
  },

  // -- roulette / dice / music buttons ----------------------------------
  { key: "title_random_pattern", de: "Zufälliges Pattern", en: "Random pattern" },
  { key: "roulette_btn", de: "🎲 Roulette", en: "🎲 Roulette" },
  { key: "title_dice_pulse", de: "Würfel-Impuls", en: "Dice pulse" },
  { key: "chance_pulse_btn", de: "🎲 Zufallsimpuls", en: "🎲 Random Pulse" },
  { key: "title_dice_mode", de: "Dice-Modus (PR4)", en: "Dice mode (PR4)" },
  {
    key: "title_music_sync",
    de: "Music-Sync (Mikrofon BPM)",
    en: "Music-Sync (microphone BPM)",
  },

  // -- freq select option fragments -------------------------------------
  { key: "freq_10", de: "10 · sehr weich", en: "10 · very soft" },
  { key: "freq_20", de: "20 · weich", en: "20 · soft" },
  { key: "freq_30", de: "30 · sanft", en: "30 · gentle" },
  { key: "freq_45", de: "45 · standard", en: "45 · standard" },
  { key: "freq_60", de: "60 · mittel", en: "60 · medium" },
  { key: "freq_80", de: "80 · kräftig", en: "80 · strong" },
  { key: "freq_100", de: "100 · hoch", en: "100 · high" },
  { key: "freq_150", de: "150 · sehr hoch", en: "150 · very high" },
  { key: "freq_200", de: "200 · extrem", en: "200 · extreme" },
  { key: "freq_240", de: "240 · maximum", en: "240 · maximum" },

  // -- STIM player view --------------------------------------------------
  {
    key: "stim_multi_select",
    de: "Mehrfachauswahl möglich · Amplituden → Kanal A/B in Echtzeit",
    en: "Multiple selection possible · Amplitudes → Channel A/B in real time",
  },
  { key: "title_prev_track", de: "Vorheriger Track", en: "Previous track" },
  { key: "title_next_track", de: "Nächster Track", en: "Next track" },
  { key: "vol_x_master", de: "Lautstärke×Master:", en: "Volume×Master:" },
  {
    key: "title_vol_follows_master",
    de: "Hörlautstärke folgt dem Master-Slider",
    en: "Audible volume follows the master slider",
  },
  {
    key: "vis_ch_a_left",
    de: "Visualizer Kanal A (Links)",
    en: "Visualizer Channel A (Left)",
  },
  {
    key: "vis_ch_b_right",
    de: "Visualizer Kanal B (Rechts)",
    en: "Visualizer Channel B (Right)",
  },
  { key: "sensitivity_a", de: "Empfindlichkeit (A)", en: "Sensitivity (A)" },
  { key: "sensitivity_b", de: "Empfindlichkeit (B)", en: "Sensitivity (B)" },

  // -- games view --------------------------------------------------------
  { key: "today_badge", de: "📅 Heute", en: "📅 Today" },
  { key: "quick_play_btn", de: "⚡ Quick Play", en: "⚡ Quick Play" },
  { key: "reflex_trainer_title", de: "Reflex E-Stim Trainer", en: "Reflex E-Stim Trainer" },
  {
    key: "reflex_trainer_desc",
    de: "Ein Reaktionstest für Körper und Geist. Warte auf das grüne Signal und klicke so schnell wie möglich. Reagierst du zu langsam oder machst einen Fehlstart, wirst du geschockt! Mit jedem Level wird das Zielzeitfenster kürzer.",
    en: "A reaction test for body and mind. Wait for the green signal and click as fast as possible. React too slowly or false-start and you'll be shocked! The target window shrinks with each level.",
  },
  { key: "hs_level", de: "Highscore Level:", en: "Highscore Level:" },
  { key: "rhythm_tapper_title", de: "Rhythm Pulse Tapper", en: "Rhythm Pulse Tapper" },
  {
    key: "rhythm_tapper_desc",
    de: "Tappe im Takt des gezeigten Rhythmus. Der Controller sendet Impulse und visuelle Beats vor, und du musst die Leertaste oder das Feld synchron dazu treffen. Verpasste Beats geben Schocks, Treffer bauen eine Combo für angenehme Vibrationen auf!",
    en: "Tap to the rhythm shown. The controller sends pulses and visual beats in advance, and you must hit the spacebar or field in sync. Missed beats give shocks, hits build a combo for pleasant vibrations!",
  },
  { key: "hs_label", de: "Highscore:", en: "Highscore:" },
  {
    key: "edge_game_desc",
    de: "Halte die Taste – die Intensität steigt. Bleib in der grünen Zone für Punkte. Über der Kante = Schock. Loslassen senkt die Intensität wieder.",
    en: "Hold the button – intensity rises. Stay in the green zone for points. Above the edge = shock. Releasing lowers the intensity again.",
  },
  {
    key: "potato_desc",
    de: `Ein Kanal „brennt" – drücke rechtzeitig A oder B (Tasten/Buttons), bevor die Zeit abläuft. Tempo steigt mit jeder Runde. Falscher Kanal = kleiner Impuls, zu spät = Knall.`,
    en: `One channel „burns" – press A or B in time (keys/buttons) before the clock runs out. Tempo rises each round. Wrong channel = small pulse, too late = bang.`,
  },
  {
    key: "survival_desc",
    de: `Die Intensität steigt langsam und unregelmäßig. Wie lange hältst du durch? Mit Q oder „Aufgeben" endest du und sicherst deinen Score.`,
    en: `Intensity rises slowly and irregularly. How long can you last? With Q or „Give up" you end and save your score.`,
  },
  { key: "reflex_trainer_short", de: "Reflex Trainer", en: "Reflex Trainer" },
  { key: "level_label", de: "Level:", en: "Level:" },
  { key: "reaction_time", de: "Reaktionszeit:", en: "Reaction time:" },
  { key: "target_label", de: "Ziel:", en: "Target:" },
  { key: "shock_level", de: "Schock-Stufe:", en: "Shock level:" },
  {
    key: "wait_for_green",
    de: "Warte nach dem Start auf das grüne Signal",
    en: "After starting, wait for the green signal",
  },
  { key: "points_label", de: "Punkte:", en: "Points:" },
  { key: "combo_label", de: "Combo:", en: "Combo:" },
  { key: "tempo_label", de: "Tempo:", en: "Tempo:" },
  { key: "tap_now_space", de: "JETZT TAPPEN! (Space)", en: "TAP NOW! (Space)" },
  { key: "score_label", de: "Score:", en: "Score:" },
  { key: "channel_label", de: "Kanal:", en: "Channel:" },
  { key: "time_label", de: "Zeit:", en: "Time:" },
  {
    key: "survival_hint",
    de: "Intensität steigt – Soft-Limits greifen weiterhin. Beende mit Q wenn es zu viel wird.",
    en: "Intensity rises – soft limits still apply. End with Q if it gets too much.",
  },
  { key: "surrender_score", de: "Aufgeben (Score)", en: "Give up (Score)" },

  // -- editor view -------------------------------------------------------
  { key: "presets_label", de: "Presets:", en: "Presets:" },
  { key: "ops_label", de: "Ops:", en: "Ops:" },
  { key: "preset_saw", de: "Säge", en: "Saw" },
  { key: "preset_square", de: "Rechteck", en: "Square" },
  { key: "preset_ramp", de: "Rampe", en: "Ramp" },
  { key: "preset_triangle", de: "Dreieck", en: "Triangle" },
  { key: "invert_short", de: "Invert.", en: "Invert." },
  { key: "title_mirror_reverse", de: "Spiegeln (reverse)", en: "Mirror (reverse)" },
  { key: "title_invert", de: "Invertieren (100−val)", en: "Invert (100−val)" },
  { key: "title_fade_in", de: "Einblenden (0→100)", en: "Fade In (0→100)" },
  { key: "title_fade_out", de: "Ausblenden (100→0)", en: "Fade Out (100→0)" },
  { key: "import_preview", de: "Import (Preview)", en: "Import (Preview)" },
  { key: "placeholder_pattern_name", de: "Pattern-Name", en: "Pattern name" },

  // -- remote view -------------------------------------------------------
  {
    key: "remote_server_desc",
    de: "WebSocket-Server für externe Steuerung (z.B. Python, Node, andere Geräte). Nur localhost (127.0.0.1). Token-Auth erforderlich.",
    en: "WebSocket server for external control (e.g. Python, Node, other devices). Localhost only (127.0.0.1). Token auth required.",
  },
  { key: "status_label", de: "Status:", en: "Status:" },
  { key: "port_label", de: "Port:", en: "Port:" },
  {
    key: "auth_token_label",
    de: "Auth-Token (für externe Clients):",
    en: "Auth token (for external clients):",
  },
  { key: "cmd_tester_title", de: "Befehls-Tester", en: "Command Tester" },
  {
    key: "cmd_tester_desc",
    de: "Teste Remote-Befehle direkt aus der App heraus.",
    en: "Test remote commands directly from the app.",
  },
  { key: "sets_intensity", de: "Setzt Intensität:", en: "Sets intensity:" },
  { key: "sets_frequency", de: "Setzt Frequenz:", en: "Sets frequency:" },
  { key: "master_scale_label", de: "Master-Skala:", en: "Master scale:" },
  { key: "load_preset_label", de: "Preset laden:", en: "Load preset:" },
  { key: "custom_waveform_label", de: "Custom Waveform:", en: "Custom waveform:" },
  { key: "starts_pattern", de: "Startet Pattern:", en: "Starts pattern:" },
  { key: "stops_pattern", de: "Stoppt aktuelles Pattern.", en: "Stops the current pattern." },
  {
    key: "panic_sets_zero",
    de: "Panic: Setzt alle Ausgaben auf 0.",
    en: "Panic: Sets all outputs to 0.",
  },
  {
    key: "returns_status",
    de: "Gibt aktuellen Gerätestatus zurück.",
    en: "Returns current device status.",
  },
  {
    key: "lists_patterns",
    de: "Listet alle verfügbaren Pattern-Namen.",
    en: "Lists all available pattern names.",
  },
  { key: "last_n_logs", de: "Letzte N Log-Einträge:", en: "Last N log entries:" },
  { key: "cmd_log_title", de: "Befehls-Log", en: "Command Log" },

  // -- AI Director panel -------------------------------------------------
  {
    key: "director_subtitle",
    de: "Läuft von selbst: generiert Narrative + Stim-Befehle im Rhythmus.",
    en: "Runs by itself: generates narratives + stim commands in rhythm.",
  },
  {
    key: "director_title_full",
    de: "AI Director — autonomer Regisseur",
    en: "AI Director — autonomous conductor",
  },
  { key: "director_inactive", de: "inaktiv", en: "inactive" },
  { key: "director_running", de: "läuft", en: "running" },
  { key: "director_paused", de: "pausiert", en: "paused" },
  {
    key: "director_theme_label",
    de: "Thema / Stimmung (optional)",
    en: "Theme / mood (optional)",
  },
  {
    key: "director_theme_ph",
    de: "z.B. Verhör, sanfte Tease, Ausdauerprüfung...",
    en: "e.g. interrogation, gentle tease, endurance test...",
  },
  { key: "director_interval_label", de: "Beat-Intervall:", en: "Beat interval:" },
  { key: "director_max_label", de: "Max. Intensität:", en: "Max. intensity:" },
  { key: "director_autostop_label", de: "Auto-Stop:", en: "Auto-stop:" },
  {
    key: "director_meta_ready",
    de: "Bereit. LLM in den Einstellungen konfigurieren.",
    en: "Ready. Configure LLM in settings.",
  },
  {
    key: "director_panic_hint",
    de: "ESC lang / Strg+Leertaste = Panic stoppt auch den Director.",
    en: "Long ESC / Ctrl+Space = Panic also stops the Director.",
  },
  {
    key: "director_log_placeholder",
    de: "Director-Narrative erscheinen hier, sobald er läuft.",
    en: "Director narratives appear here once it's running.",
  },
  { key: "director_collapse_title", de: "Ein-/ausklappen", en: "Expand/collapse" },

  // -- AI chat onboarding ------------------------------------------------
  {
    key: "ai_welcome_desc",
    de: "Wähle deine Begleitung für diese Session. Die KI übernimmt die Kontrolle über die Hardware-Intensität und entscheidet über dein Wohlbefinden.",
    en: "Choose your companion for this session. The AI takes control of the hardware intensity and decides on your well-being.",
  },
  {
    key: "ai_name_question",
    de: "Wie darf die KI dich nennen?",
    en: "What may the AI call you?",
  },
  {
    key: "ai_name_placeholder",
    de: "Dein Name / Spitzname",
    en: "Your name / nickname",
  },
  {
    key: "persona_domina_desc",
    de: "Dominant, streng, fordernd.",
    en: "Dominant, strict, demanding.",
  },
  {
    key: "persona_nurse_desc",
    de: "Klinisch, neckend, experimentierfreudig.",
    en: "Clinical, teasing, experimental.",
  },
  {
    key: "persona_master_desc",
    de: "Kalt, sadistisch, berechnend.",
    en: "Cold, sadistic, calculating.",
  },
  { key: "ai_channel_routing", de: "Kanal-Routing Modus", en: "Channel routing mode" },
  { key: "ai_mode_sync", de: "A & B Synchron", en: "A & B Synchronized" },
  { key: "ai_mode_indep", de: "A & B Unabhängig", en: "A & B Independent" },
  { key: "ai_mode_only_a", de: "Nur Kanal A", en: "Only Channel A" },
  { key: "ai_mode_only_b", de: "Nur Kanal B", en: "Only Channel B" },
  { key: "ai_current_pattern", de: "Aktuelles Muster:", en: "Current pattern:" },
  { key: "ai_none", de: "Keines", en: "None" },
  { key: "ai_intensity_a", de: "Intensität A:", en: "Intensity A:" },
  { key: "ai_intensity_b", de: "Intensität B:", en: "Intensity B:" },

  // -- settings view -----------------------------------------------------
  {
    key: "soft_limit_a_label",
    de: "Soft-Limit A (max. Strength)",
    en: "Soft Limit A (max. Strength)",
  },
  {
    key: "soft_limit_b_label",
    de: "Soft-Limit B (max. Strength)",
    en: "Soft Limit B (max. Strength)",
  },
  {
    key: "soft_limits_help",
    de: "Soft-Limits gehen ans Gerät (0xBF) und begrenzen Slider, Patterns, Spiele und AI. Master im Header skaliert den Output zusätzlich (0–100 %). STOPP / Strg+Leertaste = Panic (Ausgabe 0, BLE bleibt).",
    en: "Soft-limits go to the device (0xBF) and cap sliders, patterns, games and AI. Master in the header additionally scales the output (0–100%). STOP / Ctrl+Space = Panic (output 0, BLE stays).",
  },
  {
    key: "balance_help",
    de: "Wird bei Verbinden und bei Limit-Änderung als 0xBF gesendet. Höhere Freq-Balance → tiefere Frequenzen spürbarer. Wave-Balance steuert relative Impulsbreite.",
    en: "Sent on connect and on limit change as 0xBF. Higher freq-balance → lower frequencies more noticeable. Wave-balance controls relative pulse width.",
  },
  { key: "kv_name", de: "Name", en: "Name" },
  { key: "kv_manufacturer", de: "Hersteller-Daten", en: "Manufacturer data" },
  { key: "kv_firmware", de: "Firmware-Daten", en: "Firmware data" },
  { key: "kv_hardware", de: "Hardware-Daten", en: "Hardware data" },
  { key: "kv_bt_prefix", de: "BT-Prefix", en: "BT prefix" },
  { key: "kv_protocol", de: "Protokoll", en: "Protocol" },
  {
    key: "export_help",
    de: "Export ohne API-Keys. Import überschreibt Soft-Limits, Wave-Freq, Balance und AI-Endpoint.",
    en: "Export without API keys. Import overwrites soft-limits, wave-freq, balance and AI endpoint.",
  },
  { key: "profiles_title", de: "Profile", en: "Profiles" },
  {
    key: "profiles_desc",
    de: "Mehrere Konfigurationen (z. B. für verschiedene Partner/Stimmungen). Speichert Soft-Limits, Master-Scale, Frequenzen, AI-Settings.",
    en: "Multiple configurations (e.g. for different partners/moods). Saves soft-limits, master-scale, frequencies, AI settings.",
  },
  { key: "profile_name_ph", de: "Profil-Name", en: "Profile name" },
  {
    key: "hotkeys_help_text",
    de: `Klicke auf eine Kombination und drücke die neue Tasten. „Mod" ist Strg auf Win/Linux, Cmd auf macOS.`,
    en: `Click a combination and press the new keys. „Mod" is Ctrl on Win/Linux, Cmd on macOS.`,
  },
  {
    key: "recorder_desc",
    de: "Zeichnet die Stimulation auf und spielt sie später wieder ab.",
    en: "Records the stimulation and plays it back later.",
  },
  { key: "edit_recording", de: "Aufnahme bearbeiten (PR3)", en: "Edit recording (PR3)" },
  { key: "start_ms", de: "Start (ms)", en: "Start (ms)" },
  { key: "end_ms", de: "Ende (ms)", en: "End (ms)" },
  { key: "loop_iter", de: "Loop-Iterationen", en: "Loop iterations" },
  { key: "fade_dur_ms", de: "Fade-Dauer (ms)", en: "Fade duration (ms)" },
  { key: "trim_btn", de: "Trim", en: "Trim" },
  {
    key: "scheduler_desc",
    de: "Startet Sessions automatisch. Tage als Komma-Liste (0=So, 1=Mo, …, 6=Sa). Leer = einmalig.",
    en: "Starts sessions automatically. Days as comma-list (0=Sun, 1=Mon, …, 6=Sat). Empty = one-shot.",
  },
  { key: "scheduler_days_ph", de: "z.B. 1,3,5", en: "e.g. 1,3,5" },
  {
    key: "triggers_desc",
    de: `Event-getriebene Regeln: „Wenn Stärke A > 100 → Soft-Stop".`,
    en: `Event-driven rules: „When strength A > 100 → soft-stop".`,
  },
  { key: "cond_strength_above", de: "Strength über", en: "Strength above" },
  { key: "cond_strength_below", de: "Strength unter", en: "Strength below" },
  { key: "cond_time_elapsed", de: "Zeit vergangen (s)", en: "Time elapsed (s)" },
  { key: "cond_pattern_active", de: "Pattern aktiv", en: "Pattern active" },
  { key: "cond_audio_playing", de: "Audio läuft", en: "Audio playing" },
  { key: "value_ph", de: "Wert", en: "Value" },
  {
    key: "memory_desc",
    de: "Was sich die AI merkt. Wird in den System-Prompt injiziert.",
    en: "What the AI remembers. Injected into the system prompt.",
  },
  {
    key: "memory_content_ph",
    de: "Inhalt (max 500 Zeichen)",
    en: "Content (max 500 characters)",
  },
  { key: "delete_unpinned", de: "Unpinned löschen", en: "Delete unpinned" },
  { key: "delete_all", de: "Alle löschen", en: "Delete all" },
  {
    key: "midi_desc",
    de: "Hardware-Controller (Korg nanoKONTROL, Akai LPD8 etc.) für Strength / Frequency / Pattern.",
    en: "Hardware controller (Korg nanoKONTROL, Akai LPD8 etc.) for strength / frequency / pattern.",
  },
  { key: "add_mapping", de: "Mapping hinzufügen", en: "Add mapping" },
  { key: "device_substring_ph", de: "Gerät (Substring)", en: "Device (substring)" },
  { key: "cc_fader", de: "CC (Fader)", en: "CC (Fader)" },
  { key: "note_key", de: "Note (Taste)", en: "Note (Key)" },
  { key: "channel_ph", de: "Channel (-1 = alle)", en: "Channel (-1 = all)" },
  { key: "number_ph", de: "Nummer", en: "Number" },
  { key: "both_label", de: "Beide", en: "Both" },
  {
    key: "pin_desc",
    de: "Sperrt Strength-/Slider-/Settings-Änderungen während einer Session. PANIC + Soft-Stop bleiben immer freigeschaltet.",
    en: "Locks strength / slider / settings changes during a session. PANIC + soft-stop always remain enabled.",
  },
  { key: "api_endpoint", de: "API Endpoint", en: "API Endpoint" },
  { key: "api_key_cloud", de: "API Key (Cloud)", en: "API Key (Cloud)" },
  { key: "system_prompt", de: "System Prompt", en: "System Prompt" },
  { key: "openrouter_cloud", de: "OpenRouter (Cloud)", en: "OpenRouter (Cloud)" },
  { key: "app_updates_title", de: "App-Updates", en: "App Updates" },
  {
    key: "app_updates_desc",
    de: "Updates kommen automatisch von den öffentlichen GitHub Releases. In der Entwicklungsversion ist Auto-Update deaktiviert.",
    en: "Updates come automatically from public GitHub releases. Auto-update is disabled in the development version.",
  },
  {
    key: "about_desc",
    de: "Control Deck für DG-LAB Coyote 3.0",
    en: "Control deck for DG-LAB Coyote 3.0",
  },
  {
    key: "safety_note",
    de: "Soft-Limits, Panic-Stopp und Master-Scale schützen vor Überstimulation. Nutzung auf eigene Verantwortung.",
    en: "Soft-limits, panic stop and master-scale protect against overstimulation. Use at your own risk.",
  },
  {
    key: "api_keys_note",
    de: "API-Keys werden verschlüsselt im App-Profil gespeichert (Electron safeStorage / Windows DPAPI), nicht im Klartext.",
    en: "API keys are stored encrypted in the app profile (Electron safeStorage / Windows DPAPI), not in plain text.",
  },
  { key: "system_started", de: "[SYSTEM] Stim App gestartet.", en: "[SYSTEM] Stim App started." },

  // -- hotkey help overlay text -----------------------------------------
  { key: "hk_tabs", de: "1–7 Tabs", en: "1–7 Tabs" },
  {
    key: "hk_intensity",
    de: "↑↓ Intensität A · ←→ Intensität B",
    en: "↑↓ Intensity A · ←→ Intensity B",
  },
  {
    key: "hk_panic",
    de: "Strg+Leertaste / ESC lang / STOPP = Panic",
    en: "Ctrl+Space / long ESC / STOP = Panic",
  },
  {
    key: "hk_space_rhythm",
    de: "Leertaste Rhythm-Tap · Edge halten",
    en: "Space Rhythm-Tap · hold Edge",
  },
  { key: "hk_potato", de: "A/B oder ←/→ Hot Potato", en: "A/B or ←/→ Hot Potato" },
  { key: "hk_surrender", de: "Q Survival aufgeben", en: "Q Survival give up" },
  { key: "hk_help", de: "? Diese Hilfe", en: "? This help" },

  // -- view titles + subtitles (control-deck.js) ------------------------
  {
    key: "view_stim_subtitle",
    de: "Audio · Playlist · Amplituden → A/B",
    en: "Audio · Playlist · Amplitudes → A/B",
  },
  {
    key: "view_stim_title_alt",
    de: "Interaktives Feedback-Training",
    en: "Interactive feedback training",
  },
  {
    key: "view_editor_subtitle",
    de: "Eigene Wellenformen zeichnen & testen",
    en: "Draw & test your own waveforms",
  },
  {
    key: "view_remote_subtitle",
    de: "WebSocket-Steuerung & API",
    en: "WebSocket control & API",
  },
  {
    key: "view_ai_title",
    de: "AI Steuerungs-Assistent",
    en: "AI Control Assistant",
  },
  { key: "view_ai_subtitle", de: "Tool-Calls & Streaming", en: "Tool calls & streaming" },
  {
    key: "view_ai_subtitle_alt",
    de: "Lass dich von einer KI verwöhnen",
    en: "Let an AI pamper you",
  },
  {
    key: "view_settings_subtitle",
    de: "Sicherheit, Updates & Diagnose",
    en: "Safety, updates & diagnostics",
  },

  // -- common static log/toast messages ---------------------------------
  { key: "log_pattern_stopped", de: "Muster gestoppt.", en: "Pattern stopped." },
  {
    key: "log_not_connected_dev",
    de: "Fehler: Nicht mit Gerät verbunden.",
    en: "Error: Not connected to device.",
  },
  { key: "log_dir_start", de: "Director läuft bereits", en: "Director is already running" },
  { key: "log_dir_not_conn", de: "Nicht mit Gerät verbunden", en: "Not connected to device" },
  { key: "log_dir_paused", de: "Director pausiert.", en: "Director paused." },
  { key: "log_dir_resumed", de: "Director fortgesetzt.", en: "Director resumed." },
  { key: "log_dir_continues", de: "Director läuft weiter.", en: "Director continues." },
  {
    key: "log_dir_dev_disc",
    de: "Director: Gerät getrennt — Pause.",
    en: "Director: device disconnected – pause.",
  },
  {
    key: "log_dir_cooldown",
    de: "Panic-Cooldown aktiv — Beat übersprungen.",
    en: "Panic cooldown active – beat skipped.",
  },
  {
    key: "log_skipped_not_conn",
    de: "übersprungen (nicht verbunden)",
    en: "skipped (not connected)",
  },
  { key: "log_dir_log_system_paused", de: "Director pausiert.", en: "Director paused." },
  {
    key: "log_session_started_sys",
    de: "[SYSTEM] Stim App gestartet.",
    en: "[SYSTEM] Stim App started.",
  },
  { key: "empty_ph", de: "Leer", en: "Empty" },
  { key: "not_available", de: "Nicht verfügbar", en: "Not available" },
  { key: "not_retrievable", de: "Nicht abrufbar", en: "Not retrievable" },

  // -- AI chat status / common messages ---------------------------------
  { key: "ai_thinking", de: "KI denkt nach...", en: "AI is thinking..." },
  { key: "ai_executing", de: "KI führt Aktionen aus...", en: "AI is executing actions..." },
  {
    key: "ai_panic_msg",
    de: "🛑 PANIC BUTTON GEDRÜCKT! Alle Ausgaben gestoppt.",
    en: "🛑 PANIC BUTTON PRESSED! All output stopped.",
  },
  { key: "ai_req_aborted", de: "LLM-Anfrage abgebrochen.", en: "LLM request aborted." },

  // -- fun / achievements (static text) ---------------------------------
  { key: "ach_first_connect_t", de: "Verbunden", en: "Connected" },
  {
    key: "ach_first_connect_d",
    de: "Erstmals mit dem Gerät verbunden",
    en: "First connection to the device",
  },
  { key: "ach_first_hs_t", de: "Rekordjäger", en: "Record Hunter" },
  { key: "ach_first_hs_d", de: "Ersten Highscore geknackt", en: "Cracked first highscore" },
  { key: "ach_edge_t", de: "Kantenläufer", en: "Edge Runner" },
  { key: "ach_edge_d", de: "Hold the Edge: 50+ Punkte", en: "Hold the Edge: 50+ points" },
  { key: "ach_potato_t", de: "Heiße Kartoffel", en: "Hot Potato" },
  { key: "ach_potato_d", de: "Hot Potato: 15+ Weitergaben", en: "Hot Potato: 15+ passes" },
  { key: "ach_survive_t", de: "Durchhalter", en: "Survivor" },
  { key: "ach_survive_d", de: "Survival: 30+ Sekunden", en: "Survival: 30+ seconds" },
  { key: "ach_roulette_t", de: "Glücksrad", en: "Lucky Wheel" },
  { key: "ach_roulette_d", de: "Pattern-Roulette gestartet", en: "Pattern Roulette started" },
  { key: "ach_chance_t", de: "Würfelfreund", en: "Dice Friend" },
  { key: "ach_chance_d", de: "Zufallsimpuls ausgelöst", en: "Random pulse triggered" },
  { key: "ach_daily_t", de: "Tagesheld", en: "Daily Hero" },
  { key: "ach_daily_d", de: "Tages-Challenge geschafft", en: "Daily challenge completed" },
  { key: "ach_quick_t", de: "Überraschungsgast", en: "Surprise Guest" },
  { key: "ach_quick_d", de: "Quick Play gestartet", en: "Quick Play started" },
  { key: "ach_ten_t", de: "Spielwütig", en: "Game Addict" },
  { key: "ach_ten_d", de: "10 Spiele gestartet", en: "10 games started" },
  { key: "fun_pattern_roulette", de: "🎲 Pattern-Roulette", en: "🎲 Pattern Roulette" },
  { key: "fun_daily_challenge", de: "📅 Tages-Challenge!", en: "📅 Daily Challenge!" },
  { key: "fun_quick_play", de: "⚡ Quick Play", en: "⚡ Quick Play" },
  {
    key: "fun_roulette_needs",
    de: "Roulette braucht eine Verbindung.",
    en: "Roulette needs a connection.",
  },
  {
    key: "fun_chance_needs",
    de: "Zufallsimpuls braucht eine Verbindung.",
    en: "Random pulse needs a connection.",
  },
  {
    key: "fun_daily_not_found",
    de: "Tages-Challenge: Spiel nicht gefunden.",
    en: "Daily challenge: game not found.",
  },

  // -- stats dashboard ---------------------------------------------------
  { key: "stats_total_play", de: "Gesamt-Spielzeit", en: "Total play time" },
  { key: "stats_days_active", de: "Tage aktiv", en: "Days active" },
  { key: "stats_connections", de: "Verbindungen", en: "Connections" },
  { key: "stats_recordings", de: "Aufnahmen", en: "Recordings" },
  { key: "stats_remote_cmds", de: "Remote-Befehle", en: "Remote commands" },
  { key: "stats_top_patterns", de: "Top Patterns", en: "Top Patterns" },
  { key: "stats_no_patterns", de: "Noch keine Patterns verwendet.", en: "No patterns used yet." },
  { key: "stats_top_games", de: "Top Spiele", en: "Top Games" },
  { key: "stats_no_games", de: "Noch keine Spiele gespielt.", en: "No games played yet." },
  { key: "stats_reset_msg", de: "Statistik zurückgesetzt.", en: "Statistics reset." },
  {
    key: "stats_reset_confirm",
    de: "Alle Statistiken wirklich zurücksetzen?",
    en: "Really reset all statistics?",
  },

  // -- updater UI --------------------------------------------------------
  { key: "upd_checking", de: "Suche nach Updates…", en: "Checking for updates..." },
  { key: "upd_uptodate_prefix", de: "Aktuell (v", en: "Up to date (v" },
  {
    key: "upd_only_desktop",
    de: "Nur in der Desktop-App verfügbar",
    en: "Only available in the desktop app",
  },
  {
    key: "upd_dev_mode",
    de: "Dev-Modus: Auto-Update deaktiviert",
    en: "Dev mode: auto-update disabled",
  },
  {
    key: "upd_dev_only_installed",
    de: "Auto-Update nur in der installierten App",
    en: "Auto-update only in the installed app",
  },
  {
    key: "upd_dev_skipped",
    de: "Update-Check im Dev-Modus übersprungen.",
    en: "Update check skipped in dev mode.",
  },
  { key: "upd_dev_no_auto", de: "Dev-Modus (kein Auto-Update)", en: "Dev mode (no auto-update)" },
  {
    key: "upd_ready_check",
    de: "Bereit – prüft automatisch nach Start",
    en: "Ready – checks automatically after start",
  },
  {
    key: "upd_install_confirm",
    de: "Update jetzt installieren? Die App wird beendet und neu gestartet.",
    en: "Install update now? The app will quit and restart.",
  },
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
    // Periodically re-apply translations to catch dynamically-added content
    // (log messages, AI chat, Director narratives). Only walks the DOM when
    // the user has actively switched away from the default German UI, so the
    // common case incurs no overhead.
    if (!I18N._refreshInterval) {
      I18N._refreshInterval = setInterval(() => {
        if (I18N.currentLang !== "de") {
          try {
            I18N.apply();
          } catch {
            /* DOM might be mid-teardown */
          }
        }
      }, 2000);
    }
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
