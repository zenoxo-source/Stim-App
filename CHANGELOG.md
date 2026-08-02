# Changelog

## 4.4.0 — Voice-Feedback, Media-Keys & Session-Historie

### Neu: Autodrive Voice-Feedback 🎤
- Hände-freie Steuerung per Mikrofon (Web Speech API): „zu schwach / gut / zu stark / fast / jetzt / abgespritzt / noch nicht" → Autodrive-Feedback
- Toggle-Button im Session-Fullscreen, Transkript-Status, Auto-Stopp beim Schließen; ohne SpeechRecognition wird der Button ausgeblendet
- Privacy: Mikrofon nur bei aktivem Toggle, keine Transkript-Persistenz

### Neu: Globale Media-Keys
- `MediaPlayPause` / `MediaNextTrack` / `MediaPreviousTrack` steuern den STIM-Player auch bei verstecktem Fenster (Play/Pause-Toggle, Track-Navigation mit Wrap)

### Neu: Playlist-Erweiterung & Session-Historie
- **Repeat 1**: aktuelle Spur wiederholen (auch in Multi-Track-Playlists, gewinnt vor Shuffle/Next)
- **Autodrive-Session-Historie**: die letzten 10 Sessions auf Home (Dauer, Phase, Edges, Feedback, Template, Peak, ✅-Markierung) mit 1-Klick-„↻"-Restart (gleiches Setup)
- Debrief-Zusammenfassung zeigt jetzt Phase + Peak

### Sicherheit
- **XSS-Fix:** Hotkey-Combo-Strings (z. B. `Ctrl+<…>`) wurden unescaped gerendert — jetzt escaped (Combo, Label, IDs)
- Audit weiterer Sinks (Trigger-/Memory-Listen, Scheduler, Profile, Pattern-Import) — keine weiteren Funde

### Tests
- 648 Tests grün, Lint sauber


## 4.3.0 — Panic-Hotkey, Tray-STOPP & Sicherheits-Fixes

### Sicherheit (Schwachstellen-Behobungen)
- **XSS-Fix (hoch):** Remote-Befehls-Log wurde unescaped gerendert — ein authentifizierter Remote-Client konnte HTML/JS in die App injizieren. Log-Einträge werden jetzt escaped
- Weitere XSS-Sinks abgedichtet: Pattern-/Spielnamen in den Stats, eigene Pattern-Namen im Editor (Text + Attribute), Story-Labels im Partner-Panel
- Audit aller 66 innerHTML-Stellen; Rest ist statisch oder bereits escaped

### Neu: Panic & Benachrichtigungen
- **Globaler Panic-Hotkey `Strg+Alt+S`** — wirkt auch bei verstecktem Fenster (Tray)
- **Tray-Menü:** Live-Status (verbunden/getrennt) + „STOPP (Panik)"-Eintrag mit Balloon-Bestätigung
- **Verbindungsverlust-Notification** bei unerwartetem BLE-Abbruch (manuelles Trennen löst keine aus)
- **Safety-Timer informiert** per System-Notification, wenn der Auto-Stop die Ausgabe beendet

### Autodrive & Stats
- Debrief zeigt jetzt Phase + Peak und hat **„↻ Erneut starten"** (letzte Session mit gleichem Setup, 1-Klick)
- **Battery-Verlauf in den Stats:** Ringbuffer (240 Samples), Karte mit Aktuell/Min/Ø/Max + farbcodierte 12-Balken-Historie; wird beim Statistik-Reset mit geleert
- i18n: Debrief-Modal komplett zweisprachig (11 neue EN-Keys)

### Tests
- 648 Tests grün, Lint sauber


## 4.2.0 — Ownership Strict, PBKDF2-PIN & Härtung

### Verhaltensänderung: Output-Ownership jetzt strikt
- Schreibzugriffe werden **immer hart blockiert**, wenn ein anderer Owner aktiv ist (Session/Pattern/Autodrive/Audio/Ramp/Game) — vorher nur Soft-Guard-Log
- **Ausnahmen (immer erlaubt):** Intensitäts-Slider, Master-Scale, Pulse-Width, Frequenz (`manual`/`master`-Writer) — der Mutex arbitriert zwischen automatisierten Quellen, nicht den eigenen Händen
- Remote/MIDI/Trigger-Schreibbefehle während aktiver Owner-Session werden abgelehnt; `stop_all`/Safety bleiben erreichbar

### Sicherheit
- **Session-PIN auf PBKDF2** (100k Iterationen HMAC-SHA-256 statt SHA-256) — Format `pbkdf2$iters$salt$dk`; Bestands-PINs werden beim ersten erfolgreichen Unlock automatisch migriert
- `npm audit`: 4 bekannte Schwachstellen in Build-Deps behoben (js-yaml, tar) → **0 Vulnerabilities**

### Qualität / Refactor
- **Legacy `pattern-editor.js` entfernt** (war seit v2 inert, DOM-IDs existierten nicht mehr)
- Pattern-Engine (`computeNamedPatternWave`) nach `frontend/js/lib/pattern-engine.js` extrahiert — `control-deck.js` 1071 → 899 Zeilen
- **Auto-Update-Check alle 4 h** (still, UI nur bei verfügbarem Update); Update-Scripts im Changelog/README automatisieren Version-Bumps

### CI / Infrastruktur
- CI baut jetzt zusätzlich das **fertige Paket** (`build:app`, unsigned Smoke-Test) — fängt Verpackungsfehler vor dem Release
- Deploy-SSH-Keys aus dem Repo-Ordner nach `~/.ssh/coyoteapp-deploy/` verschoben
- Docs: `DESIGN-restructure-autodrive.md` archiviert, `ROADMAP-4.0.md` mit Erledigt-Status

### Tests
- +14 neue Tests: LLM-Proxy-Renderer-Fallback (7), Output-Owner-Strict-Semantik (4), PIN-Migration (2), Feature-Flag-Aufräumung (1)
- Gesamt: 648 Tests grün, Lint sauber


## 4.1.13 — LLM-Proxy, Secrets & Refactor

### Sicherheit
- **API-Key bleibt im Main-Prozess**: LLM-/Vision-Anfragen laufen über einen neuen Proxy (`backend/src/llm-proxy.js`, Endpoint-Allowlist, Payload-Caps, Streaming via IPC). Der Key verlässt safeStorage nie mehr in Richtung Renderer; das Settings-UI zeigt nur noch einen maskierten Hinweis (`••••abcd`) mit Lösch-Button
- safeStorage-Klartext-Fallback warnt jetzt laut und schreibt Secrets mit 0600-Rechten (Unix)
- `secrets:getApiKey`-IPC entfernt — der Renderer kann den vollen Key nicht mehr lesen

### Qualität / Refactor
- `autodrive-engine.js` (2254 → 1835 Zeilen): statische Templates/Placement-Profile nach `frontend/js/lib/autodrive-data.js` extrahiert
- HTML-Single-Source: veralteten `autodrive-section.html`-Splice-Workflow entfernt (`index.html` ist einzige Quelle)
- Bluetooth-Geräte-Dialog async (`showMessageBoxSync` → `showMessageBox`) inkl. Picker-Race-Fix
- `npm run version:patch|minor|major` aktualisiert jetzt README-**Version:**-Zeile und legt den CHANGELOG-Eintrag automatisch an

### Tests
- 20 neue Tests für den LLM-Proxy (Allowlist, Validierung, Streaming, Abort)
- Gesamt: 634 Tests grün, Lint sauber


## 4.1.12 — Autodrive 2 Loops · 1 Kanal & Wizard

### Autodrive
- **2 Loops · 1 Kanal** wählbar (Layout-Karte + Presets A/B): nur der aktive Coyote-Kanal läuft, der andere bleibt bei Strength 0
- Templates `loops_single` / `finish_loops_single`; Engine: kein Alt/Lead, kein gekoppelter Bleed
- Wizard-Flow: **1 Setup → 2 Session → 3 Optionen** mit Weiter/Zurück; Layout-Karten zuerst, Details optional
- Verkabelungs-Check, Live-Meter und Soft-Limit-Coach respektieren Single-Channel

## 4.1.11 — Abspritzen-Setups & Finish-Autodrive

### Setup & UI
- Finish-first Setup-Presets (★ Abspritzen A+B / schnell / Glans / Pads, Common-3 …) mit **finishScore** und konkreten Soft-Limit-/Balance-Empfehlungen
- Empfehlungs-Karte: Soft-Limit B aus aktuellem Soft-Limit A, Settings-Zeilen, Tips
- Default-Setup: ★ Abspritzen A+B (`finish_loops`)

### Engine
- `climaxPriority`: längerer Multi-Wave-Push, flachere Täler, ~20 s Final-Hold
- Im Push: kein Micro-Stutter, beide Kanäle, „zu stark“ bricht Finish nicht ab
- Templates `finish_loops` / `finish_glans` / `finish_pads` (1 Edge → Push)
- Soft-Limit-Coach nutzt Balance/Setup-Ratio für B-Vorschlag

## 4.1.10 — Autodrive First-Run, Probes, Trust Line

### Autodrive
- First-run Onboarding, Kanal-Probes A/B, Trust-Line (Phase · Strength · Freq max)
- Last-success speichert volles Setup (Elektroden/Sites/Balance)

## 4.1.9 — Autodrive Freq-Max sichtbar

### UI
- Live: aktuelle Wire-Freq + **max** (Session-Peak inkl. Placement/Push)
- Schlanke Freq-Band-Leiste (10–240) mit Marker — ohne UI-Überladung
- Setup-Guide: Freq max + Sensation-Label (z. B. kräftig)

## 4.1.8 — Autodrive UI-Umbau: Setup nach Elektroden & Körper

### UI
- Neues Autodrive-Layout: Hero + Tabs **Setup · Session · Feintuning** + Live-Cockpit
- **Kontakt-Karte** (Penis-Zonen) mit A/B-Highlight
- Schnell-Setups (Loops A+B, Common-3, Pads, Perineum …)
- Verkabelungs-Modi: 4 Kontakte getrennt · 3 Kontakte Common · 1 Kanal
- Sitze pro Kanal (Basis/Mitte/Corona/Eichel/Perineum …) + **Balance B**
- Live **Verkabelungs-Check** (klärt: ein Pol A + ein Pol B im Loop = Common)

### Engine
- Config-Felder `electrodeKind`, `wiringMode`, `siteA1/A2/B1/B2`, `balanceB`
- `balanceB` skaliert Strength B (Glans schonen)
- Default: Loops A+B Penis · Klassisch · Balance B 85 %

## 4.1.7 — Loops A+B nur Penis (Presets)

### Neu
- **Placement „Loops A+B Penis“** und **„Loops A+B · Glans hot“** — zwei Kreise nur am Schaft/Glans (Kanal A + B)
- **5 One-Tap-Presets** im Autodrive-Tab: Klassisch · Tease · Edge/Deny · Glans-Hot · Rush  
  (setzen Placement, A/B-Rollen, Sensitivität, Dauer, Template)
- Templates `loops_*` mit Badge „Loops A+B“; Alternate-Wellen bei Tease/Edge, Both bei Push

### Empfohlenes Setup
- **A:** Loop Basis ↔ Mitte Schaft · **B:** Corona ↔ unter Eichel (getrennte Kreise)  
- A Rhythmus · B Steady (oder umgekehrt bei Glans-Hot)

## 4.1.6 — Autodrive ESTIM-Placement & Körper-Guide

### Autodrive-Tuning
- Placement-Profile an reale ESTIM-Anwendungen angeglichen (Caps/Freq/Duty):
  - **Pads extern** — weicher, höheres Cap
  - **Loops Schaft** — fokussiert, konservativeres Cap
  - **Dual A/B Stereo** — Alternate, empfohlene A/B-Rollen
  - **Perineum + Basis** (neu) — tiefer, beckenboden-nah
  - **Insertable bipolar** (neu) — strengstes Cap
- Phasen-Tips nennen das aktive Placement; Kalibrierung bleibt Pflicht für gute Baseline

### UI / Wissen
- Live-Guide: Setup ♂/♀, Sensation, Tipps, Engine-Parameter (Cap/Freq/Duty)
- Aufklappbare ESTIM-Sicherheitsregeln (nur unterhalb Taille, Kontakt, Soft-Limits …)
- Placement-Wechsel kann empfohlene A/B-Rolle und Kanal-Fokus setzen

## 4.1.5 — Autodrive: COOLDOWN-Strength & sauberer Stop

### Behoben
- **COOLDOWN/`silenced` brach vor Strength-Sync ab**: UI und `AppState` blieben auf alter Intensität; Gerät bekam keinen Absolute-Write auf 0
- **Stop ließ UI-Strength stehen**: Residual konnte beim nächsten Absolute-B0 (Master/Slider) unerwartet stimmen — jetzt Soft-Stop mit `zeroUiStrength` + UI 0
- Wave-Tick bei Silence: Strength (inkl. 0) + inaktive Wave zusammen senden

### Tests
- Autodrive: Stop nullt Strength; Wave-Tick-Arming; Storage-Key `stim_app_autodrive_v1` in Persistenz-Tests

## 4.1.4 — Master-Slider bleibt bedienbar

### Behoben
- **Master-Slider kollabierte auf ~0 % Breite** sobald Strength > 0: Session-Header (`header-compact`) setzte `max-width: 140px` auf den Container — Label + Prozent + Padding ließen für den Range-Track praktisch nichts übrig
- Feste Track-Breite (min 120px) und kein Shrink im Compact-Header

## 4.1.3 — Manual: Dauerhafte Stimulation (B0-Heartbeat)

### Behoben
- **Manual nur kurz spürbar beim Freq-Drehen**: Coyote V3 braucht alle ~100 ms ein frisches `0xB0` (4×25 ms Wave-Segmente). Identische Pakete wurden als „dirty skip“ verworfen — Output starb nach einem Frame
- **Wave-Loop im Manual nur alle 500 ms**: Bei Strength > 0 läuft der Loop jetzt durchgängig mit 100 ms
- **Master wirkte nicht spürbar**: sofortiges Absolute-Strength-Reapply + Wave-Heartbeat; Wave-Loop `force:true` verhindert Coalescing des Dauerstroms

### Intern
- `isDirty` nur noch Kurzfenster-Coalesce (<40 ms, Slider-Thrash); Wave-Loop und Strength immer `force`
- `hasLiveOutput()` steuert 100 ms vs. 500 ms Idle

## 4.1.2 — Coyote-3-Ansteuerung: B1, Master-Scale, Kanal-Swap

### Behoben
- **B1-Feedback korrumpierte logische Strength bei `masterScale ≠ 1`**: Geräte-Wire-Werte landeten unskaliert in der UI; verspätete ACKs nach Timeout wurden als Rad-Ereignis fehlinterpretiert
- **Master-Scale über Remote/MIDI griff nicht auf Strength**: nur Wave-Amps skalierten; absolute Strength blieb am Gerät bis zum nächsten Slider-Event
- **`swapChannels` tauschte nur Wave, nicht Strength** — Kanäle mappten inkonsistent
- **`lastWave*` speicherte Wire-Werte** → doppelte Master-Scale-Anwendung beim Strength-Re-Send
- **Soft-Stop Dirty-Tracking unvollständig** (nächstes B0 konnte übersprungen werden); Soft-Stop respektiert jetzt auch `swapChannels`
- **Shock setzte Strength nach dem Burst auf 0** statt vorherige Levels wiederherzustellen

### Protokoll / Intern
- `processB1Notification` exportiert (ACK-Match inkl. `_lastStrengthSeq`, inverse Master-Scale für Rad-Eingaben)
- `deviceToLogicalStrength` / `logicalToDeviceStrength` für Wire↔UI-Roundtrip

### Tests
- 590 Tests: erweiterte `bluetooth.test.js` (B1, Swap, Master-Scale, Soft-Stop) + Remote `set_master` re-apply

## 4.1.1 — Autodrive: Erfolgsrate zählt korrekt

### Behoben
- **`climaxRate` unterschätzte sich systematisch**: Wer den Climax-Button während der Session nicht drückte und den Höhepunkt erst im Debrief meldete, wurde nicht gezählt — `applyDebrief` addierte nachweislich `+ 0` auf `climaxHits`. Debrief-Meldungen zählen jetzt, und die Rate wird neu berechnet.
- Schutz gegen Doppelzählung: Das `endedAt` der letzten Session dient als Kennung, ein erneut abgeschicktes Debrief zählt nicht nochmal.

### Tests
- 578 Tests (vorher 563): neue Suite `autodrive-learning.test.js` für die sitzungsübergreifende Adaption — Climax-Zählung, Idempotenz, Bias-Anpassung und deren Clamps, Soft-Limit-Coach

### Unverändert
- Ein während der Session markierter Climax bleibt gezählt, auch wenn das Debrief später „nein" sagt. Welches Signal in diesem Widerspruch gewinnen soll, ist offen.

## 4.1.0 — Remote-API, i18n & Testabdeckung

### Behoben
- **Panic-Button wuchs bei jedem Sprach-Refresh** (`STOPP` → `STOPPP` → `STOPPPP`): Der i18n-Walker ersetzte per Substring und traf das englische `STOP` innerhalb des deutschen `STOPP`
- **Remote-API hatte keinen Rückkanal**: `get_state`, `get_patterns`, `get_logs` und `autodrive_state` berechneten Ergebnisse, die verworfen wurden — die in der App angezeigten Codebeispiele warteten vergeblich auf eine Antwort
- **`set_master: 0` setzte auf 100 %** statt auf Stille (`parseInt(0) || 100` — 0 ist falsy)
- **Remote-Status meldete immer Port 8080**, unabhängig vom tatsächlichen Port
- **Port-Konflikt wurde als Erfolg gemeldet**: `startRemoteServer` gab `ok: true` zurück, bevor das `listening`-Event feststand (EADDRINUSE fiel erst danach auf)
- **`wave`-Pattern erzeugte negative Frequenzen** auf Kanal B (Phasenversatz schob den Sinus über π)
- **NaN konnte bis in den BLE-Frame durchschlagen**: `clampStrengthWithCeiling` reichte nicht-numerische Eingaben ungeprüft weiter
- **Doppelter i18n-Key** `view_settings_subtitle` — der veraltete v3-Text überschrieb den v4-Untertitel

### Remote-API
- Antwortkanal mit `id`-Korrelation: jeder Befehl bekommt `{type:"response", id, command, ok, …}` zurück
- Push-Updates über `broadcastState` (vorher exportiert, aber nie aufgerufen)
- `Origin`-Header wird abgelehnt — WebSockets unterliegen keiner Same-Origin-Policy, jede besuchte Webseite konnte den Handshake versuchen
- Token-Vergleich in konstanter Zeit (`crypto.timingSafeEqual`), Token nicht mehr im Klartext geloggt

### i18n
- Umstellung auf `data-i18n` / `data-i18n-title` / `-placeholder` / `-aria-label` — 287 Annotationen
- Deterministische Übersetzung per Key statt Substring-Scan über ~470 Strings alle 2 s
- Icon-Präfixe bleiben erhalten (`🛑 STOPP` → `🛑 STOP`)
- Von JS überschriebene Texte (Live-Status) werden beim Sprachwechsel nicht zurückgesetzt
- `MutationObserver` statt Polling; ruht vollständig solange die UI deutsch ist
- Sprachwähler in Einstellungen → App

### Tests & Werkzeug
- 563 Tests (vorher 464): neu für `remote-server`, `remote`-Befehle, `control-deck`, `autodrive`, `audio`, `i18n`
- DOM-Mock kann jetzt `querySelectorAll` mit Selektoren, `getElementById`, `createTreeWalker`, `MutationObserver`
- Source-Maps aktiv (Dev inline, Prod extern) — Stacktraces im Diagnose-Log sind wieder lesbar
- `ui-bindings-pr2…pr6.js` nach Feature benannt (`ui-profiles-hotkeys`, `ui-library-tools`, `ui-automation`, `ui-midi-pin`, `ui-vision-story`)

### Bekannte Grenze
- EN-Abdeckung umfasst die annotierten Elemente; längere Fließtexte mit eingebettetem Markup und JS-Datenquellen (Session-Stories, Templates) sind noch nicht in der MAP

## 4.0.3 — Visual Upgrade & Cyberpunk Glassmorphism UI

### App Icon & Branding
- **Neues Dual-Puls App-Icon**: Vektor-Design mit Cyan & Magenta e-stim Impulswellen auf obsidianfarbenem Glasmorphismus-Schild
- **Sidebar-Brand Update**: Neues hochauflösendes App-Icon im Sidebar-Header mit Hover-Scaling und Neonglow

### UI & Aesthetics
- **Cyberpunk Glassmorphism Design Tokens**: Obsidian-Glasflächen (`backdrop-filter: blur(20px)`), leuchtende Neon-Akzente & feine Glow-Borders
- **Futuristische Buttons & Controls**: Überarbeitete Primary, Secondary & Danger-Button-Suite mit Klick-Skalierung, Neonglow und pulsierendem Panic-STOP-Knopf
- **Tactile Sliders & Dials**: Leuchtende Schieberegler-Thumbs & veredelte Intensitäts-/Frequenz-Displays

## 4.0.2 — Manual: Frequency-Regler wie Strength

### UI
- **Frequency** pro Kanal wie XToys: großer Kreis + Slider + ±5 + Preset-Dropdown
- Live-Anzeige im Freq-Kreis; bei „Freq folgt Strength“ visuell gelockt

### Wave-Amp
- **Default: vom Pattern** (Wave-Form/Amp automatisch)
- Manueller Regler nur noch unter **„Wave-Amp Scale (optional)“**, Default 100 %
- Empfehlung: Scale nur bei zu hart/flach anfassen — nicht primäre Steuerung

## 4.0.1 — Manual Player XToys-aligned

### Vergleich XToys Coyote-Block ↔ Manual Player
| XToys | Stim App Manual |
|-------|-----------------|
| Intensity A/B (0–100% of device max) | Strength A/B (0–Soft-Limit, optional %) |
| Frequency A/B | Frequency Wire 10–240 (Sensation, kein Hz) |
| Pattern Select | 14 Waveform-Patterns + Beschreibungen |
| „update frequency when intensity changes“ | Frequency-Update: fest / mit Intensität / invers |
| Link channels | Strength A↔B · Frequency A↔B |
| Soft stop / zero | Soft-Stop · Strength 0 |
| System Audio | **STIM**-Tab (Audio-Pattern) |

### Funktionen
- Modul `manual-player.js`: Link, Freq-Follow, Pattern-Katalog, %-Anzeige
- Patterns steuern Wave-Amp; Strength bleibt am Slider (XToys Intensity × Pattern)
- Lead-Texte Manual + STIM an XToys-Terminologie angepasst

## 4.0.0 — Partial Redesign (Information Architecture)

Session-zentrische Navigation und progressive Disclosure — **kein** Full-Rewrite.

### Navigation
- Gruppen: **Session** (Home, Autodrive) · **Steuerung** (Manual, STIM) · **Mehr** (Play, Library, Connect, AI, Settings)
- „Mehr“ einklappbar (persistiert)
- **Manual/STIM-Subnav** (Pills unter dem Header)
- Hotkey-Hilfe: Tabs **1–9**, Autodrive-Feedback

### Settings
- Kern sichtbar: Sicherheit, Wellenform-Balance, Gerät, App
- Power-Features unter **Erweitert** (Profile, Hotkeys, Recorder, Scheduler, Trigger, MIDI, PIN, AI, Stats, Diagnose)
- Updates / About bleiben im Footer sichtbar

### Session UX
- Header **kompakt** bei aktiver Ausgabe (Presets/Timer ausgeblendet; Master + Safety bleiben)
- Home-CTAs und Progress über CSS-Klassen statt Inline-Styles
- Globales `:focus-visible` auch im Dark Theme

### Docs / Flags
- `docs/ROADMAP-4.0.md` — was 4.0 liefert und was bewusst später kommt
- Feature-Flag `navV4` (Default an)

## 3.14.0 — UX Polish, Partner 2.0, macOS CI

### macOS Release CI
- **Unsigned macOS build**: Windows `CSC_LINK` nicht mehr an macOS-Job (brach Signing)
- `identity: null`, `CSC_IDENTITY_AUTO_DISCOVERY=false` explizit
- DMG/ZIP x64+arm64 weiterhin als Artifacts

### Partner-Panel 2.0
- Progress-Bar, Phase-Glow, Edge/Rel/Restzeit-Status
- Stories starten, ± Intensität, Noch-nicht, Letzte Erfolgssession
- Fullscreen-Shortcut, ESC schließt
- **Shock Double-Tap** (2,5 s Arm) gegen Fehlklicks
- Toast-Feedback bei Aktionen

### UX-Polish
- Session-Chrome: Restzeit, Progress, Partner-Button, Phase-Farbakzent
- Home-Readiness-Badge (Bereit / optional STIM / noch nicht)
- STIM-Kalib als optional (Warn), nicht Session-Blocker

### Remote
- `autodrive_feedback` inkl. `nudge_up` / `nudge_down`
- `story_start` · `shock`

## 3.13.0 — Experience A+B+C (Readiness, Hybrid, Partner, Shock)

### Stufe A — Einstieg & Klarheit
- **Session-bereit-Checkliste** auf Home (BT, Soft-Limits, STIM-Kalib) mit Fix-Buttons
- **Session-Chrome** Floating-Bar bei aktivem Output (Modus, A/B, Pause/Stop/STOPP)
- **STIM-Kalib-Wizard** (Fühlbar / Zu stark → Min/Max)
- **Audio-Presets** (Bass→Power, Freq folgt, Sanft, Spektral, Invers)
- Mapping-Block einklappbar

### Stufe B — Session-Qualität
- **Hybrid-Modus**: Autodrive steuert Strength, STIM-Audio Wave/Freq
- **Fast-Quality-Loop**: 3× Fast im Push → längerer Push + Hinweis
- **Session-Stories** auf Home (Quick, Edge-Abend, Hybrid, Deny, …)
- **Partner-Panel** (große Feedback-Buttons, Start/Pause/Stop/Shock)
- **Metriken** auf Home (Sessions, Climax-Rate)

### Stufe C — Power-Features
- **Shock-Taste** (kurzer Burst in Soft-Limits)
- **Session JSON Export/Import** (Autodrive+STIM+Shock+Limits)

## 3.12.0 — STIM Player XToys-level mapping

### Vergleich XToys vs. Stim App (Coyote 3)
XToys ist eine **Layout-Plattform** (Patterns, Scripts, Online-Sessions, Shock, Draw, Multi-Toy). Unser STIM-Player war nur **Audio-Peak → Wave-Amp**.

### STIM Player Upgrade
- **Strength-Drive**: Audio steuert absolute Strength in kalibriertem Min/Max (Soft-Limits bleiben Cap)
- **Freq-Modi**: Spektrum · mit Intensität · inverse Intensität · fest (wie XToys „update frequency“)
- **Kanal-Modi**: Stereo / Mono L / Mono R / Mono Summe
- **Wave-Amp Min/Max**, Glättung (EMA), Noise-Gate
- **Output-Graph**: Strength-Historie, Farbe = Frequenz (A oben / B unten)
- **Loop / Shuffle** Playlist
- **Output-Ownership** (`audio`) beim Play
- Persistente Config `stim_app_stim_player_v1`
- Modul `stim-player.js` + Unit-Tests

## 3.11.1 — Autodrive polish (pressure, nudge, wake-lock)

### Verbesserungen
- **Time-Pressure**: ab ~72% Session-Zeit Phase beschleunigen → eher Push
- **Kein Soft-Reset** in Edge/Surge/Push und im letzten Viertel der Session
- **Push-Commit**: „Fast“ im Push verlängert Fenster + Boost-Crests
- **± Intensität** im Fullscreen (+ Tasten `-`/`=`)
- **Wake-Lock** hält Display wach während Session
- **Haptik** bei Prompt/Phase (wenn Browser erlaubt)
- **Fullscreen Auto** bei Edge/Push + Phasen-Flash/Farben
- **Session-Uhr** im Fullscreen (elapsed · remaining)
- **Connect-Banner** im Autodrive-Tab wenn getrennt
- **Onboarding**: Autodrive-Schritt
- **1-Tap** überspringt Kalib nach erfolgreichen Sessions

## 3.11.0 — Autodrive UX Complete (Fullscreen, 1-Tap, Debrief)

### UX / Climax-Quote
- **1-Tap Klassisch** auf Home (+ Letzte erfolgreiche Session)
- **Fullscreen Session-Mode** — riesige Feedback-Buttons, Edge/Rel-Bars, Hands-busy
- **Aktive Feedback-Prompts** (periodisch „Noch ok? / Fast? / Fertig?“)
- **Session-Debrief** nach Stop — Höhepunkt? / zu schwach|stark → Learning
- **Soft-Limit-Coach** bei wiederholtem „zu schwach“ + niedrigen Limits
- **Peak-Lock** nach 2× „Gut“ — Intensitätszone halten
- **Push-Boost**: „Fast“ im Push → Drop + 2 verstärkte Crests
- **Edge-Timer** + „Nächster Schritt“-Hinweis
- **A/B-Rollen**: Sync / A-Rhythmus·B-Steady / A-Steady·B-Rhythmus
- **Hotkeys** 1–7 / F·J·G für Feedback während Session
- **Remote**: `autodrive_feedback`, `autodrive_start|stop|pause|resume|state`
- **Stats**: Autodrive-Counter lokal; Home zeigt Climax-Rate

## 3.10.2 — Autodrive E-Stim Sensation Plane

### Autodrive (Research-driven)
- **Sensation Plane**: steuert wire-Freq, Duty-Cycle und A/B-Channel-Mode (sync/alt/lead) pro Phase
- **Kalibrierung**: Feedback setzt `sessionBaseline` — alle Phasen skalieren relativ dazu
- **Edge-Score** (0–100): almost/idle-drift steuert Hold/Push; UI-Meter
- **Multi-Wave Climax-Protokoll**: 4 Crest/Drop-Wellen statt nur Strength-Rampen
- **Placement-Profile**: Soft/extern, Druck/deep, Dual-Kanal (Freq-Bias, Duty, Cap)
- **Anti-Habituation**: Pattern-Wechsel-Timer + Soft-Reset-Pausen (Wave aus, Strength hält)
- **Session-Learning**: Peak-Rel, Placement, Bias über Sessions
- Duty-Gating im Wave-Loop; Freq-Lerp; Channel-Alternate

## 3.10.1 — Autodrive massiv verbessert

### Autodrive Engine
- **Adaptives Intensitätsmodell**: Feedback-Bias bleibt über Ticks erhalten (Envelope überschreibt Feedback nicht mehr)
- **Auto-Climb**: ohne negatives Feedback steigen die Intensität langsam (abschaltbar)
- **Comfort-Band**: lernt Floor/Ceiling aus „zu schwach / zu stark“
- **Session-Learning**: speichert bevorzugten Bias über Sessions (`stim_app_autodrive_learn_v1`)
- **Micro-Modulation**: Tease-Drops, Edge-Breathing, Climax-Stutter-Waves
- **Pattern-Choreografie** pro Phase (Rotation, ampScale, freqBias)
- **Neue Templates**: Marathon, Turbo, Deny & Release (plus bestehende)
- **Längerer CLIMAX_PUSH** + aggressivere Escalation; Deny einmalig bei Deny-Template
- **„Jetzt“ / „Fast“ / „Noch nicht“** reaktiver; kritische Feedbacks umgehen Rate-Limit

### Autodrive UI
- Template-Karten statt pure Dropdown
- Live-Dashboard: Phasen-Hero, Timeline, Session/Phase/Rel-Bars, A/B-Meter
- ETA gesamt + Phase, Pattern-Anzeige, Kontext-Tipps
- Dauer-Override, Auto-Climb-Toggle, größere Feedback-Buttons

## 3.10.0 — Autodrive + UX-Restrukturierung

### Features
- **🚀 Autodrive** — Offline-fähige adaptive Session-Engine (ohne LLM): Phases WARMUP→BUILD→TEASE→EDGE→SURGE→CLIMAX_PUSH→AFTERCARE, Templates (Schnell/Klassisch/Langer Tease/Intensiv), Feedback-Buttons, Soft-Limit-relative Intensität
- **🏠 Home** — Einstiegs-Tab mit Connect, Soft-Limits-Kurzinfo und Autodrive-CTA
- **Output Ownership** — Mutex für Strength/Wave (`output-owner.js`); Autodrive blockiert Fremd-Writes; killAll/forceRelease/Signal-Loss stoppen Owner
- **Feature Flags** — `stim_app_flags_v1` (autodrive, newNav, …)

### UI
- Sidebar: Home · Autodrive · Manual · STIM · Play · Library · Connect · AI · Settings
- Hotkeys 1–9 für Tabs; einmalig Home nach newNav-Aktivierung

### Technik
- Pure Engine: `frontend/js/lib/autodrive-engine.js` (unit-tested)
- Wave-Loop sole B0-Pfad für Autodrive + `btPendingMode=0x0F` bei Strength-Dirty
- Design: `docs/DESIGN-restructure-autodrive.md`

## 3.9.3 — Layout stabil beim Fensterziehen

### UI
- **Kein Layout-Shift mehr** beim Verschieben/Resizen: `100vw`/`100vh` durch `%`-Höhen ersetzt
- `scrollbar-gutter: stable` verhindert Sprung wenn die vertikale Scrollbar erscheint
- Grid: `minmax(0, 1fr)` + feste Sidebar 260px
- Header ohne `backdrop-filter` (Blur flackerte beim Drag), sticky + solid background
- Cards/Grid robuster bei schmalen Breiten (`auto-fit`)
- Electron: `backgroundColor`, `minWidth`/`minHeight`, `show` erst nach `ready-to-show`

## 3.9.2 — Connect-Button reagiert wieder

### Bugfix
- **Root cause:** `initDOMCache()` registrierte sich erst *nach* allen Modul-Imports auf `DOMContentLoaded`. Bluetooth band `DOM["btn-connect"]?.addEventListener` davor — Cache war noch leer, Listener fiel still aus.
- **Fix:** DOM-Cache wird in `state.js` als erstes Modul registriert; Connect/Disconnect werden per `getElementById`-Fallback verdrahtet und sind gegen Doppel-Bindung geschützt.
- Klick meldet sofort „Connect angeklickt…“ im Log (Feedback, dass der Handler lebt).

## 3.9.1 — Coyote-Verbindung repariert

### Bluetooth / Electron
- **Scan-Timeout 30s** (Windows liefert Gerätenamen oft verzögert)
- **Breitere Namens-Erkennung**: `47L121*`, `47L12*`, coyote, dg-lab, dglab
- **Mehr requestDevice-Filter** (OR): Name-Präfixe + Service `0x180C`
- **Timeout-Fallback**: bei einem einzigen BLE-Gerät oder spätem Namens-Match verbinden
- **Kein doppelter Connect**, kein gestapelter `gattserverdisconnected`-Listener
- Bestehende GATT-Session wird wiederverwendet, wenn noch connected
- Klarere Fehlermeldungen (kein Gerät / Service fehlt / Berechtigung)

## 3.9.0 — Security & Safety Hardening

### Sicherheit
- **XSS**: Fun-Toasts nutzen `textContent` statt `innerHTML` (keine ungefilterten Strings mehr)
- **Panic kill-all** stoppt jetzt zusätzlich: Dice, Music-Sync, Story, Webcam (Kamera freigeben), Sessions, Pattern-Ceiling
- **Panic-Cooldown**: `sendB0Now` blockiert Wave-Amps > 0 während Cooldown (kein „Nachziehen“ über Games/Sync)
- **Remote-WS**: Schreibbefehle blockiert bei Panic-Cooldown **oder** Session-PIN; nur `stop_all` / `get_*` bleiben erlaubt
- **Remote**: Master/Custom-Pattern zusätzlich abgesichert; Pattern-Interval geclampt

### Funktionen
- Close-Handler erkennt aktive Patterns/Sessions und stoppt Output vor Exit
- Session-State wird bei Panic sauber genullt

### Qualität
- Lint clean · 419/419 Tests grün

## 3.8.0 — Vollständige EN-Übersetzung

### Verbesserungen
- **🌐 i18n massiv ausgebaut** — die Übersetzungs-Map wurde von ~150 auf **~360 Einträge** erweitert. Die EN-Umschaltung übersetzt jetzt nahezu die gesamte UI statt nur weniger Strings. Abdeckung:
  - **Onboarding** (alle 5 Steps + Welcome/Intro-Texte)
  - **Sidebar/Header** (Aria-Labels, Titles, Tooltips)
  - **Channel-Karten** (Kanal A/B, Intensität, Wave-Freq/Amp, Oszilloskop, freq-select-Optionen)
  - **STIM Player** (Import, Playlist, Visualizer, Sensitivity)
  - **Mini-Games** (Reflex/Rhythm/Edge/Potato/Survival: alle Beschreibungen, Labels, Status)
  - **Pattern Editor** (Presets, Ops, Import/Preview)
  - **Remote** (Server-Status, Command-Tester, API-Referenz-Labels)
  - **AI Director Panel** (komplett: Status-Pills, Theme/Interval/Max-Intensität/Auto-Stop Labels, Hints)
  - **AI Chat Onboarding** (Persona-Beschreibungen, Kanal-Routing-Optionen, Dashboard-Labels)
  - **Settings** (Soft-Limits, Balance, Profile, Hotkeys, Recorder, Scheduler, Trigger, Memory, MIDI, PIN, AI-Endpoint, Updates, About — alle Beschreibungen + Labels + Placeholder)
  - **Hotkey-Help-Overlay** (alle Tastenkombinationen)
  - **View-Titel + Untertitel** (werden jetzt via `i18nText()` gesetzt, nicht mehr hartkodiert)
  - **Stats-Dashboard, Updater-UI, Achievements** (alle statischen Texte)
- **🔄 Periodischer i18n-Refresh** — alle 2 Sekunden wird bei aktivierter EN-Sprache die DOM-Walk-Translation erneut angewendet. Dadurch werden auch dynamisch eingefügte Inhalte (Log-Nachrichten, AI-Chat, Director-Narrative) automatisch übersetzt. Im DE-Standardmodus entsteht kein Overhead.
- **🎯 control-deck.js View-Titel** verwenden jetzt `i18nText()` statt hartkodierte Strings — Tab-Wechsel zeigt sofort die korrekte Sprache.

### Technische Details
- Template-Literals (Backticks) verwendet für Einträge mit typografischen Anführungszeichen (`„..."`), um Unicode-Quoting-Konflikte mit dem JS-Parser zu vermeiden.
- Vorhandene Einträge wurden nicht geändert (kein Breaking Change für bestehendes Matching).
- Lint clean · 419/419 Tests grün · Bundle 286.6 KB prod (-39.1%)

### Bekannte Grenzen
- JS-Log-Nachrichten mit Variablen-Interpolation (z.B. `Muster ${patternName} gestartet.`) werden nur übersetzt, wenn die exakte Zeichenkette im MAP steht. Vollständige Abdeckung aller interpolierten Nachrichten erfordert ein Folge-Refactoring auf `i18nText()`-Aufrufe in den Modulen.

## 3.7.0 — AI Director + i18n Fix

### Neue Features
- **🎬 AI Director (Flagship)** — autonomer KI-Regisseur, der eigenständig eine komplette E-Stim-Session führt. Ruft im Rhythmus (15–180s, mit konfigurierbarem Jitter) das LLM auf, erhält eine Narrative + 0–3 Stim-Befehle, führt sie aus und plant den nächsten Beat. Baut nahtlos auf der bestehenden Infrastruktur auf (LLM-Endpoint-Config, ai-bridge, ai-memory, safety-extras) — keine neuen Abhängigkeiten.
  - **State-Machine**: `IDLE → RUNNING ↔ PAUSED → IDLE` mit Start / Pause / Weiter / Stop
  - **Persona-Wahl**: Mistress / Nurse Joy / The Master (wiederverwendet bestehende Prompts)
  - **Konfiguration**: Theme/Stimmung (Freitext), Beat-Intervall (15–180s), Max. Intensität (10–150), Auto-Stop (5–60 Min), Start-Intensität
  - **Reiches JSON-Schema** vom LLM: `narrative`, `commands[]` (`set_intensity` / `play_pattern` / `create_custom_pattern` / `stop_all`), `memory` (Auto-Save in ai-memory), `mood` (`neutral|tease|punish|reward|build|cool`)
  - **Toleranter Parser**: stripping von ` ```json `-Fences, Extraktion bei Prosa drumherum, Filter unbekannter Commands, Legacy-Single-`command`-Kompatibilität
  - **Mehrlagige Safety**: (1) Connection-Check pro Beat → sonst Pause, (2) Panic-Cooldown → Beat überspringen + Retry, (3) keine Parallelität mit manuellem Chat (`AIChatState.isProcessing`), (4) Hard-Clamp an `min(softLimit, maxIntensity)`, (5) Auto-Stop-Timer, (6) **Panic-Hook** — `safety.js` dispatcht `stim:kill-all` Event → Director stoppt sich selbst + `aiStopAll()`
  - **UI**: eigenes Panel im AI-Tab (immer sichtbar, ein-/ausklappbar), Status-Pill, Live-Slider-Labels, eigenes Log-Feed für Narrativen + Commands
  - **Privacy**: nutzt nur konfigurierten LLM-Endpoint, keine zusätzliche Datenerfassung
- **🌐 i18n Fix** (bereits in `99ee62d` enthalten, hier nachgetragen) — DE↔EN-Übersetzung funktioniert jetzt tatsächlich. Leerer `data-i18n`-Scan ersetzt durch DOM-Text-Node-Walker, Übersetzungs-Map von 20 → 150+ Strings erweitert, neues `i18nText()`-Helper für JS-Code.

### Dateien
- Neu: `frontend/js/modules/ai-director.js` (Engine + UI-Bindings + Styles, ~870 Zeilen)
- Neu: `backend/tests/ai-director.test.js` (37 Tests — Config, clampIntensity, computeNextBeatMs, buildDirectorMessages, parseDirectorResponse, State-Machine)
- Geändert: `frontend/index.html` (+Director-Panel in `view-ai`: Header, Config-Grid, Log-Feed, Collapse-Button)
- Geändert: `frontend/js/main.js` (+1 Import für ai-director.js)
- Geändert: `frontend/js/modules/safety.js` (`killAllOutput()` dispatcht `stim:kill-all` CustomEvent — allows Director + künftige Module, auf Panic zu reagieren, ohne Circular Imports)
- Geändert: `README.md` (Version 1.9.0 → 3.7.0, AI Director + Webcam-Vision + Story-Modus in Feature-Liste)

### Tests
- **419/419 grün** (+37 neu)
- Lint clean (0 errors, 0 warnings)
- Bundle: 260.5 KB prod (-40.4% vs Dev)

### Safety-Design
Der Director ist **defensiv** gebaut: Jeder Beat prüft Device-Verbindung, Panic-Cooldown und laufende Chat-Verarbeitung. Auf Panic (Tastatur, Button, Close-Handler) stoppt er sich selbst + führt `aiStopAll()` aus. `maxIntensity` ist ein Hard-Limit, das auch dann greift, wenn das LLM höhere Werte emittiert (Clamp vor `updateSlidersA/B`).

### Bewusst nicht implementiert
- Webcam-Integration in den Director (Varianten dokumentiert, siehe PR-Gespräch — einfach nachrüstbar via `getLastAnalysis()` aus `webcam-vision.js`)
- Director-Preset-Sharing (JSON-Export/Import — eigenes Folge-PR)
- Voice-Aktivierung (Whisper-Dependency zu schwer für v1)

## 3.6.0 — PR6: Vision AI + Story Modus

### Neue Features
- **👁️ Webcam-Vision** — periodische Webcam-Bildanalyse durch multimodale AI (Ollama-Vision / OpenRouter-Vision). 6 hart-kodierte Datenschutz-Regeln: nie auto-enable, kein Frame-Persist, Consent-Dialog mit Opt-In-Warnung, Provider-Check nur für Vision-fähige Provider, Frame sofort verworfen nach Analyse, Indikator während aktiv.
  - Webcam-Frame als `data:image/jpeg;base64` → OpenAI-Vision-API-Format
  - JPEG 512×512, 10s Interval (konfigurierbar)
  - Vision-Response wird in AI-Chat als `👁️ Webcam-Vision:` Zeile dargestellt
- **📖 Story-Modus** — verzweigte Narrative mit Stim-Integration. Engine: State-Machine mit Szenen, Choices (nutzer-getriggert), Auto-Advance (Timer-basiert). 3 eingebaute Starter-Stories: *The Captive* (10 Min, 8 Szenen), *Interrogation* (8 Min, 6 Szenen), *Edge Rush* (6 Min, 6 Szenen).
  - Story-Format: `{id, title, startScene, scenes: {[id]: {narrative, stimCommand, choices, autoAdvance, isEnd}}}`
  - `stimCommand`-Engine: `set-strength` / `set-frequency` / `soft-stop` — validiert + ausgeführt
  - Fortschritt-Speicherung (Story kann über Sessions hinweg resumed werden)
  - AI-Szenen-Generator: `buildSceneGenPrompt()` + `parseAiScene()` — LLM generiert neue Szene

### Dateien
- Neu: `frontend/js/modules/webcam-vision.js` (Capturing + Vision-API + Privacy)
- Neu: `frontend/js/modules/story-mode.js` (State-Machine + 3 Stories + AI-Generator)
- Neu: `frontend/js/modules/ui-bindings-pr6.js` (DOM-Verdrahtung)
- Neu: `backend/tests/webcam-vision.test.js` (18 Tests)
- Neu: `backend/tests/story-mode.test.js` (35 Tests)
- Geändert: `main.js` (+3 Imports)

### Tests
- **382/382 grün** (+53 neu)
- Lint clean
- Bundle: 236.8 KB (-40.7% vs Dev)
- Electron-Smoke: 3/3 sauber

### Cross-Platform
- Webcam: `getUserMedia({video:true})` funktioniert auf Win/macOS/Linux
- Consent-Dialog: reines DOM, keine Plattform-Abhängigkeit
- Story-Modus: pure JS State-Machine, kein Plattform-Code

### Bewusst nicht implementiert
- Multi-Device-Support (braucht AppState-Split — eigenes Meta-Refactor)
- Coyote 2.0 Protokoll (braucht Hardware-Specs)
- Online Pattern-Library (braucht Backend)
- Voice-Control / Whisper (große Dependency)
- Twitch/Discord (explizit ausgeschlossen)

## 3.5.0 — PR5: Hardware + Lock

### Neue Features
- **🎹 MIDI-Controller-Mapping** — Web MIDI API. Hardware-Fader (Korg nanoKONTROL, Akai LPD8 etc.) steuern Strength / Frequenz / Master-Scale / Pattern-Triggers. Mapping-Typen: CC (continuous controller), Note (Note On mit Velocity > 0), Program Change. Pro Mapping: Input-Substring-Filter, Channel-Filter (-1 = alle), Action-Typ + Kanal + Min/Max-Wertebereich. UI-Mapping-Editor im Settings-Tab. 7-bit MIDI-Werte werden linear in [min, max] gemappt.
- **🔒 Session-PIN** — SHA-256-gehashte PIN-Sperre (per-Installation Salt). Blockt Strength-Slider / Settings-Änderungen während einer laufenden Session (consent enforcement). **PANIC + Soft-Stop bleiben IMMER freigeschaltet** (safety first). Stärke-Validierung: kurz+digits-only = schwach, Mix = stark. UI: PIN setzen/ändern/löschen + sperren/entsperren.

### Dateien
- Neu: `frontend/js/modules/midi-controller.js` (Web MIDI + Pure Mapping-Helpers)
- Neu: `frontend/js/modules/session-pin.js` (PIN-Hashing + Lock-State)
- Neu: `frontend/js/modules/ui-bindings-pr5.js` (DOM-Verdrahtung für MIDI-Manager + PIN-UI)
- Neu: `backend/tests/midi-controller.test.js` (28 Tests — Validation, Range-Mapping, Message-Matching, CRUD)
- Neu: `backend/tests/session-pin.test.js` (25 Tests — Hashing, Lock-State, Listeners, PIN-Stärke)
- Geändert: `control-deck.js` (updateSliders A/B prüfen PIN-Sperre), `bluetooth.js` (sendStrengthCommand prüft PIN-Sperre), `index.html` (+MIDI-Manager-Card, +Session-PIN-Card), `main.js` (+3 Imports)

### Tests
- **329/329 grün** (+53 neu)
- Lint clean
- Bundle: 221.5 KB (-40.7% vs Dev)
- Electron-Smoke: 3/3 sauber

### Cross-Platform
- MIDI: macOS + Windows haben nativen Chromium-Support; Linux benötigt ALSA (User muss Zugriff auf `/dev/snd/*` haben — typischerweise via `audio`-Gruppe)
- Session-PIN: Web Crypto SHA-256 verfügbar auf Win/macOS/Linux; Fallback-Hash falls crypto.subtle fehlt
- PIN-Sperre ist rein Client-Side; keine Plattform-Besonderheiten

### Wichtigster Safety-Hinweis
**PANIC + Soft-Stop sind NIEMALS durch PIN gesperrt.** Sie bypassen den Lock-Zustand immer. Der Partner kann also im Notfall immer noch everything stoppen.

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
