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

// LLM service (chat completion + tool dispatch)
import "./llm-service.js";

// Populate DOM cache as soon as DOM is ready.
// Module scripts are deferred, so DOMContentLoaded fires *after* this module
// executes — we still register the listener so the cache fills correctly.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDOMCache);
} else {
  initDOMCache();
}
