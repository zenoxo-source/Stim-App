# Stim App

Electron-Desktop-App zur Bluetooth-Steuerung eines DG-LAB Coyote 3.0.

**Repository:** [github.com/zenoxo-source/Stim-App](https://github.com/zenoxo-source/Stim-App)  
**Version:** 1.8.0

## Features

- **Control Deck** – Kanal A/B, Soft-Limits, Master-Scale, Patterns, Sessions, Presets, Roulette  
- **STIM Player** – Playlist, Echtzeit-Amplituden → Stim  
- **Mini-Spiele** – Reflex, Rhythm, Edge, Potato, Survival, Tages-Challenge, Quick Play  
- **Erfolge & Stats** – lokale Achievements, Highscores, Tagesziele  
- **AI Chat** – Ollama / OpenRouter, Tool-Calling  
- **Safety** – Panic/STOPP, Soft-Limits, Safety-Timer, Close-Handler  
- **Updates** – electron-updater über öffentliche GitHub Releases  

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

## AI

- **Ollama** lokal oder **OpenRouter** mit API-Key (safeStorage)  
- Tools: Intensität, Patterns, Sessions, Stop  

## Tastatur

| Taste | Aktion |
|-------|--------|
| `1`–`5` | Tabs |
| `P` | STIM Play/Pause |
| `↑`/`↓` `←`/`→` | Intensität A/B (außer in Spielen) |
| `Leertaste` | Rhythm-Tap / Edge halten |
| `A`/`B` | Hot Potato |
| `Q` | Survival aufgeben |
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
