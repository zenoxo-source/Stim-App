# Changelog

## 3.4.0 — PR4: Fun & AI

### Neue Features
- **🎲 Dice-Modus** — periodische zufällige Strength-Spikes mit konfigurierbarem Interval (≥500ms), Min/Max-Bereich, Kanal-Auswahl (A/B/both), Spike-Dauer + Relax-Wert. Pause durch Panic-Cooldown.
- **🎵 Music-Sync** — BPM-Erkennung via Mikrofon (`getUserMedia` + `AnalyserNode`). Energiebasierte Beat-Detection mit laufendem RMS-Durchschnitt × Sensitivity-Faktor. BPM-Schätzung aus bis zu 8 letzten Intervallen mit Outlier-Filter. Bei jedem Beat → konfigurierbarer Pulse. Mic-Permission wird auf Win/macOS nativ, auf Linux via PulseAudio/PipeWire angefordert.
- **⚡ Trigger-System** — Event-getriebene Regeln. 5 Condition-Typen (strength-above/below, time-elapsed, pattern-active, audio-playing) × 5 Action-Typen (set-strength, soft-stop, log, start-pattern, toast). 500ms Watchdog, einmaliges Feuern pro Arm-Cycle (vermeidet Loops). UI im Settings-Tab mit Scharfstellen-Button.
- **🧠 AI-Memory** — persistente Präferenzen über Sessions. 5 Kategorien (like/dislike/preference/fact/note), Pinning, Dedup, Max 200 Einträge. Auto-Injection in System-Prompt via `getMemorySnapshot()`. Zwei neue AI-Tools: `remember(category, content, pinned?)` + `forget(id)`. UI-Viewer im Settings-Tab.

### Dateien
- Neu: `frontend/js/modules/dice.js`
- Neu: `frontend/js/modules/music-sync.js`
- Neu: `frontend/js/modules/triggers.js`
- Neu: `frontend/js/modules/ai-memory.js`
- Neu: `frontend/js/modules/ui-bindings-pr4.js`
- Neu: `backend/tests/dice.test.js` (12 Tests)
- Neu: `backend/tests/music-sync.test.js` (18 Tests)
- Neu: `backend/tests/triggers.test.js` (19 Tests)
- Neu: `backend/tests/ai-memory.test.js` (20 Tests)
- Geändert: `llm-service.js` (+2 AI-Tools: remember/forget, +Memory-Injection ins System-Prompt), `index.html` (+Dice/Music-Sync-Buttons im Control Deck, +Trigger-Card, +AI-Memory-Card), `main.js` (+5 Imports)

### Tests
- **276/276 grün** (+69 neu)
- Lint clean
- Bundle: 211.4 KB (-40.5% vs Dev)
- Electron-Smoke: 3/3 sauber

### Cross-Platform
- Music-Sync nutzt Web Audio + getUserMedia (Cross-Platform in Electron)
- Mic-Permission: native Prompts auf Win/macOS, PulseAudio/PipeWire auf Linux
- Andere Module: reines JS, keine Plattform-Abhängigkeiten

## 3.3.0 — PR3: Content & Sharing

### Neue Features
- **📤 Pattern-Import mit Live-Vorschau** — Modal zeigt Name, Step-Anzahl, Avg/Max-Werte, Kanal-Spitzenschritte. Validiert jeden Entry (Steps 1–256, Channel-Längen müssen passen, Werte werden auf 0–100 geclampt). Kollisionen beim Merge erhalten Suffix `_imported_N`. Datei-Format identisch mit Export.
- **🔍 Volltext-Suche (Ctrl+K)** — Overlay durchsucht Sessions, Custom-Patterns, Stats-Patterns/Spiele, Tabs. Score-basiertes Ranking (exact > prefix > substring). Tastatur-Navigation ↑↓ + Enter, ESC schließt.
- **⏰ Session-Scheduler** — Startet Sessions automatisch zu festen Zeiten. Format: HH:MM + Wochentage (Komma-Liste 0=So … 6=Sa, leer = einmalig). Tick alle 30s, persistiert in `localStorage`. `computeNextFire()` springt zum nächsten passenden Wochentag. `fireEntry()` disabled einmög-Shots nach Start.
- **🎬 Recording-Editor** — Trim (Zeit-/Index-basiert), Loop (1–50 Iterationen, Section wird mit kontinuierlichen Timestamps wiederholt), Fade-In/Out (lineare Amplituden-Skalierung), Normalize (Peak→Target). Pure Functions, nicht-destruktiv.

### Dateien
- Neu: `frontend/js/modules/pattern-import.js` (4 Pure Helpers)
- Neu: `frontend/js/modules/search.js` (Index + Score-Filter)
- Neu: `frontend/js/modules/scheduler.js` (CRUD + Tick + Feuerroutine)
- Neu: `frontend/js/modules/recording-editor.js` (8 Pure Functions)
- Neu: `frontend/js/modules/ui-bindings-pr3.js` (DOM-Verdrahtung für alle 4 Features)
- Neu: `backend/tests/pattern-import.test.js` (15 Tests)
- Neu: `backend/tests/search.test.js` (12 Tests)
- Neu: `backend/tests/scheduler.test.js` (18 Tests)
- Neu: `backend/tests/recording-editor.test.js` (19 Tests)
- Geändert: `index.html` (+Scheduler-Card, +Recording-Editor-Details, +Pattern-Import-Button), `main.js` (+5 Imports)

### Tests
- **207/207 grün** (+64 neu)
- Lint clean
- Bundle: 196.7 KB (-40.2% vs Dev)
- Electron-Smoke: 3/3 sauber

### Cross-Platform
- Alle Pure Functions sind JS-only, keine Plattform-Abhängigkeiten
- Scheduler nutzt `Date` + `setInterval` (gleich auf Win/macOS/Linux)
- Search-Overlay: reine DOM/CSS, kein matchMedia oder Plattform-Erkennung nötig
- Pattern-Import: File-API + FileReader funktioniert in Electron-Renderer überall

### Bewusst NICHT in PR3 enthalten
- Online Pattern-Library (braucht Backend)
- Multi-Device-Support, Coyote 2.0, Voice-Control, Multi-Modal AI
- Twitch/Discord (explizit ausgeschlossen)

→ Siehe PR4 (Dice / Music-Sync / Trigger / AI-Memory), PR5 (MIDI / Session-PIN)

## 3.2.0 — PR2: UX Polish

### Neue Features
- **🌙 Theme-Switcher** (Dark/Light/Auto) — Button in der Sidebar. Auto folgt `prefers-color-scheme`. Light-Theme überschreibt alle CSS-Variablen. Cross-Platform: pure CSS + `matchMedia`, kein Plattform-Code.
- **🗂️ Tab-Persistenz** — letzte aktive Tab wird in `localStorage` gespeichert und beim App-Start wiederhergestellt.
- **⌨️ Anpassbare Tastatur-Shortcuts** — Hotkey-System mit UI-Editor in den Einstellungen. Alle Tabs (1-7), Audio P, Intensität-Pfeile, Pattern-Stop sind jetzt rebindbar. „Mod""-Abstraktion = Strg auf Win/Linux, Cmd auf macOS. Panic-Shortcuts (Ctrl+Space, ESC lang) bleiben in `safety.js` (life-critical, nicht rebindbar). Live-Capture: Taste drücken → Combo gesetzt. Kollisionsschutz + Reset-All.
- **👤 Profil-System** — mehrere Konfigurationen (z. B. pro Partner). Speichert Soft-Limits, Master-Scale, Frequenzen, Pulse Widths, Balances, Audio, Sensitivität, AI-Settings. Create / Load / Update / Rename / Delete über Settings-UI. Wechsel wendet `applySettings()` an.

### Dateien
- Neu: `frontend/js/modules/theme.js` (Theme-Manager)
- Neu: `frontend/js/modules/tab-persistence.js` (Tab-Storage)
- Neu: `frontend/js/modules/hotkeys.js` (Registry + Combo-Parser + Matching)
- Neu: `frontend/js/modules/keyboard-bindings.js` (Default-Bindings)
- Neu: `frontend/js/modules/profiles.js` (CRUD + Apply)
- Neu: `frontend/js/modules/ui-bindings-pr2.js` (DOM-Verdrahtung)
- Neu: `backend/tests/theme.test.js` (8 Tests)
- Neu: `backend/tests/tab-persistence.test.js` (4 Tests)
- Neu: `backend/tests/hotkeys.test.js` (22 Tests)
- Neu: `backend/tests/profiles.test.js` (12 Tests)
- Geändert: `safety.js` (Tab/Arrow/P-Logik ausgelagert, nur noch Panic), `control-deck.js` (Tab-Click persistiert), `main.js` (+6 Imports), `index.html` (+Theme-Button, +Profile-Manager, +Hotkey-Editor in Settings), `style.css` (+Light-Theme-Overrides, +Hotkey/Profile-CSS)

### Tests
- **143/143 grün** (+46 neu)
- Lint clean
- Bundle: 180.1 KB (-40.2% vs Dev)
- Electron-Smoke: 3/3 saubere Starts

### Cross-Platform
- Hotkeys: „Mod"" mapt auf Ctrl (Win/Linux) bzw. Meta (macOS) via `navigator.platform`
- Theme: matchMedia funktioniert auf allen 3 Plattten identisch
- Profile/Tab-Persistenz: reines `localStorage`, plattformunabhängig
- Keine nativen Aufrufe, keine neuen Dependencies

### Bewusst NICHT in PR2 enthalten
- Multi-Device-Support (PR6 — eigene Architektur)
- Online Pattern-Library (Backend nötig)
- Voice-Control / Multi-Modal AI (eigene Stränge)
- Twitch/Discord (explizit ausgeschlossen)

→ Siehe PR3 (Content & Sharing), PR4 (Fun & AI), PR5 (Hardware)

## 3.1.0 — PR1: Safety Bundle + Strength Ramp

### Neue Sicherheits-Features
- **Panic-Cooldown** — nach `killAllOutput()` werden Strength-Änderungen für 30 s blockiert. Sliders, Remote-Befehle, AI-Tool-Calls, Ramps — alle konsumentiert `blockDuringPanicCooldown()`. Countdown zählt in `safety-chip` herunter.
- **Per-Pattern Strength-Ceiling** — `setPatternCeiling()` installiert eine absolute Obergrenze, die `clampStrengthWithCeiling()` in `sendStrengthCommand` + `updateSlidersA/B` respektiert. Wird von Ramp automatisch als Hard-Cap gesetzt.
- **BLE-Signalverlust-Auto-Stop** — Watchdog (`armSignalLossWatcher`) prüft alle 500 ms `lastGattActivity`. Bei > 2 s ohne GATT/B1-Aktivität während `isConnected` → `sendSoftStop` + `updateOutputStatus({panic:true})`. GATT-Disconnect disarmt den Watchdog sauber.
- **Strength-Ramp / Trainingsmodus** — neues Modul `modules/ramp.js` mit `startRamp({targetA, targetB, durationMin})`. Lineare Interpolation in 1-s-Ticks. UI-Kontrolle im Control-Deck (Ziel A/B, Dauer, Start/Stop, Fortschrittsbalken). Respektiert Soft-Limits, Panic-Cooldown, Ceiling. Stopt automatisch bei Disconnect oder Panic.

### Dateien
- Neu: `frontend/js/modules/safety-extras.js` (Cooldown, Ceiling, Watchdog)
- Neu: `frontend/js/modules/ramp.js` (Ramp-Engine + UI-Binding)
- Neu: `backend/tests/safety-extras.test.js` (22 Tests)
- Neu: `backend/tests/ramp.test.js` (12 Tests)
- Geändert: `state.js` (+5 neue AppState-Felder), `safety.js` (Cooldown-Arm in `killAllOutput`, Ramp-Stop bei Panic), `bluetooth.js` (Cooldown-Block + Ceiling-Clamp in `sendStrengthCommand`, GATT-Activity-Notes + Watchdog-Hooks), `control-deck.js` (updateSliders mit Cooldown+Ceiling), `status-ui.js` (Cooldown-Countdown in 400ms-Refresh), `index.html` (+Ramp-UI), `main.js` (+2 Imports)

### Tests
- **97/97 grün** (vorher 65/65 — +32 neue Tests für Safety+Ramp)
- Lint clean
- Bundle: 169.2 KB (-39,8% vs Dev)

### Cross-Platform
- Reines JS, keine Plattform-spezifischen Aufrufe
- `setInterval`, `Date.now`, `localStorage` funktionieren auf Win/macOS/Linux identisch
- Bestehende `tray.displayBalloon`-Plattform-Weiche bleibt unberührt

### Bewusst NICHT in PR1 enthalten
- Multi-Device-Support (eigenes Meta-Refactor)
- Coyote 2.0 Protokoll (braucht Hardware-Specs)
- Online Pattern-Library (braucht Backend)
- Voice-Control / Multi-Modal AI (eigene Stränge)
- Twitch/Discord (explizit ausgeschlossen)

→ Siehe PR2/PR3/PR4/PR5 (theme/profile, scheduler, music-sync, MIDI etc.)

## 3.0.1

### Security-Hardening
- **`webPreferences`** explizit gesetzt: `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false` (zusätzlich zu bestehendem `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`)
- **`will-navigate`-Handler**: blockt alle externen Navigationen (`file://` only) — verhindert Phishing-Routes
- **`setWindowOpenHandler`**: deny-all für Popups / `target=_blank` / `window.open`
- **`will-attach-webview`**: verhindert `<webview>`-Embedding (Defense in Depth)
- **CSP verschärft**: `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, `frame-ancestors 'none'` ergänzt
- **IPC-Input-Validierung** für `secrets:setApiKey` / `secrets:setGithubToken` (max. 4096 Zeichen, Type-Check), `diagnostics:exportLog` (max. 5 MB), `remote:start` (Port-Bereich 1024–65535)

### Remote-Server gehärtet
- **Auth-Timeout**: unauthentifizierte WebSocket-Clients werden nach 5 s getrennt (vorher: unbegrenzt offen)
- **Max. 5 gleichzeitige Clients** (vorher: unlimitiert)
- **Max. 64 KB pro WebSocket-Frame** via `maxPayload` (Memory-Bomb-Schutz)
- **Rate-Limit**: max. 5 Befehle/Sekunde pro Client (Sliding-Window)

### Cross-Platform
- **`tray.displayBalloon`** nur auf Windows aufgerufen (`process.platform === "win32"`) — auf Linux/macOS wirft die API oder ist ohne Effekt
- **Linux `maintainer`-Feld** in `electron-builder`-Config ergänzt (Pflicht für `.deb`-Bauten)
- **`build-app.js` v3-kompatibel**: neue Logik für `switchToProductionBundle` erkennt die v3-Architektur (index.html referenziert bereits `dist/bundle.min.js`), entpackt das Source-`frontend/js/`-Verzeichnis konsequent aus dem Produktionspaket

### Verifiziert
- ✅ Windows NSIS + Portable (`StimApp-3.0.0-win-x64.exe`, 99 MB) baut und startet
- ✅ Linux `tar.gz` cross-build auf Windows möglich (AppImage/deb benötigen Linux-Runner — CI übernimmt das)
- ✅ Linux-unpacked enthält `chrome-sandbox`, `libEGL.so`, `libGLESv2.so`, `libffmpeg.so` etc.
- ⚠️ macOS-Build nur auf macOS selbst möglich (CI-Runner übernimmt das)
- ✅ Produktionasar enthält `frontend/dist/bundle.min.js`, **nicht** mehr `frontend/js/` (slim package)
- ✅ Lint clean, 65/65 Unit-Tests grün

## 3.0.0

### Architektur: ES Modules Migration (Big-Bang)
- **Alle 27 Frontend-Module** von `window.X = Y`-Global-Kopplung auf `import`/`export` umgestellt
- **`frontend/js/main.js`** als neuen Einstiegspunkt; `index.html` lädt nur noch ein einzelnes `<script src="dist/bundle.min.js">` statt 26 Script-Tags in fixer Reihenfolge
- **esbuild** ersetzt die Terser-Konkatenation als Bundler + Minifier (`backend/scripts/build-frontend.js` komplett neu)
  - Dev-Bundle: 278.8 KB (mit Source-Map)
  - Prod-Bundle: 168.2 KB (-39,7 % vs Dev, -10 % vs v2.5.4)
- **`mangle.reserved`-Liste** und das `jsOrder`-Array entfallen — esbuild resolved den Import-Graph selbst

### Tests modernisiert
- **vm-Sandbox entfernt** — `bluetooth.test.js` und `remote-recorder.test.js` nutzen jetzt direkte `import`-Statements (~700 Zeilen Boilerplate gelöscht)
- **`backend/tests/helpers/dom-mock.js`** neu: Browser-API-Shims (`document`, `Audio`, `localStorage`, `navigator`, …) für den Node-Test-Runner
- **AppState als Singleton** in Tests direkt mutiert statt zu mocken
- **`backend/tests/package.json`** neu: `{type: module}` damit Node `.js`-Testdateien als ESM parst
- 66/66 Tests grün, ~420 ms Gesamtlaufzeit

### Tooling & Konventionen
- **`.eslintrc.js`** drastisch vereinfacht: `sourceType: module`, 80+ Globals-Einträge gelöscht (sind jetzt Imports); Browser-APIs bleiben als `globals` deklariert
- **`frontend/js/package.json`** neu: `{type: module}` (damit Node die Frontend-Dateien als ESM für die Tests parst; Browser und esbuild ignorieren dies)
- **`npm run dev`** baut das Frontend jetzt automatisch vor dem Electron-Start (vormals gelang Electron via `file://` direkt zu den Roh-Dateien)
- **`npm run build:frontend:watch`** neu: esbuild-Watch-Modus für iterative Entwicklung

### Code-Qualität
- **`frontend/js/modules/ai-state.js`** neu: Extrahierter Shared-State (`AIChatState`) zwischen `llm-service.js` und `safety.js` — ersetzt frühere modul-lokale `let currentLLMController`/`isProcessing`/`streamingBubbleEl`-Variablen, die bei Panic-Aborts von außen erreicht werden mussten
- **Alle `if (typeof X === "function")`-Guards** entfernt (mit ES Modules sind Imports garantiert vorhanden)
- **`ProtocolUtils`** nicht mehr UMD-wrapped, sondern reines ES-Module
- **`state.js`** re-exportiert `CONSTANTS` für Kompatibilität mit Konsumenten, die noch `import { CONSTANTS } from "./state.js"` schreiben

### Entfernungen
- **Kein `vm`-Modul** mehr in den Tests
- **Kein `terser`** als direkte Dev-Dependency (esbuild übernimmt Minify)
- **Keine `jsOrder`-Konstante** mehr in `build-frontend.js`

### Nicht enthaltene Refactorings (Folge-PRs)
- `control-deck.js` (weiterhin 647 Zeilen) in `tab-nav.js` / `wave-loop.js` / `sliders.js` / `diagnostics.js` aufteilen
- `AppState` (352 Zeilen, 20 Konsumenten) in `bleState` / `audioState` / `gameState` / `safetyState` splitten

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
