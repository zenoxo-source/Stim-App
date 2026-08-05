# Stim App

Electron-Desktop-App zur Bluetooth-Steuerung eines DG-LAB Coyote 3.0.

**Repository:** [github.com/zenoxo-source/Stim-App](https://github.com/zenoxo-source/Stim-App)  
**Version:** 6.5.0

## Features

- **🚀 Autodrive (Start-Tab)** – Offline adaptive Session (ohne LLM): Schnellstart, Templates, Phasen, Feedback-Buttons, Soft-Limit-relative Intensität — *keine Climax-Garantie*, hohe Erfolgsrate durch Adaptation  
- **Manual (Control Deck)** – Kanal A/B, Soft-Limits, Master-Scale, Patterns, Sessions, Presets, Roulette, Dice, Music-Sync, Trigger  
- **STIM Player** – Playlist, Echtzeit-Amplituden → Stim  
- **Library** – Pattern Editor, Sessions, Recordings, Funscript, Abend-Programme  
- **Session-UX** – Readiness-Check, Partner-Panel, Shock, Session-Stories, Export/Import  
- **Safety** – Panic/STOPP, Soft-Limits, Output-Ownership, Safety-Timer, Close-Handler, Panic-Cooldown, Signal-Loss-Watchdog  
- **Biofeedback** – Herzfrequenz-Gurt (BLE), Webcam-Vision (multimodal, Consent-gated), MIDI-Controller, Buttplug.io  
- **Updates** – electron-updater über öffentliche GitHub Releases  

> v6.0: AI-Chat, AI-Director, Story-Modus, Mini-Spiele und WebSocket-Remote wurden entfernt — die App fokussiert auf Autodrive und einfache Bedienung.

## Setup

Voraussetzung: **Node.js 24** (`.nvmrc`).

```bash
cd backend
npm install
npm run dev
```

```bash
npm test
npm run lint
npm run build:frontend
npm run build:app          # Windows Installer + Portable
```

Artefakte: `backend/dist-app/StimApp-<version>-win-x64.exe`

## Bluetooth

1. App starten  
2. **Bluetooth Verbinden**  
3. Coyote (Prefix `47L121`) auswählen  
4. Bei Verbindungsverlust: automatischer Reconnect (Status in der Sidebar)  

## Vision (Webcam)

- **Vollständig lokal** — Bewegungs-Erkennung auf 64×48-Graustufen-Frames als Biofeedback für Autodrive (kein LLM, kein Netzwerk seit v6.2)
- Bilder verlassen nie das Gerät (Privacy-by-Design, Consent-gated); nur ein Motion-Wert (0–100 %) wird ans Autodrive gemeldet

## Tastatur

| Taste | Aktion |
|-------|--------|
| `1`–`5` | Tabs (Autodrive, Manual, STIM, Library, Einstellungen) |
| `P` | STIM Play/Pause |
| `↑`/`↓` `←`/`→` | Intensität A/B |
| `Strg`+`Umschalt`+`X` | Shock-Burst |
| `Strg`+`Umschalt`+`A` | Autodrive stoppen |
| `ESC` lang / `Strg`+`Leertaste` / STOPP | Panic |

## Sicherheit

Soft-Limits setzen, niedrig starten. Panic stoppt die Ausgabe, trennt Bluetooth nicht.  
Nutzung auf eigene Verantwortung.

Beim ersten Start erscheint eine kurze **Einführung** (auch unter Einstellungen erneut aufrufbar).  
Einstellungen lassen sich **exportieren/importieren** (ohne API-Keys).

## Code Signing

Optional – siehe [docs/CODE_SIGNING.md](./docs/CODE_SIGNING.md) (`CSC_LINK` / `CSC_KEY_PASSWORD`).

## Changelog

Siehe [CHANGELOG.md](./CHANGELOG.md).
