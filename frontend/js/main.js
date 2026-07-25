// main.js - Application entry point.
// Imports all modules in the correct initialization order.
// Bundled by esbuild into ../dist/bundle.min.js (see backend/scripts/build-frontend.js).

// Foundation: state, constants, i18n, protocol
import { initDOMCache } from "./state.js";
import "./modules/i18n.js";
import "./constants.js";
import "./lib/protocol-utils.js";

// Core deck: navigation + wave loop + slider handlers + diagnostics
import "./control-deck.js";

// Progressive flags + output ownership (must load before BLE writers claim)
import "./modules/feature-flags.js";
import "./modules/output-owner.js";

// Hardware / output layer
import "./modules/bluetooth.js";

// Audio engine
import "./modules/audio.js";

// Achievements & highscores (used by games)
import "./modules/highscores.js";

// Mini-games (split across two files for size)
import "./modules/games.js";
import "./modules/games-extra.js";

// Fun side features (roulette, daily challenge, quick play)
import "./modules/fun.js";

// Intensity presets
import "./modules/presets.js";

// AI bridge (tool calls from chat to hardware)
import "./modules/ai-bridge.js";

// Settings panel
import "./modules/settings.js";

// Safety layer (panic, safety timer, killAll)
import "./modules/safety.js";

// Status UI chips
import "./modules/status-ui.js";

// First-run onboarding
import "./modules/onboarding.js";

// Sessions (scripted strength/waveform programs)
import "./modules/sessions.js";

// Auto-updater UI
import "./modules/updater-ui.js";

// WebSocket remote control
import "./modules/remote.js";

// Session recorder (record/replay)
import "./modules/recorder.js";

// Statistics dashboard
import "./modules/stats.js";

// Pattern editor v1 (legacy)
import "./modules/pattern-editor.js";

// Pattern editor v2 (current)
import "./modules/pattern-editor-v2.js";

// Game config panel (tunable parameters)
import "./modules/game-config.js";

// PR1 / v3.1.0 safety extras
import "./modules/safety-extras.js";
import "./modules/ramp.js";

// PR2 / v3.2.0 UX polish
import "./modules/theme.js";
import "./modules/tab-persistence.js";
import "./modules/hotkeys.js";
import "./modules/keyboard-bindings.js";
import "./modules/profiles.js";
import "./modules/ui-bindings-pr2.js";

// PR3 / v3.3.0 content & sharing
import "./modules/pattern-import.js";
import "./modules/search.js";
import "./modules/scheduler.js";
import "./modules/recording-editor.js";
import "./modules/ui-bindings-pr3.js";

// PR4 / v3.4.0 fun + AI
import "./modules/dice.js";
import "./modules/music-sync.js";
import "./modules/triggers.js";
import "./modules/ai-memory.js";
import "./modules/ui-bindings-pr4.js";

// PR5 / v3.5.0 hardware + lock
import "./modules/midi-controller.js";
import "./modules/session-pin.js";
import "./modules/ui-bindings-pr5.js";

// PR6 / v3.6.0 vision + story
import "./modules/webcam-vision.js";
import "./modules/story-mode.js";
import "./modules/ui-bindings-pr6.js";

// AI Director (autonomous conductor: LLM + ai-bridge + safety)
import "./modules/ai-director.js";

// Autodrive (offline adaptive climax engine) + UI
import "./modules/autodrive.js";
import "./modules/autodrive-ui.js";

// Session UX: readiness, chrome, stories, partner, shock, export
import "./modules/session-readiness.js";
import "./modules/session-chrome.js";
import "./modules/session-stories.js";
import "./modules/partner-ui.js";
import "./modules/shock.js";
import "./modules/session-export.js";
import "./modules/stim-player.js";

// v4.0 IA shell: nav groups, settings advanced, compact header, Manual/STIM subnav
import "./modules/nav-shell.js";

// LLM service (chat completion + tool dispatch)
import "./llm-service.js";

// DOM cache is registered early in state.js (first import). Re-run here as a
// safety net once the full module graph has loaded (handles late-added IDs).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDOMCache, { once: true });
} else {
  initDOMCache();
}
