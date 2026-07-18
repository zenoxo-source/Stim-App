# AGENTS.md

## Quick Reference

### Commands
```bash
cd backend

# Development
npm run dev              # Start Electron app with logging
npm run start:app        # Start Electron app

# Build
npm run build:frontend   # Bundle + minify frontend JS → frontend/dist/bundle.min.js
npm run build:app        # Full app build (frontend + electron-builder)
npm run dist             # Alias for build:app

# Quality
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm test                 # Run all tests (node --test)
npm run format           # Prettier format

# Versioning
npm run version:patch    # Bump patch version (2.2.0 → 2.2.1)
npm run version:minor    # Bump minor version (2.2.0 → 2.3.0)
npm run version:major    # Bump major version (2.2.0 → 3.0.0)
```

### Architecture
- **Backend** (`backend/src/`): Electron main process (`main.js`), preload bridge (`preload.js`), WebSocket remote server (`remote-server.js`)
- **Frontend** (`frontend/js/`): Vanilla JS modules loaded via `<script>` tags in fixed order, attached to `window`
- **Protocol** (`frontend/js/lib/protocol-utils.js`): Pure V3 BLE protocol helpers, shared between browser and Node tests
- **Tests** (`backend/tests/`): Node `--test` runner, pure helpers + sandbox-evaluated modules

### V3 BLE Protocol (DG-LAB Coyote 3.0)
- **0xB0** (20 bytes): `B0 + ((seq&0xf)<<4)|(mode&0xf) + strA + strB + freqA[4] + intA[4] + freqB[4] + intB[4]`
  - Mode nibble: bits 3-2 = channel A, bits 1-0 = channel B (0=none, 1=+delta, 2=-delta, 3=absolute)
  - `V3_MODE_ABSOLUTE_BOTH = 0x0F`
- **0xBF** (7 bytes): `BF + limitA + limitB + freqBalA + freqBalB + waveBalA + waveBalB`
- **0xB1** (4 bytes, notification): `B1 + ackSeq + currentStrA + currentStrB`

### Conventions
- No TypeScript — plain JS with JSDoc annotations
- 2-space indent, 100-char width, double quotes, semicolons (Prettier)
- All globals declared in `backend/.eslintrc.js`
- Frontend scripts loaded in order defined in `backend/scripts/build-frontend.js`
- Tests run with `node --test`, no external test framework

### Release Flow
1. Bump version: `npm run version:patch` (or minor/major)
2. Update `CHANGELOG.md`
3. Commit: `git commit -m "feat: vX.Y.Z – ..."`
4. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z: ..."`
5. Push: `git push origin main && git push origin vX.Y.Z`
6. GitHub Actions builds Windows + macOS + Linux releases automatically

### Key Files
- `frontend/js/state.js` — AppState (central mutable state) + DOM cache
- `frontend/js/constants.js` — All constants (BLE UUIDs, limits, intervals)
- `frontend/js/lib/protocol-utils.js` — Pure protocol helpers (tested)
- `frontend/js/modules/bluetooth.js` — BLE connection + V3 protocol implementation
- `frontend/js/control-deck.js` — Wave loop + pattern engine + slider handlers
- `frontend/js/modules/remote.js` — WebSocket remote command handler
- `frontend/js/modules/recorder.js` — Session recording & replay
- `backend/src/remote-server.js` — WebSocket server for external control
