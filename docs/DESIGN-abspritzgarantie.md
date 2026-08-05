# Design Doc: Abspritzgarantie — Autodrive zuverlässig zum Höhepunkt führen

| Feld | Wert |
|------|------|
| **Titel** | Abspritzgarantie: Recherche + Engine-/Template-Tuning + Struktur |
| **Datum** | 2026-08-05 |
| **Status** | Konzept (Engine-Umsetzung folgt in diesem PR) |
| **Zielversion** | 6.1.0 |
| **Bezug** | `autodrive-engine.js` (2092 Z.), `autodrive-data.js`, `autodrive.js` (1364 Z.), `autodrive-ui.js` (1880 Z.), `wire-shaping.js`, `estim-setup.js`, `DESIGN-restructure-autodrive.md` |

---

## 1. Ehrliches Produktversprechen

„Abspritzgarantie" kann **kein** medizinisches Versprechen sein — biologische Varianz,
Soft-Limits, Elektroden-Kontakt und Consent bleiben harte Grenzen (siehe auch
`DESIGN-restructure-autodrive.md`, Non-Goals). Was die App tun kann:

1. **Alle bereits bekannten Erfolgsfaktoren bündeln** (Loops-Platzierung, Kalibrierung,
   Edge-Akkumulation, Anti-Habituation, Multi-Wave-Push).
2. **Den Push nicht einfach auslaufen lassen**, wenn der Nutzer noch nicht gekommen ist →
   Push-Retry-Loop statt direkter Aftercare.
3. **Climax-Kurven aktivieren** (v5.1 vorhanden, aber Default `"none"`) für die
   Finish-Templates — beschleunigender Frequenz-Ramp + Amplituden-Treppe.
4. **Messbare Proxy-Metriken** (Climax-Rate, Ø-Zeit bis Climax) als ehrliche
   Erfolgsmessung statt Marketingsprache.

> **Forschungsstand ehrlich dokumentiert:** Die Websuche (Tool `WebSearch`) lieferte für
> dieses Nischenthema (ESTIM-Orgasmus-Techniken, HFO-Praxis) wiederholt keine brauchbaren
> Quellen (irrelevante Treffer, leere Antworten; Foren wie SmartStim waren nicht erreichbar).
> Das Design stützt sich daher auf **etabliertes Community-Wissen** (SmartStim/PulseLabs/
> r/estim-Praxis, in der Codebasis bereits verdichtet) und die **im Repo vorhandene
> „Research-driven"-Historie** (CHANGELOG 3.10.x: Sensation Plane, Multi-Wave-Protokoll,
> Placement-Profile). Wo möglich, sind Prinzipien als Kommentare im Code verankert.

---

## 2. Recherche: Was macht ESTIM-Orgasmus zuverlässig?

Zusammengefasst aus der ESTIM-Community-Praxis und der bestehenden Code-Historie:

### 2.1 Frequenz-Band → Sensation (Coyote wire 10–240, logisch 10–1000 Hz)

| Band | Wahrnehmung | Rolle im Autodrive |
|------|-------------|--------------------|
| ~10–40 Hz | „Throb" — tief, pulsierend, massierend | Aufwärmen, Tease, Grundlage |
| ~40–100 Hz | „Buzz" — gleichmäßig, erregend | Build, Edge-Hold |
| ~100–240 Hz (log. bis 400+) | „Sharp/Sting" — stechend, punktgenau | Push, Glans-fokussiert |

**Prinzip:** Der finale Push profitiert von einem **beschleunigenden Frequenz-Ramp**
(tief → hoch) plus **Amplituden-Treppe** mit Mikro-Plateaus — genau das modelliert
`CLIMAX_CURVES` in `wire-shaping.js` (v5.1). Diese Kurven sind aber **nicht der Default**
(`climaxCurve: "none"`) — die Finish-Templates nutzen den generischen 60–120 Hz-Ramp.

### 2.2 Anti-Habituation

Konstante Stimulation → Nerven-/Wahrnehmungs-Adaptation → Sensation „stirbt". Gegenmittel
(größtenteils implementiert):

- Pattern-Wechsel-Timer (`nextHabituationAt`, `patternSegment`)
- Soft-Reset-Pausen (Wave aus, Strength hält) — `applyHabituation`
- Dither/Vibrato/Detune im Fast-Wire-Pfad (`wire-shaping.js`)

### 2.3 Edge-Akkumulation („fast, fast, fast → dann kommen")

Wiederholte „Fast"-Zyklen (Edge/Deny) erhöhen die Erregung und machen den finalen Push
stärker. Implementiert: `edgeCountDone`, `edgeScore`, `almostWithoutClimax`-Qualitäts-Loop,
`pushBoostRemaining`.

### 2.4 Push-Design: Nicht den Orgasmus „abwürgen"

Erfahrungswerte, die in `CLIMAX_WAVES_FINISH` bereits eingeflossen sind:

- **Drops nicht zu tief / zu lang** — sonst fällt der Orgasmus ab (dropFloor 0.68 statt 0.55).
- **Langer finaler Crest** (20 s) — der Körper braucht Zeit, die Schwelle zu überschreiten.
- **Beide Kanäle aktiv** (`channelMode: "both"` + `climaxPriority`), kein Kanal „kalt".
- **Duty nahe 1.0** im Push (0.82) — Gating-Wellen können den Reflex stören.
- **Keine Micro-Stutter im Finish** (`applyMicroMod` skip bei climaxPriority).

### 2.5 Größte Lücke: Der Push endet ohne Retry

`applyPhaseTimeout` → `CLIMAX_PUSH` → `enterAftercare(..., false)`:

Wenn der Push-Timeout verstreicht, **ohne dass der Nutzer „Fertig ✓" markiert**, endet die
Session direkt. Für eine „Abspritzgarantie" ist das der wichtigste Hebel:

> **Push-Retry-Loop:** Nach einem nicht-markierten Push-Timeout → kurzer Re-Arm
> (TEASE/SURGE-Slice) → erneuter Push **mit mehr Boost** — statt sofortiger Aftercare.
> Begrenzt (max. 2 Retries), Safety bleibt (Soft-Limits, Panic, Stop).

---

## 3. Umsetzung — Kern-Engine + Templates (dieser PR)

### 3.1 Neues Modul `frontend/js/lib/climax-protocol.js`

Extrahiert das Multi-Wave-Climax-Protokoll aus `autodrive-engine.js` (testbare Pure-Funktionen):

```js
export const CLIMAX_WAVES         // klassisch (4 Wellen)
export const CLIMAX_WAVES_FINISH  // Finish-Pfad (kürzere Drops, langer Final-Hold)
export const PUSH_RETRY = { maxRetries: 2, reArmMs: { TEASE: 40_000 }, boostPerRetry: 1 }

export function climaxWaveTable(config)   // Wahl anhand climaxPriority
export function pushRetryBudget(config)   // maxRetries / erlaubt?
export function pushBoostForRetry(n)      // pushBoostRemaining für Retry n
```

`autodrive-engine.js` re-exportiert `CLIMAX_WAVES`/`CLIMAX_WAVES_FINISH` (kompatibel mit
bestehenden Tests) und nutzt das neue Modul intern.

### 3.2 Push-Retry-Loop in der Engine

Neuer Config-Schlüssel **`pushRetry: boolean`** (Default aus Template; global `false`).

State-Felder:
- `pushRetriesUsed: 0`
- `lastPushStartAt: 0`

Verhalten in `applyPhaseTimeout` (`CLIMAX_PUSH`-Fall):

```
wenn userMarkedClimax  → Aftercare (unverändert)
wenn pushRetry && pushRetriesUsed < maxRetries:
    pushRetriesUsed += 1
    → setPhase(TEASE, reArmMs)   // kurzer Re-Arm, relStrength ~0.35–0.45
wenn nicht markiert & keine Retries übrig → Aftercare (unverändert)
```

Beim erneuten Erreichen von `CLIMAX_PUSH` (via SURGE) wird `pushBoostRemaining` um
`pushBoostForRetry(pushRetriesUsed)` erhöht — der zweite/ dritte Push ist kräftiger.

Zusätzlich (klein, aber wichtig für „Garantie"-Gefühl):
- **Push-Floor:** In `CLIMAX_PUSH` mit `climaxPriority` darf `relStrength` durch
  `too_strong` nicht unter ~0.62 fallen (statt ~0.72). Aktuell: `rel −= drop` (0.1–0.18)
  → bei 0.9 landet man bei ~0.72; das ist okay, aber der Floor wird explizit gemacht.

### 3.3 Climax-Kurven als Default für Finish-Templates

`sanitiseAutodriveConfig` übernimmt `climaxCurve` aus dem Template (derzeit nur
`freqFullBand`/`edgeLoops`/`edgeCycleTarget`/`climaxTarget`). Neues Template-Mapping:

| Template | climaxCurve | pushRetry | Begründung |
|----------|-------------|-----------|------------|
| `finish_loops` | `"standard"` | `true` | Kern-Finish: 90 s Ramp + Treppe |
| `finish_glans` | `"standard"` | `true` | Glans: gleiche Kurve, sanfteres Cap |
| `finish_pads` | `"standard"` | `true` | Pads: voller Push |
| `loops_rush` | `"kurz"` | `true` | 6 Min schneller Push → 60 s Kurve |
| `finish_loops_single` | `"standard"` | `true` | 1-Kanal-Finish |
| `hfo` | `"verzoegert"` | `true` | langer langsamer Aufbau → 150 s Kurve |
| `climax_factory` | `"standard"` | `true` | programmierte Edges + finale Kurve |

Klassische Nicht-Finish-Templates (`classic`, `quick_finish`, `long_tease`, `intense`,
`marathon`, `turbo`, `deny`, `loops_classic`, `loops_tease`, `loops_edge`, `loops_glans`,
`loops_single`) bleiben **unverändert** (`climaxCurve: "none"`, `pushRetry: false`) —
nur die expliziten „★ Abspritzen"-Pfade bekommen die Garantie-Heuristiken.

### 3.4 UI (surgical)

In `autodrive-ui.js`:

- **Push-Retry-Chip im Dashboard**: `Push 2/3 · Boost` wenn `pushRetriesUsed > 0`
  (neues Feld im Engine-Output `pushRetriesUsed` / `pushRetryTotal`).
- **Tip-Text im Push**: `„Fertig ✓“ wenn du kommst — sonst versucht die App es erneut.`
- Kein Umbau der Wizard-Struktur in diesem PR (Struktur-Refactoring separat, siehe §5).

---

## 4. Struktur-Refactoring (separater Schritt, nicht dieser PR)

Die großen Module bleiben vorerst stabil; eine Aufteilung in kleinere Einheiten ist
wertvoll, aber **verhaltensneutral** und gehört in einen eigenen PR (kein Big-Bang):

| Aktuell | Geplant (später) |
|---------|------------------|
| `autodrive-engine.js` (2092 Z.) | `lib/climax-protocol.js` (**in diesem PR**), `lib/autodrive-phases.js`, `lib/autodrive-feedback.js` |
| `autodrive.js` (1364 Z.) | `lib/autodrive-learning.js` (Persistenz), Rest bleibt Façade |
| `autodrive-ui.js` (1880 Z.) | `modules/autodrive-dashboard.js`, `modules/autodrive-wizard.js` |

Begründung: Diese Module sind **gut getestet** (`autodrive-engine.test.js` 795 Z.,
`autodrive.test.js`, `autodrive-learning.test.js`) — Refactoring ohne Verhaltensänderung
würde den Diff stark aufblähen und das Risiko erhöhen. Der Fokus dieses PR liegt auf dem
**fachlichen** Gewinn (Push-Retry, Kurven-Defaults), nicht auf Datei-Layout.

---

## 5. Messbare Erfolgsproxy (Observability)

Bereits vorhanden (`getAutodriveStatsSummary`, `climaxRate`, per-Template-Learning).
Neu durch Push-Retry:

- `pushRetriesUsed` im Session-Snapshot → Replay-Chart kann „Retry" markieren.
- Stat-Track `autodrive_push_retry` pro Retry.
- Langfristig: Vergleich `climaxRate` mit/ohne `pushRetry` (per-Template) → ehrliche
  Aussage, ob der Retry die Quote hebt.

---

## 6. Akzeptanzkriterien (dieser PR)

1. `CLIMAX_WAVES`/`CLIMAX_WAVES_FINISH` sind aus `climax-protocol.js` importierbar;
   Engine re-exportiert sie identisch (kein Testbruch).
2. Template `finish_loops` → `climaxCurve === "standard"`, `pushRetry === true`;
   `classic` → unverändert (`"none"` / `false`).
3. Push-Timeout ohne `userMarkedClimax` bei `pushRetry` → Phase `TEASE` (Re-Arm),
   `pushRetriesUsed === 1`; nach max. Retries → `AFTERCARE`.
4. `too_strong` in `CLIMAX_PUSH` (climaxPriority) hält `relStrength ≥ 0.62` (Floor).
5. `npm test`, `npm run lint`, Frontend-Build grün.
6. CHANGELOG-Eintrag.

---

## 7. Nicht-Ziele (dieser PR)

- Kein großes Datei-Refactoring (§4 — eigener PR).
- Keine automatische Soft-Limit-Erhöhung (Safety bleibt beim Nutzer).
- Keine medizinische Claim-Sprache in UI/Marketing.
- Kein Webcam/HR-Pflicht-Trigger.
- Keine 100%-Garantie-Versprechen.
