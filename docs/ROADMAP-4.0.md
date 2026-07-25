# Stim App 4.0 — Partial Redesign (IA Abschluss)

| Feld | Wert |
|------|------|
| **Version** | 4.0.0 |
| **Datum** | 2026-07-25 |
| **Status** | Shipped (in-app) |
| **Bezug** | `DESIGN-restructure-autodrive.md` (Rev 2.4) |

## Entscheidung

**Kein Full-Rewrite.** Abschluss der Session-zentrischen Informationsarchitektur:

1. Navigation in **Session / Steuerung / Mehr**
2. **Settings**: Soft-Limits & Kern zuerst, Power-Features unter **Erweitert**
3. **Header** verdichtet während aktiver Session (Session-Chrome führt)
4. **Manual + STIM** als Steuerungs-Cluster mit Subnav
5. Hotkey-Hilfe 1–9, i18n-Nav-Labels aktualisiert

## Nicht in 4.0 (bewusst später)

| Thema | Warum später |
|-------|----------------|
| `outputOwnerStrict` global an | Risiko für Remote/MIDI/Legacy; Soft-Guard bleibt |
| Wave-Loop Strategy-Extract | großer Diff, wenig User-sichtbar |
| Legacy pattern-editor.js löschen | Flag versteckt UI; Entfernen nach Nutzungsmessung |
| Key-based i18n für alle Strings | Migrationsaufwand; DE-first bleibt |
| STIM physisch nur Sub-View | Tab `stim` + Hotkey 4 bleiben; Subnav koppelt UX |

## Dateien

- `frontend/js/modules/nav-shell.js` — IA-Runtime
- `frontend/index.html` — Nav-Gruppen, Hotkey-Hilfe, Home-Klassen
- `frontend/css/style.css` — Nav, Subnav, Header-compact, Settings-advanced
- Feature-Flag `navV4` (Dokumentation; Shell ist immer aktiv)

## Nutzung

- Sidebar: **Session** (Home, Autodrive) · **Steuerung** (Manual, STIM) · **Mehr** (einklappbar)
- Bei Manual/STIM: Pill-Subnav unter dem Header
- Einstellungen: erste 4 Karten = Sicherheit/Wave/Gerät/App; Rest unter Erweitert
- Session aktiv: Presets/Timer im Header ausgeblendet
