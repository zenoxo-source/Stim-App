# Changelog

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
