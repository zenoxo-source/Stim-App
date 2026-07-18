# Changelog

## 2.5.2

### Bugfix: Linux/macOS Release Build (2. Versuch)
- **Linux**: Systempaket-Namen auf Ubuntu 24.04 aktualisiert (`libgtk-3-0t64`, `libfuse2t64`, etc.)
- **macOS**: `CSC_IDENTITY_AUTO_DISCOVERY=false` gesetzt, Icon auf `build/icon.png` konfiguriert, `--x64 --arm64` aus Build-Args entfernt
- **build-app.js**: macOS baut nur `--mac` (Architekturen kommen aus electron-builder config)

## 2.5.1

### Bugfix: Linux/macOS Build
- **build-app.js** erkennt jetzt die Plattform (`os.platform()`) und baut `--linux`/`--mac`/`--win` statt immer `--win --x64`
- **Linux-Systemabhängigkeiten** im Release-Workflow installiert (`libgtk-3-0`, `libfuse2`, etc.)
- **`.github/workflows/release.yml`** im Repository hinterlegt (vorher nur auf GitHub Web UI)

## 2.5.0

### Pattern Editor ausgebaut
- **Variable Schrittanzahl** (8/16/32) per Dropdown umschaltbar
- **Phase Shift** — Pattern nach links/rechts schieben
- **Fade In/Out** — Ein-/Ausblenden-Envelope über alle Schritte
- **Scale** — Alle Werte mit Faktor multiplizieren
- **Import** — JSON-Patterns aus Datei importieren (komplementär zu Export)
- **Duplizieren** — Gespeicherte Patterns kopieren
- **Visuelle Balken** — farbige Höhenbalken hinter Slidern (blau A / lila B)
- Oszilloskop für Kanal A und B mit Echtzeit-Wellenform

### Remote-Server ausgebaut
- **5 neue API-Kommandos**: `set_frequency`, `set_master`, `set_preset`, `set_custom_pattern`, `get_logs`
- **Client-Codebeispiele** — Python, JavaScript (Node), curl/bash mit aktuellem Token
- **Befehlsstatistik** — Zähler für OK/ERR/WARN + Client-Anzahl
- **Log-Filter** — Nach OK/ERR/WARN/Allen filtern
- **Sprachumschalter** für Codebeispiele

### Navigation
- **Keyboard-Shortcuts 1–7** für alle Tabs (Editor=4, Remote=5, AI=6, Settings=7)
- Hotkey-Overlay aktualisiert

## 2.4.0

### Spiele-Hardware-Konfiguration
- **Zentrales GAME_CONFIG-Objekt** — alle hardcodeden Spielwerte sind jetzt einstellbar
- **Spiel-Einstellungen Panel** — aufklappbar im Spiele-Tab mit Slidern für alle Parameter
- **Hardware-Parameter**: Basisstärke, Schock-Multiplikator, Belohnungs-Multiplikator, Schock/Belohnungs/Kitzel-Frequenz, Max. Schock-Amplitude, Soft-Limits-Respektierung
- **Pro-Spiel-Parameter**: Reflex (Zielzeit, Schock-Verlauf), Rhythm (Tempo, Trefferfenster, Miss-Schock), Edge (Zone, Amplituden-Skalierung, Steigrate), Potato (Timer, Explosion), Survival (Start/Max-Level, Ramp-Speed)
- **gameShock/gameTickle** nutzen GAME_CONFIG für Frequenz und Amplituden-Skalierung
- **Persistenz** — Konfiguration wird in localStorage gespeichert

## 2.3.0

### Phase 1: Tests & Sicherheit
- **17 neue Tests** für remote.js + recorder.js (Sandbox mit `vm`)
- **AGENTS.md** — vollständige Doku für AI-Assistenten und Entwickler
- **WebSocket-Auth (Token)** — Remote-Server generiert Token, Clients müssen authentifizieren

### Phase 2: Features
- **Statistik-Dashboard** — Spielzeit, Verbindungen, Sessions, Top-Pattern, Top-Spiele, Max-Strength, Aufnahmen, Remote-Befehle
- **Pattern-Editor** — Visueller 16-Schritt-Editor für eigene Wellenform-Pattern (Speichern/Laden/Abspielen)
- **i18n (DE/EN)** — Sprachumschalter, data-i18n-Attribute, übersetzte UI-Strings
- **Accessibility** — aria-label, aria-live, role-Attribute für Status/Sidebar/Panic

### Geplant für v3.0.0
- control-deck.js in Module aufteilen (wave-loop.js, patterns.js, sliders.js)
- ES Modules Migration (Vite + import/export statt window-Globals)

## 2.2.0

### Fixes
- **B1-Strength-Feedback** — Gerät meldet externe Strength-Änderungen (z.B. physisches Rad), UI-Sliders aktualisieren sich automatisch
- **Dead Code entfernt** — `pendingStrengthData` war nach v2.0.0 unbenutzt
- **Protokoll-Kommentar korrigiert** — Mode-Bits sind 3-2 (A) und 1-0 (B), nicht 4-5/0-1

### Quality of Life
- **Exponentielles Backoff** — Reconnect-Delay 2s → 4s → 8s → 16s → 30s (max)
- **Dynamisches Wave-Loop-Intervall** — 100ms aktiv, 500ms idle (spart CPU)

### Features
- **WebSocket Remote-Server** — `ws://127.0.0.1:8080` für externe Steuerung (Befehle: set_intensity, set_pattern, stop_all, get_state, get_patterns)
- **Session Recorder** — Aufnahme + Replay der Stimulation als JSON, speicher/ladbar

## 2.1.0

### Tests & Plattform
- **18 neue Bluetooth-Tests** (Sandbox mit `vm`) — sendB0Now, sendStrengthCommand, sendSoftStop, sendV3Init, isDirty, Heartbeat
- **macOS + Linux Build-Targets** — DMG/ZIP (mac), AppImage/deb (Linux)
- **Release-Workflow auf 3 Plattformen** — Windows, macOS, Linux (mit `needs:` Abhängigkeit)
- **Version-Bumping Scripts** — `npm run version:patch/minor/major`

## 2.0.0

### Protokoll & BLE-Korrektheit
- **Strength+Waveform in einem B0-Paket** — kein 100ms-Delay mehr bei Slider-Änderungen
- **V3_MODE_ABSOLUTE_BOTH** Korrektur auf `0x0F` (Kanal A+B beide absolut)
- **B1-ACK-Handler** vereinfacht, ACK-Timeout auf 300ms
- **isDirty-Flag** — BLE-Write nur wenn sich Werte tatsächlich geändert haben
- **Heartbeat/Connection-Monitoring** — B1-Staleness-Detection mit Warnung
- **BLE Debug-Modus** — Hex-Dump von B0/B1-Paketen im Log (aktivierbar in Einstellungen)

### Code-Qualität
- **JSDoc-Type-Annotations** für alle Protokoll-Hilfsfunktionen
- **Module-Registry-Validation** — prüft beim Start ob alle benötigten Globals vorhanden sind
- **Erweiterte Tests** — `buildB0Packet`, `bytesToHex`, Mode-Bits, Wave-Slots
- **Fehlerbehandlung** — leere catch-Blöcke durch `console.warn` ersetzt

## 1.9.1

### Bugfixes (V3 BLE-Protokoll)
- **V3_MODE_ABSOLUTE_BOTH** von `0x33` auf `0x0F` korrigiert — Kanal A wurde zuvor nie absolut gesteuert
- **B1-ACK-Handler** vereinfacht: entfernt fehlerhaftes `>> 4` beim Seq-Vergleich

## 1.9.0

### UX & Hardware-Klarheit
- Wave-Freq: ehrliche Labels (**kein „Hz“**), Schnellwahl + Fein-Slider 10–240
- Wave-Amp % mit Anzeige
- Einstellungen neu: Sicherheit, **Freq/Wave-Balance (0xBF)**, Gerät, App, AI
- Geräte-Infos korrekt benannt; AI-Provider setzt passende Endpoints
- STIM: Audio-Bins → offizielle 10–1000→10–240-Frequenz-Kodierung
- Onboarding erklärt Strength vs. Wave-Freq

## 1.8.0

### Hardware-Korrektheit
- **Pulsweite / Wave-Amp %** skaliert die Wellenform-Amplitude (0–100 %) im `0xB0`-Paket
- Soft-Stop: Amp 0 → **freq 0 + intensity 101** (inaktiv, V3-konform)
- `sendSoftStop()` für Pausen/Stops (optional Strength behalten)
- Patterns, Sessions, STIM, Roulette, AI-Muster: **Basisstärke** wenn Strength 0
- Default Pulsweite 100 % (Migration: altes 15/15 → 100)

## 1.7.0

### Fun
- **Tages-Challenge** (täglich wechselndes Ziel + Fortschritt)
- **Quick Play** – zufälliges Minispiel
- Spiel-Stats (gestartet / Score-Events) + neue Erfolge

### Fixes (wichtig)
- Spiele setzen bei Strength 0 eine **sanfte Basisstärke** (V3: sonst kein spürbarer Output)
- Wechsel zwischen Spielen stoppt laufende Loops sauber (`stopAllMiniGames`)
- Roulette / Zufallsimpuls nutzen Basisstärke
- Pattern-Hinweis wenn A/B auf 0 stehen
- Panic nutzt zentrale Game-Stop-Hilfe

## 1.6.0

### Fun
- **Survival** – steigende Intensität, Score = Durchhaltezeit, Q zum Aufgeben
- **Pattern-Roulette** & **Zufallsimpuls** (Würfel) im Control Deck
- **Erfolge** mit Toasts (Verbindung, Highscores, Meilensteine)
- UI-SFX für Treffer / Fail / Unlock
- Hold the Edge: Leertaste halten

### Fixes / Cleanup
- Wave-Loop überschreibt Edge/Potato/Survival nicht mehr
- Hotkeys: Pfeile während Spielen deaktiviert (kein Intensitäts-Konflikt)
- DOM-Cache für Edge/Potato/Survival vollständig
- Panic/Close stoppen Survival; Status-Chip zeigt Spielmodus
- Settings/AI-Sessions: Keys `stim_*` mit Migration von `coyote_*`
- Branding: Terminal & Versions-Fallback → Stim App 1.6.0

## 1.5.0

### Fun & Games
- **Hold the Edge** – Intensität halten, grüne Zone, Highscore
- **Hot Potato** – Kanal A/B rechtzeitig bestätigen, steigendes Tempo
- Highscores für alle Minispiele (lokal)
- Intensitäts-Presets: Sanft / Mittel / Intensiv
- Safety-Timer mit Soft-Stop
- Tastatur-Hilfe (`?`)

### Cleanup
- Panic stoppt auch Edge/Potato/Timer
- Output-Status kennt neue Spiele

## 1.4.0

### Product polish
- Multi-size Windows icon (ICO)
- First-run onboarding (Safety, Bluetooth, Panic)
- Settings export/import (JSON, ohne API-Keys)
- Code-Signing-Dokumentation (`docs/CODE_SIGNING.md`)
- Cleanup-Workflow für kaputte Doppel-Releases (v1.3.0)

## 1.3.1

### Fixes
- Release-Publish ohne Race (ein Release statt doppelter v1.3.0)
- `latest.yml` wieder öffentlich ladbar für electron-updater
- Klarere Update-Fehlertexte (kein irreführender „Token“-Hinweis)

## 1.3.0

### Branding & UX
- Stim App Branding, Icon, Tray, Fenstertitel
- Ausgabe-Indikator, Safety-Chip, sichtbarer STOPP-Button
- Soft-Limit-Warnungen an den Intensitätslabels

### Bluetooth
- Freundliche Fehlermeldungen, Reconnect-Status, Geräteliste in der Sidebar

### STIM Player
- Playlist (Mehrfachimport, prev/next, Auto-Advance)
- Hörlautstärke optional an Master gekoppelt

### AI
- Robustere Tool-Argument-Parsing, Tool-Chips in der Chat-UI

### Updates
- Öffentliche Releases ohne Token-Feld in den Einstellungen
- About-Karte mit Versionsanzeige

## 1.2.1

### Updates (privates Repo)
- Auto-Update mit **GitHub PAT** (safeStorage), `private: true` im Updater-Feed
- UI-Feld „GitHub Update-Token“ unter Einstellungen → App-Updates
- Repo kann privat bleiben; ohne Token klarer Hinweis statt rohem 404

## 1.2.0

### Packaging & Updates
- Windows-Build mit **electron-builder** (NSIS-Installer + Portable)
- **electron-updater** gegen GitHub Releases (`zenoxo-source/Stim-App`)
- UI: Update-Banner, manuelle Prüfung, „Jetzt installieren“
- CI/Release auf **Node.js 24**, Workflows unter `.github/workflows/`

### Security & Safety
- API-Keys via Electron `safeStorage` (Windows DPAPI)
- CSP ohne Inline-Scripts; XSS-sichere Session-Metadaten
- Panic stoppt Ausgabe ohne BLE-Trennung
- Vollständiges Emergency-Stop-Paket (V3)

### Bluetooth & Control
- Geräte-Picker bei mehreren Coyotes, Scan-Timeout 15 s
- Master-Scale auf Strength **und** Wave-Amplituden
- Battery-Polling-Cleanup, Diagnose-Log-Export

### Tooling
- Unit-Tests (`npm test`), ESLint/Prettier, Frontend-Bundle
- `.nvmrc` / `.node-version` → Node 24
