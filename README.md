# Stim App

Electron-Desktop-App zur Bluetooth-Steuerung eines DG-LAB Coyote 3.0.

**Repository:** [github.com/zenoxo-source/Stim-App](https://github.com/zenoxo-source/Stim-App)  
**Version:** 4.1.9

## Features

- **🏠 Home** – Connect, Soft-Limits-Kurzinfo, Autodrive-CTA  
- **🚀 Autodrive** – Offline adaptive Session (ohne LLM): Templates, Phasen, Feedback-Buttons, Soft-Limit-relative Intensität — *keine Climax-Garantie*, hohe Erfolgsrate durch Adaptation  
- **Manual (Control Deck)** – Kanal A/B, Soft-Limits, Master-Scale, Patterns, Sessions, Presets, Roulette  
- **STIM Player** – Playlist, Echtzeit-Amplituden → Stim  
- **Play / Mini-Spiele** – Reflex, Rhythm, Edge, Potato, Survival, Tages-Challenge, Quick Play  
- **Library** – Pattern Editor, Sessions, Recordings  
- **Erfolge & Stats** – lokale Achievements, Highscores, Tagesziele  
- **AI Chat** – Ollama / OpenRouter, Tool-Calling, Persona-Wahl (Mistress / Nurse Joy / The Master)  
- **🎬 AI Director** – optionaler LLM-Regisseur (nicht nötig für Autodrive)  
- **👁️ Webcam-Vision** – multimodale AI analysiert Webcam-Frames (Privacy-by-Design, Consent-gated)  
- **📖 Story-Modus** – verzweigte Narrative mit Stim-Integration, AI-Szenen-Generator  
- **Safety** – Panic/STOPP, Soft-Limits, Output-Ownership, Safety-Timer, Close-Handler, Panic-Cooldown, Signal-Loss-Watchdog  
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
