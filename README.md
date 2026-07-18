# DG-LAB Coyote 3.0 Control Deck

Electron-Desktop-App zur Bluetooth-Steuerung eines DG-LAB Coyote 3.0 E-Stim-Geräts.

**Repository:** [github.com/zenoxo-source/Stim-App](https://github.com/zenoxo-source/Stim-App)  
**Version:** 1.2.1

## Highlights

- **Control Deck** – Kanal A/B, Soft-Limits, Master-Scale (skaliert Geräte-Output: Strength + Wave)
- **Wellenformen & Patterns** – Presets, Sessions, AI-Custom-Patterns, Oszilloskope
- **STIM Player** – MP3/Audio → Amplitudenextraktion
- **Mini-Spiele** – Reflex Trainer, Rhythm Pulse Tapper
- **AI Chat** – Ollama / OpenRouter, Tool-Calling, Personas
- **Sicherheit** – Panic/STOPP, Close-Handler, Soft-Limits, Emergency-Stop
- **Electron-Härtung** – CSP, Context-Isolation, Sandbox, safeStorage für API-Keys

## Projektstruktur

```text
Stim-App/
  .github/workflows/     # ci.yml, release.yml (Node 24)
  .nvmrc / .node-version # 24
  frontend/
    index.html, css/, assets/
    js/                  # modules: bluetooth, audio, games, ai, settings, safety, sessions, updater
    js/lib/protocol-utils.js
  backend/
    package.json         # electron + electron-builder + electron-updater
    src/main.js, preload.js
    scripts/             # build-app, build-frontend, run-tests
    tests/
    assets/tray.png
  CHANGELOG.md
```

## Setup

### Voraussetzungen

- Node.js **24** (LTS; lokal & CI, siehe `.nvmrc` / `.node-version`)
- Windows mit Bluetooth

### Entwicklung

```bash
cd backend
npm install
npm run dev
```

### Tests, Lint, Bundle

```bash
cd backend
npm test
npm run lint
npm run build:frontend
```

### Windows-Build (Produktion)

```bash
cd backend
npm install
npm run build:app
```

Artefakte in `backend/dist-app/`:

| Datei | Beschreibung |
|-------|----------------|
| `StimApp-1.2.1-win-x64.exe` | NSIS-Installer (empfohlen) |
| `StimApp-1.2.1-portable.exe` | Portable, ohne Installation |

Der Production-Build lädt **`dist/bundle.min.js`**. Auto-Updates laufen nur in der **installierten/gepackten** App.

### Release auf GitHub veröffentlichen

1. Classic PAT mit `repo` (oder Workflow `GITHUB_TOKEN` bei Tag-Push)
2. Lokal:

```powershell
cd backend
$env:GH_TOKEN = "ghp_..."   # PAT mit repo-Scope
npm run build:app:publish
```

Oder Tag pushen (CI baut und published):

```bash
git tag v1.2.0
git push origin v1.2.0
```

Die installierte App prüft Releases über **electron-updater** (privates Repo).

### Privates Repo: Update-Token

Ohne Token liefert GitHub bei privaten Repos **404** auf `releases.atom`.  
Lösung: **Fine-grained Personal Access Token** nur auf diesem Rechner:

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained  
2. Repository access: nur `zenoxo-source/Stim-App`  
3. Permissions: **Contents → Read-only** (Metadata wird mitgegeben)  
4. Token erzeugen und in der App unter **Einstellungen → App-Updates → GitHub Update-Token** eintragen  

Der Token liegt verschlüsselt in Electron **safeStorage** (nicht im Git, nicht im Installer).  
Zum Publishen von Releases weiterhin `GH_TOKEN` in der Shell / CI setzen (`npm run build:app:publish`).

**Alternative** (wenn du den Token nicht in der App willst): Installer + `latest.yml` auf einem **öffentlichen** HTTPS-Host legen und den Updater auf `provider: generic` umstellen.

## Bluetooth

1. App starten
2. **Bluetooth Verbinden**
3. Gerät mit Prefix `47L121` / Name „Coyote“ wird erkannt
4. Bei **mehreren** passenden Geräten erscheint ein **Auswahl-Dialog**
5. Scan-Timeout: 15 s (kein hängendes `requestDevice`)

## AI & API-Keys

| Anbieter | Hinweis |
|----------|---------|
| Ollama | Endpoint z. B. `http://localhost:11434/v1/chat/completions` |
| OpenRouter | API-Key unter Einstellungen |

**Speicherung:** API-Keys liegen **verschlüsselt** im Electron-User-Data-Verzeichnis (`safeStorage` / Windows DPAPI), **nicht** im Klartext in `localStorage`.  
Alte Keys aus `localStorage` werden einmalig migriert.

## Diagnose

Unter **Einstellungen → Diagnose**:

- Protokoll ansehen / löschen
- **Export** speichert das Log als Datei (Save-Dialog)
- Versionsanzeige `vX.Y.Z`

## Tastatur

| Taste | Aktion |
|-------|--------|
| `1`–`5` | Tabs |
| `P` | STIM Play/Pause |
| `↑`/`↓` | Intensität A |
| `←`/`→` | Intensität B |
| `ESC` lang / `Strg`+`Leertaste` | Panic Stop |

## Sicherheitshinweise

- Soft-Limits setzen, mit niedriger Intensität starten
- Master skaliert nur den Geräte-Output; UI-Werte bleiben logisch
- Panic stoppt die Ausgabe, trennt Bluetooth **nicht**
- Nutzung auf eigene Verantwortung

## CI

GitHub Actions (`.github/workflows/ci.yml`): `npm ci` → lint → test → build:frontend auf Windows.

## Changelog

Siehe [CHANGELOG.md](./CHANGELOG.md).
