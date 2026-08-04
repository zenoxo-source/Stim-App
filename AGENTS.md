# AGENTS.md

## Quick Reference

### Commands
```bash
cd backend

# Development
npm run dev              # Build frontend (esbuild) + start Electron with logging
npm run start:app        # Start Electron app (assumes frontend is built)

# Build
npm run build:frontend        # esbuild bundle + minify → frontend/dist/bundle.min.js
npm run build:frontend:watch  # esbuild watch mode (rebuild on save)
npm run build:app             # Full app build (frontend + electron-builder)
npm run dist                  # Alias for build:app

# Quality
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm test                 # Run all tests (node --test, ESM)
npm run format           # Prettier format

# Versioning
npm run version:patch    # Bump patch version (3.0.0 → 3.0.1); also updates README **Version:** + prepends CHANGELOG entry
npm run version:minor    # Bump minor version (3.0.0 → 3.1.0)
npm run version:major    # Bump major version (3.0.0 → 4.0.0)
```

### Architecture
- **Backend** (`backend/src/`): Electron main process (`main.js`), preload bridge (`preload.js`), WebSocket remote server (`remote-server.js`)
- **Frontend** (`frontend/js/`): ES modules. Entry point `main.js` imports every module in init order; bundled by esbuild into a single IIFE for `frontend/index.html`. No more `window.X` globals.
- **Protocol** (`frontend/js/lib/protocol-utils.js`): Pure V3 BLE protocol helpers, shared between frontend bundle and Node tests via direct `import`.
- **Tests** (`backend/tests/`): Node `--test`, ESM. Browser globals (document/Audio/localStorage/…) provided by `backend/tests/helpers/dom-mock.js`. AppState is a singleton — tests mutate it directly instead of using a vm sandbox.

### V3 BLE Protocol (DG-LAB Coyote 3.0)
- **0xB0** (20 bytes): `B0 + ((seq&0xf)<<4)|(mode&0xf) + strA + strB + freqA[4] + intA[4] + freqB[4] + intB[4]`
  - Mode nibble: bits 3-2 = channel A, bits 1-0 = channel B (0=none, 1=+delta, 2=-delta, 3=absolute)
  - `V3_MODE_ABSOLUTE_BOTH = 0x0F`
- **0xBF** (7 bytes): `BF + limitA + limitB + freqBalA + freqBalB + waveBalA + waveBalB`
- **0xB1** (4 bytes, notification): `B1 + ackSeq + currentStrA + currentStrB`

### Conventions
- No TypeScript — plain JS with JSDoc annotations
- 2-space indent, 100-char width, double quotes, semicolons (Prettier)
- ES modules everywhere (`sourceType: "module"` in `.eslintrc.js`); no `window.X = X` global coupling
- All globals declared in `backend/.eslintrc.js` (now minimal — just browser APIs)
- Frontend entry: `frontend/js/main.js` (import order); bundled by `backend/scripts/build-frontend.js` (esbuild)
- Tests run with `node --test` (ESM); `backend/tests/package.json` declares `{"type": "module"}`

### Release Flow
1. Bump version: `npm run version:patch` (or minor/major) — updates `package.json` **and** README/CHANGELOG
2. Fill in the CHANGELOG entry the bump script inserted (`## X.Y.Z – <Titel>` placeholder)
3. Commit: `git commit -m "feat: vX.Y.Z – ..."`
4. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z: ..."`
5. Push: `git push origin main && git push origin vX.Y.Z`
6. GitHub Actions builds Windows + macOS + Linux releases automatically

### Key Files
- `frontend/js/main.js` — Entry point; imports all modules in initialization order
- `frontend/js/state.js` — AppState (central mutable state) + DOM cache + `log`; re-exports CONSTANTS
- `frontend/js/constants.js` — All constants (BLE UUIDs, limits, intervals)
- `frontend/js/lib/protocol-utils.js` — Pure protocol helpers (tested)
- `frontend/js/lib/autodrive-data.js` — Static Autodrive templates + placement profiles (split from the engine)
- `frontend/js/lib/llm-proxy.js` — Renderer-side LLM wrapper (main-process proxy + browser fallback)
- `frontend/js/modules/bluetooth.js` — BLE connection + V3 protocol implementation
- `frontend/js/control-deck.js` — Wave loop + pattern engine + slider handlers
- `frontend/js/modules/ai-state.js` — Shared mutable state for Webcam-Vision (AbortController)
- `frontend/js/modules/webcam-vision.js` — Multimodal webcam analysis (consent-gated; uses `lib/llm-proxy.js`)
- `frontend/js/modules/recorder.js` — Session recording & replay
- `backend/src/llm-proxy.js` — Main-process LLM proxy (endpoint allowlist, safeStorage key, SSE forwarding; used by Webcam-Vision; tested)
- `backend/scripts/build-frontend.js` — esbuild bundler (dev + prod output)
- `backend/scripts/bump-version.js` — Version bump across package.json/README/CHANGELOG
- `backend/tests/helpers/dom-mock.js` — Browser-API shims for Node test runner
