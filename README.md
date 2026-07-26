# Stim App

Electron-Desktop-App zur Bluetooth-Steuerung eines DG-LAB Coyote 3.0.

**Repository:** [github.com/zenoxo-source/Stim-App](https://github.com/zenoxo-source/Stim-App)  
**Version:** 4.1.4

## Features

- **ðŸ  Home** â€“ Connect, Soft-Limits-Kurzinfo, Autodrive-CTA  
- **ðŸš€ Autodrive** â€“ Offline adaptive Session (ohne LLM): Templates, Phasen, Feedback-Buttons, Soft-Limit-relative IntensitÃ¤t â€” *keine Climax-Garantie*, hohe Erfolgsrate durch Adaptation  
- **Manual (Control Deck)** â€“ Kanal A/B, Soft-Limits, Master-Scale, Patterns, Sessions, Presets, Roulette  
- **STIM Player** â€“ Playlist, Echtzeit-Amplituden â†’ Stim  
- **Play / Mini-Spiele** â€“ Reflex, Rhythm, Edge, Potato, Survival, Tages-Challenge, Quick Play  
- **Library** â€“ Pattern Editor, Sessions, Recordings  
- **Erfolge & Stats** â€“ lokale Achievements, Highscores, Tagesziele  
- **AI Chat** â€“ Ollama / OpenRouter, Tool-Calling, Persona-Wahl (Mistress / Nurse Joy / The Master)  
- **ðŸŽ¬ AI Director** â€“ optionaler LLM-Regisseur (nicht nÃ¶tig fÃ¼r Autodrive)  
- **ðŸ‘ï¸ Webcam-Vision** â€“ multimodale AI analysiert Webcam-Frames (Privacy-by-Design, Consent-gated)  
- **ðŸ“– Story-Modus** â€“ verzweigte Narrative mit Stim-Integration, AI-Szenen-Generator  
- **Safety** â€“ Panic/STOPP, Soft-Limits, Output-Ownership, Safety-Timer, Close-Handler, Panic-Cooldown, Signal-Loss-Watchdog  
- **Updates** â€“ electron-updater Ã¼ber Ã¶ffentliche GitHub Releases  

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
3. Coyote (Prefix `47L121`) auswÃ¤hlen  
4. Bei Verbindungsverlust: automatischer Reconnect (Status in der Sidebar)  

## AI

- **Ollama** lokal oder **OpenRouter** mit API-Key (safeStorage)  
- Tools: IntensitÃ¤t, Patterns, Sessions, Stop  

## Tastatur

| Taste | Aktion |
|-------|--------|
| `1`â€“`5` | Tabs |
| `P` | STIM Play/Pause |
| `â†‘`/`â†“` `â†`/`â†’` | IntensitÃ¤t A/B (auÃŸer in Spielen) |
| `Leertaste` | Rhythm-Tap / Edge halten |
| `A`/`B` | Hot Potato |
| `Q` | Survival aufgeben |
| `ESC` lang / `Strg`+`Leertaste` / STOPP | Panic |

## Sicherheit

Soft-Limits setzen, niedrig starten. Panic stoppt die Ausgabe, trennt Bluetooth nicht.  
Nutzung auf eigene Verantwortung.

Beim ersten Start erscheint eine kurze **EinfÃ¼hrung** (auch unter Einstellungen erneut aufrufbar).  
Einstellungen lassen sich **exportieren/importieren** (ohne API-Keys).

## Code Signing

Optional â€“ siehe [docs/CODE_SIGNING.md](./docs/CODE_SIGNING.md) (`CSC_LINK` / `CSC_KEY_PASSWORD`).

## Changelog

Siehe [CHANGELOG.md](./CHANGELOG.md).
