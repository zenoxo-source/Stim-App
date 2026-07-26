// control-deck.js - Core state, UI, and wave loop for DG-LAB Coyote 3.0
import { AppState, DOM, log, CONSTANTS } from "./state.js";
import * as ProtocolUtils from "./lib/protocol-utils.js";
import { SESSION_STATE, updateSessionUI } from "./modules/sessions.js";
import { GAME_CONFIG } from "./modules/game-config.js";
import { RECORDER } from "./modules/recorder.js";
import { PATTERN_EDITOR2, startEditorVisualizers } from "./modules/pattern-editor-v2.js";
import { trackStat } from "./modules/stats.js";
import { ensureGameStrength } from "./modules/games-extra.js";
import { applyAudioMasterLink, initCanvasVisualizers } from "./modules/audio.js";
import { updateEditorRemoteUI } from "./modules/remote.js";
import { renderAIVisualizer } from "./modules/ai-bridge.js";
import { blockDuringPanicCooldown, clampStrengthWithCeiling } from "./modules/safety-extras.js";
import { saveActiveTab } from "./modules/tab-persistence.js";
import { blockIfLocked as blockIfPinLocked } from "./modules/session-pin.js";
import {
  sendWaveformCommand,
  sendStrengthCommand,
  sendV3Init,
  sendSoftStop,
  updateHeartbeat,
} from "./modules/bluetooth.js";
import { updateOutputStatus } from "./modules/status-ui.js";
import { i18nText } from "./modules/i18n.js";
import {
  applyAutodriveWaveTick,
  isAutodriveActive,
  getAutodriveState,
} from "./modules/autodrive.js";
import { claimOutput, releaseOutput, registerOwnerStop } from "./modules/output-owner.js";
import { processAudioToStim, loadStimConfig, getStimHistory } from "./modules/stim-player.js";
import {
  onManualStrengthChanged,
  onManualFreqChanged,
  maybeOverridePatternFreq,
  applyManualFreqFollow,
  isManualFreqFollowOn,
} from "./modules/manual-player.js";

registerOwnerStop("pattern", () => {
  if (
    AppState.activePattern &&
    AppState.activePattern !== "autodrive" &&
    AppState.activePattern !== "session"
  ) {
    AppState.activePattern = null;
    document.querySelectorAll?.(".pattern-card")?.forEach?.((c) => c.classList.remove("active"));
  }
});
registerOwnerStop("session", () => {
  try {
    if (SESSION_STATE?.activeSession) {
      SESSION_STATE.activeSession = null;
      SESSION_STATE.sessionPaused = false;
    }
    if (AppState.activePattern === "session") AppState.activePattern = null;
  } catch {
    /* ignore */
  }
});

/** Draw recent stim output history (XToys-style power/freq strip). */
function drawStimOutputHistory() {
  const canvas = document.getElementById("canvas-stim-history");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const hist = getStimHistory();
  if (canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth || 300;
  if (canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight || 80;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(0, 0, w, h);
  if (hist.length < 2) return;
  const n = hist.length;
  const mid = h / 2;
  // Channel A top half, B bottom — height = strength, color = frequency
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const p = hist[i];
    const softA = AppState.softLimitA || 150;
    const softB = AppState.softLimitB || 150;
    const hA = (p.sA / softA) * (mid - 2);
    const hB = (p.sB / softB) * (mid - 2);
    const freqNorm = (f) => Math.max(0, Math.min(1, (f - 10) / 230));
    const col = (f, alpha) => {
      const t = freqNorm(f);
      // green (low) → red (high) like XToys description
      const r = Math.round(40 + 200 * t);
      const g = Math.round(180 - 120 * t);
      const b = Math.round(80 + 40 * (1 - t));
      return `rgba(${r},${g},${b},${alpha})`;
    };
    ctx.fillStyle = col(p.fA, 0.85);
    ctx.fillRect(x, mid - hA, Math.max(1, w / n + 0.5), hA);
    ctx.fillStyle = col(p.fB, 0.85);
    ctx.fillRect(x, mid, Math.max(1, w / n + 0.5), hB);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
}

// ==========================================
// Named pattern wave samples (shared with Autodrive)
// ==========================================

/**
 * Compute one tick of a named pattern waveform.
 * @param {string} patternId
 * @param {number} loopCounter
 * @returns {{ fA: number, aA: number, fB: number, aB: number }}
 */
export function computeNamedPatternWave(patternId, loopCounter) {
  let fA = AppState.frequencyA;
  let aA = 0;
  let fB = AppState.frequencyB;
  let aB = 0;
  const t = loopCounter || 0;

  switch (patternId) {
    case CONSTANTS.PATTERNS.GENTLE:
    case "gentle":
      fA = 45;
      fB = 45;
      aA = Math.round(40 + 40 * Math.sin(t * 0.3));
      aB = Math.round(40 + 40 * Math.cos(t * 0.3));
      break;
    case CONSTANTS.PATTERNS.RHYTHM:
    case "rhythm": {
      const cycleIndex = t % 12;
      fA = 35;
      fB = 35;
      if (cycleIndex === 0) {
        aA = 100;
        aB = 0;
      } else if (cycleIndex === 1) {
        aA = 50;
        aB = 0;
      } else if (cycleIndex === 3) {
        aA = 0;
        aB = 100;
      } else if (cycleIndex === 4) {
        aA = 0;
        aB = 50;
      }
      break;
    }
    case CONSTANTS.PATTERNS.TEASE:
    case "tease": {
      const cycleIndex = t % 60;
      if (cycleIndex < 20) {
        fA = Math.round(45 + cycleIndex * 5);
        fB = fA;
        aA = Math.round(cycleIndex * 5);
        aB = aA;
      }
      break;
    }
    case CONSTANTS.PATTERNS.CLIMAX:
    case "climax":
      fA = Math.round(60 + 50 * Math.sin(t * 0.4));
      fB = Math.round(60 + 50 * Math.cos(t * 0.4));
      aA = Math.round(70 + 30 * Math.sin(t * 1.5));
      aB = Math.round(70 + 30 * Math.cos(t * 1.5));
      break;
    case CONSTANTS.PATTERNS.STROBE:
    case "strobe": {
      const on = t % 2 === 0;
      fA = 60;
      fB = 60;
      aA = on ? 100 : 0;
      aB = on ? 100 : 0;
      break;
    }
    case CONSTANTS.PATTERNS.WAVE:
    case "wave": {
      const sweep = t % 80;
      const tt = sweep / 80;
      const span = CONSTANTS.MAX_FREQUENCY - CONSTANTS.MIN_FREQUENCY;
      fA = Math.round(CONSTANTS.MIN_FREQUENCY + span * Math.sin(tt * Math.PI));
      // B trails A by a quarter turn. Past tt=0.75 that pushes the argument
      // beyond π, where sin() goes negative — clamp so the sweep bottoms out
      // at the minimum instead of running to a negative wire frequency.
      fB = Math.round(CONSTANTS.MIN_FREQUENCY + span * Math.sin(tt * Math.PI + Math.PI / 4));
      fA = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fA));
      fB = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fB));
      aA = 70;
      aB = 70;
      break;
    }
    case CONSTANTS.PATTERNS.HEARTBEAT:
    case "heartbeat": {
      const cycle60 = t % 10;
      fA = 45;
      fB = 45;
      if (cycle60 === 0) {
        aA = 90;
        aB = 70;
      } else if (cycle60 === 1) {
        aA = 30;
        aB = 20;
      } else if (cycle60 === 3) {
        aA = 70;
        aB = 90;
      } else if (cycle60 === 4) {
        aA = 20;
        aB = 30;
      }
      break;
    }
    case CONSTANTS.PATTERNS.ALTERNATE:
    case "alternate": {
      const altIdx = t % 6;
      fA = 50;
      fB = 50;
      if (altIdx < 3) {
        aA = 80;
        aB = 0;
      } else {
        aA = 0;
        aB = 80;
      }
      break;
    }
    case CONSTANTS.PATTERNS.ESCALATE:
    case "escalate": {
      const escCycle = t % 35;
      fA = 50;
      fB = 50;
      if (escCycle < 30) {
        aA = Math.round((escCycle / 30) * 100);
        aB = aA;
      }
      break;
    }
    case CONSTANTS.PATTERNS.FLUTTER:
    case "flutter": {
      const flutIdx = t % 2;
      fA = 80;
      fB = 80;
      aA = flutIdx === 0 ? 100 : 0;
      aB = flutIdx === 0 ? 80 : 0;
      break;
    }
    case CONSTANTS.PATTERNS.DRIFT:
    case "drift": {
      const dt = t * 0.02;
      fA = Math.round(80 + 60 * Math.sin(dt * 0.7) * Math.cos(dt * 0.3));
      fB = Math.round(80 + 60 * Math.cos(dt * 0.5) * Math.sin(dt * 0.4));
      fA = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fA));
      fB = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fB));
      aA = Math.round(50 + 40 * Math.sin(dt * 0.6));
      aB = Math.round(50 + 40 * Math.cos(dt * 0.6));
      break;
    }
    case CONSTANTS.PATTERNS.SAWTOOTH:
    case "sawtooth": {
      const sawCycle = t % 20;
      fA = 50;
      fB = 55;
      aA = Math.round((sawCycle / 20) * 100);
      aB = Math.round(((20 - sawCycle) / 20) * 100);
      break;
    }
    case CONSTANTS.PATTERNS.DUET:
    case "duet": {
      const duetT = t * 0.15;
      fA = Math.round(60 + 30 * Math.sin(duetT));
      fB = Math.round(60 + 30 * Math.cos(duetT));
      aA = Math.round(60 + 35 * Math.sin(duetT * 1.5));
      aB = Math.round(60 + 35 * Math.cos(duetT * 1.5));
      break;
    }
    default:
      fA = 45;
      fB = 45;
      aA = 60;
      aB = 60;
  }
  return { fA, aA, fB, aB };
}

// ==========================================
// WAVE LOOP - Central playback engine
// ==========================================

export function startWaveLoop() {
  if (AppState.waveLoopInterval) clearTimeout(AppState.waveLoopInterval);

  if (!AppState.aiVisRunning) {
    AppState.aiVisRunning = true;
    renderAIVisualizer();
  }

  // Coyote V3: B0 every ~100ms while outputting. Idle 500ms only when silent
  // (no strength / no wave / no pattern) — otherwise manual strength "dies"
  // after one frame.
  function hasLiveOutput() {
    return (
      AppState.activePattern ||
      AppState.isAudioPlaying ||
      AppState.reflexState === "SHOCKING" ||
      (AppState.rhythmState && AppState.rhythmState !== "IDLE") ||
      AppState.edgeState === "RUNNING" ||
      AppState.potatoState === "LIVE" ||
      AppState.potatoState === "BOOM" ||
      AppState.survivalState === "RUNNING" ||
      isAutodriveActive() ||
      AppState.strengthA > 0 ||
      AppState.strengthB > 0 ||
      (AppState.lastWaveAmpA || 0) > 0 ||
      (AppState.lastWaveAmpB || 0) > 0
    );
  }

  function getLoopInterval() {
    if (hasLiveOutput()) {
      return CONSTANTS.WAVE_LOOP_INTERVAL_MS; // 100ms
    }
    return CONSTANTS.WAVE_LOOP_IDLE_MS || 500; // silent idle only
  }

  async function waveLoopTick() {
    if (!AppState.isConnected) {
      AppState.waveLoopInterval = setTimeout(waveLoopTick, getLoopInterval());
      return;
    }
    AppState.loopTimeCounter += 1;
    updateHeartbeat();

    if (AppState.activePattern === "autodrive") {
      const hybridOn =
        !!getAutodriveState()?.config?.hybridAudio &&
        AppState.isAudioPlaying &&
        AppState.analyserA &&
        AppState.analyserB;
      await applyAutodriveWaveTick(async (fA, aA, fB, aB, opts) => {
        if (hybridOn) {
          const cfg = loadStimConfig();
          if (AppState.sensitivityA) cfg.sensitivityA = AppState.sensitivityA;
          if (AppState.sensitivityB) cfg.sensitivityB = AppState.sensitivityB;
          const audio = processAudioToStim(AppState.analyserA, AppState.analyserB, {
            ...cfg,
            strengthDrive: false,
          });
          AppState.lastWaveFreqA = audio.fA;
          AppState.lastWaveAmpA = audio.aA;
          AppState.lastWaveFreqB = audio.fB;
          AppState.lastWaveAmpB = audio.aB;
          await sendWaveformCommand(
            audio.fA,
            audio.aA,
            audio.fB,
            audio.aB,
            opts || {
              writer: "wave-loop",
            }
          );
          return;
        }
        await sendWaveformCommand(fA, aA, fB, aB, opts || { writer: "wave-loop" });
      }, computeNamedPatternWave);
    } else if (AppState.activePattern === "session") {
      const tick = SESSION_STATE.computeTick();
      if (tick) {
        AppState.lastWaveFreqA = tick.fA;
        AppState.lastWaveAmpA = tick.aA;
        AppState.lastWaveFreqB = tick.fB;
        AppState.lastWaveAmpB = tick.aB;
        await sendWaveformCommand(tick.fA, tick.aA, tick.fB, tick.aB, { writer: "wave-loop" });
        updateSessionUI();
      }
    } else if (AppState.activePattern) {
      let fA = AppState.frequencyA,
        aA = 0;
      let fB = AppState.frequencyB,
        aB = 0;

      if (AppState.activePattern === CONSTANTS.PATTERNS.GENTLE) {
        fA = 45;
        fB = 45;
        aA = Math.round(40 + 40 * Math.sin(AppState.loopTimeCounter * 0.3));
        aB = Math.round(40 + 40 * Math.cos(AppState.loopTimeCounter * 0.3));
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.RHYTHM) {
        const cycleIndex = AppState.loopTimeCounter % 12;
        fA = 35;
        fB = 35;
        if (cycleIndex === 0) {
          aA = 100;
          aB = 0;
        } else if (cycleIndex === 1) {
          aA = 50;
          aB = 0;
        } else if (cycleIndex === 3) {
          aA = 0;
          aB = 100;
        } else if (cycleIndex === 4) {
          aA = 0;
          aB = 50;
        } else {
          aA = 0;
          aB = 0;
        }
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.TEASE) {
        const cycleIndex = AppState.loopTimeCounter % 60;
        if (cycleIndex < 20) {
          fA = Math.round(45 + cycleIndex * 5);
          fB = fA;
          aA = Math.round(cycleIndex * 5);
          aB = aA;
        } else {
          aA = 0;
          aB = 0;
        }
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.CLIMAX) {
        fA = Math.round(60 + 50 * Math.sin(AppState.loopTimeCounter * 0.4));
        fB = Math.round(60 + 50 * Math.cos(AppState.loopTimeCounter * 0.4));
        aA = Math.round(70 + 30 * Math.sin(AppState.loopTimeCounter * 1.5));
        aB = Math.round(70 + 30 * Math.cos(AppState.loopTimeCounter * 1.5));
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.STROBE) {
        const cycleIndex = AppState.loopTimeCounter % 2;
        fA = 60;
        fB = 60;
        aA = cycleIndex === 0 ? 100 : 0;
        aB = cycleIndex === 0 ? 100 : 0;
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.RANDOM) {
        fA = AppState.frequencyA;
        fB = AppState.frequencyB;
        aA = Math.round(Math.random() * 100);
        aB = Math.round(Math.random() * 100);
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.AI_CUSTOM) {
        const tick = Math.floor(
          Date.now() / (AppState.aiCustomInterval || CONSTANTS.WAVE_LOOP_INTERVAL_MS)
        );
        aA =
          AppState.aiCustomPatternA.length > 0
            ? AppState.aiCustomPatternA[tick % AppState.aiCustomPatternA.length]
            : 0;
        aB =
          AppState.aiCustomPatternB.length > 0
            ? AppState.aiCustomPatternB[tick % AppState.aiCustomPatternB.length]
            : 0;
        fA = AppState.frequencyA;
        fB = AppState.frequencyB;
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.WAVE) {
        const sweep = AppState.loopTimeCounter % 80;
        const t = sweep / 80;
        fA = Math.round(
          CONSTANTS.MIN_FREQUENCY +
            (CONSTANTS.MAX_FREQUENCY - CONSTANTS.MIN_FREQUENCY) * Math.sin(t * Math.PI)
        );
        fB = Math.round(
          CONSTANTS.MIN_FREQUENCY +
            (CONSTANTS.MAX_FREQUENCY - CONSTANTS.MIN_FREQUENCY) *
              Math.sin(t * Math.PI + Math.PI / 4)
        );
        aA = 70;
        aB = 70;
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.HEARTBEAT) {
        const cycle60 = AppState.loopTimeCounter % 10;
        fA = 45;
        fB = 45;
        if (cycle60 === 0) {
          aA = 90;
          aB = 70;
        } else if (cycle60 === 1) {
          aA = 30;
          aB = 20;
        } else if (cycle60 === 3) {
          aA = 70;
          aB = 90;
        } else if (cycle60 === 4) {
          aA = 20;
          aB = 30;
        } else {
          aA = 0;
          aB = 0;
        }
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.ALTERNATE) {
        const altIdx = AppState.loopTimeCounter % 6;
        fA = 50;
        fB = 50;
        if (altIdx < 3) {
          aA = 80;
          aB = 0;
        } else {
          aA = 0;
          aB = 80;
        }
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.ESCALATE) {
        const escCycle = AppState.loopTimeCounter % 35;
        fA = 50;
        fB = 50;
        if (escCycle < 30) {
          aA = Math.round((escCycle / 30) * 100);
          aB = Math.round((escCycle / 30) * 100);
        } else {
          aA = 0;
          aB = 0;
        }
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.FLUTTER) {
        const flutIdx = AppState.loopTimeCounter % 2;
        fA = 80;
        fB = 80;
        aA = flutIdx === 0 ? 100 : 0;
        aB = flutIdx === 0 ? 80 : 0;
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.DRIFT) {
        const dt = AppState.loopTimeCounter * 0.02;
        fA = Math.round(80 + 60 * Math.sin(dt * 0.7) * Math.cos(dt * 0.3));
        fB = Math.round(80 + 60 * Math.cos(dt * 0.5) * Math.sin(dt * 0.4));
        fA = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fA));
        fB = Math.max(CONSTANTS.MIN_FREQUENCY, Math.min(CONSTANTS.MAX_FREQUENCY, fB));
        aA = Math.round(50 + 40 * Math.sin(dt * 0.6));
        aB = Math.round(50 + 40 * Math.cos(dt * 0.6));
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.SAWTOOTH) {
        const sawCycle = AppState.loopTimeCounter % 20;
        fA = 50;
        fB = 55;
        aA = Math.round((sawCycle / 20) * 100);
        aB = Math.round(((20 - sawCycle) / 20) * 100);
      } else if (AppState.activePattern === CONSTANTS.PATTERNS.DUET) {
        const duetT = AppState.loopTimeCounter * 0.15;
        fA = Math.round(60 + 30 * Math.sin(duetT));
        fB = Math.round(60 + 30 * Math.cos(duetT));
        aA = Math.round(60 + 35 * Math.sin(duetT * 1.5));
        aB = Math.round(60 + 35 * Math.cos(duetT * 1.5));
      }

      // XToys: optional "update frequency when intensity changes"
      const ov = maybeOverridePatternFreq(fA, fB);
      fA = ov.fA;
      fB = ov.fB;

      AppState.lastWaveFreqA = fA;
      AppState.lastWaveAmpA = aA;
      AppState.lastWaveFreqB = fB;
      AppState.lastWaveAmpB = aB;

      await sendWaveformCommand(fA, aA, fB, aB, { writer: "wave-loop" });
    } else if (AppState.isAudioPlaying && AppState.analyserA && AppState.analyserB) {
      const cfg = loadStimConfig();
      // Keep sensitivity sliders in sync with config if present
      if (AppState.sensitivityA) cfg.sensitivityA = AppState.sensitivityA;
      if (AppState.sensitivityB) cfg.sensitivityB = AppState.sensitivityB;
      const out = processAudioToStim(AppState.analyserA, AppState.analyserB, cfg);

      AppState.lastWaveFreqA = out.fA;
      AppState.lastWaveAmpA = out.aA;
      AppState.lastWaveFreqB = out.fB;
      AppState.lastWaveAmpB = out.aB;

      // XToys-style: drive absolute strength from audio within calibrated min/max
      if (cfg.strengthDrive) {
        AppState.strengthA = out.strengthA;
        AppState.strengthB = out.strengthB;
        AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
        if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = String(out.strengthA);
        if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = String(out.strengthA);
        if (DOM["intensity-circle-a"])
          DOM["intensity-circle-a"].textContent = String(out.strengthA);
        if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = String(out.strengthB);
        if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = String(out.strengthB);
        if (DOM["intensity-circle-b"])
          DOM["intensity-circle-b"].textContent = String(out.strengthB);
      }

      await sendWaveformCommand(out.fA, out.aA, out.fB, out.aB, { writer: "wave-loop" });

      if (DOM["visualizer-val-a"]) {
        DOM["visualizer-val-a"].textContent = `${out.aA}% · str ${out.strengthA} · f${out.fA}`;
      }
      if (DOM["visualizer-val-b"]) {
        DOM["visualizer-val-b"].textContent = `${out.aB}% · str ${out.strengthB} · f${out.fB}`;
      }
      // Optional output history canvas
      try {
        drawStimOutputHistory();
      } catch {
        /* ignore */
      }
    } else if (AppState.reflexState === "SHOCKING") {
      const shockFreq = GAME_CONFIG.data.shockFreq;
      await sendWaveformCommand(
        shockFreq,
        AppState.reflexShockVal,
        shockFreq,
        AppState.reflexShockVal,
        { writer: "wave-loop" }
      );
    } else if (
      AppState.rhythmState !== "IDLE" ||
      AppState.edgeState === "RUNNING" ||
      AppState.potatoState === "LIVE" ||
      AppState.potatoState === "BOOM" ||
      AppState.survivalState === "RUNNING"
    ) {
      // Mini-games own their waveform output
    } else {
      // Idle: constant output at user frequency (owner none).
      await sendWaveformCommand(AppState.frequencyA, 100, AppState.frequencyB, 100, {
        writer: "wave-loop",
      });
    }

    // Capture tick for session recorder (Fix 7)
    if (RECORDER.recording) {
      RECORDER.captureTick(
        AppState.lastWaveFreqA || AppState.frequencyA,
        AppState.lastWaveAmpA || 0,
        AppState.lastWaveFreqB || AppState.frequencyB,
        AppState.lastWaveAmpB || 0
      );
    }

    // Dynamic interval: re-schedule with current delay (Fix 5)
    AppState.waveLoopInterval = setTimeout(waveLoopTick, getLoopInterval());
  }

  AppState.waveLoopInterval = setTimeout(waveLoopTick, getLoopInterval());
}

export function stopWaveLoop() {
  if (AppState.waveLoopInterval) {
    clearTimeout(AppState.waveLoopInterval);
    AppState.waveLoopInterval = null;
  }
}

// ==========================================
// AI DASHBOARD UPDATE
// ==========================================

export function updateAIDashboard() {
  if (DOM["ai-dash-int-a"]) DOM["ai-dash-int-a"].textContent = AppState.strengthA;
  if (DOM["ai-dash-int-b"]) DOM["ai-dash-int-b"].textContent = AppState.strengthB;
  if (DOM["ai-dash-pattern"]) {
    DOM["ai-dash-pattern"].textContent = AppState.activePattern
      ? AppState.activePattern.charAt(0).toUpperCase() + AppState.activePattern.slice(1)
      : "Keines";
  }
  if (DOM["ai-dash-visualizer"]) {
    DOM["ai-dash-visualizer"].classList.toggle("playing", !!AppState.activePattern);
  }
}

// ==========================================
// SLIDER & CONTROL HANDLERS
// ==========================================

export function updateSlidersA(val) {
  if (blockDuringPanicCooldown("Slider A")) return;
  if (blockIfPinLocked("Slider A")) return;
  AppState.strengthA = clampStrengthWithCeiling(parseInt(val, 10), "A");
  if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = AppState.strengthA;
  onManualStrengthChanged("A");
  if (
    AppState.softLimitA > 0 &&
    AppState.strengthA >= AppState.softLimitA &&
    AppState.strengthA > 0
  ) {
    log(`Kanal A am Soft-Limit (${AppState.softLimitA}).`, "warning");
  }
  updateAIDashboard();
  sendStrengthCommand(AppState.strengthA, AppState.strengthB);
  updateOutputStatus();
}

export function updateSlidersB(val) {
  if (blockDuringPanicCooldown("Slider B")) return;
  if (blockIfPinLocked("Slider B")) return;
  AppState.strengthB = clampStrengthWithCeiling(parseInt(val, 10), "B");
  if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = AppState.strengthB;
  onManualStrengthChanged("B");
  if (
    AppState.softLimitB > 0 &&
    AppState.strengthB >= AppState.softLimitB &&
    AppState.strengthB > 0
  ) {
    log(`Kanal B am Soft-Limit (${AppState.softLimitB}).`, "warning");
  }
  updateAIDashboard();
  sendStrengthCommand(AppState.strengthA, AppState.strengthB);
  updateOutputStatus();
}

function freqLabel(wire) {
  if (ProtocolUtils.waveFreqLabel) {
    return `${wire} · ${ProtocolUtils.waveFreqLabel(wire)}`;
  }
  return String(wire);
}

export function syncFreqUI(channel) {
  const f = channel === "A" ? AppState.frequencyA : AppState.frequencyB;
  const sel = DOM[channel === "A" ? "select-freq-a" : "select-freq-b"];
  const slider = DOM[channel === "A" ? "slider-freq-a" : "slider-freq-b"];
  const label = DOM[channel === "A" ? "label-freq-a" : "label-freq-b"];
  const circle = document.getElementById(channel === "A" ? "freq-circle-a" : "freq-circle-b");
  if (slider) slider.value = f;
  if (label) label.textContent = freqLabel(f);
  if (circle) circle.textContent = String(f);
  if (sel) {
    const opt = Array.from(sel.options).find((o) => parseInt(o.value, 10) === f);
    if (opt) sel.value = String(f);
  }
  // Dim manual freq when follow-intensity owns frequency (XToys script mode)
  const follow = isManualFreqFollowOn();
  const section = slider?.closest?.(".freq-section");
  if (section) section.classList.toggle("freq-follow-locked", follow);
}

export function setChannelFreq(channel, value, source) {
  // When XToys-style intensity→freq is on, manual freq edits are ignored until mode=fixed
  if (isManualFreqFollowOn() && source !== "follow" && source !== "silent") {
    log("Frequenz folgt Strength — Modus auf „Fest“ stellen zum manuellen Freq-Setzen.", "info");
    applyManualFreqFollow();
    syncFreqUI("A");
    syncFreqUI("B");
    return;
  }
  const wire = ProtocolUtils.clampWireFreq
    ? ProtocolUtils.clampWireFreq(value)
    : Math.max(10, Math.min(240, Math.round(Number(value) || 45)));
  if (channel === "A") AppState.frequencyA = wire;
  else AppState.frequencyB = wire;
  onManualFreqChanged(channel);
  if (channel === "A") syncFreqUI("A");
  else syncFreqUI("B");
  // Re-sync peer if link-freq mirrored AppState
  syncFreqUI("A");
  syncFreqUI("B");
  if (source !== "silent") {
    log(`Wave-Freq ${channel}: ${freqLabel(wire)}`, "info");
  }
  if (AppState.isConnected) {
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
    if (!AppState.activePattern && !AppState.isAudioPlaying) {
      sendWaveformCommand(AppState.frequencyA, 100, AppState.frequencyB, 100);
    }
  }
}

// ==========================================
// TAB NAVIGATION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("manual:zero-strength", () => {
    updateSlidersA(0);
    updateSlidersB(0);
  });
  document.addEventListener("manual:soft-stop", () => {
    updateSlidersA(0);
    updateSlidersB(0);
    if (AppState.activePattern && AppState.activePattern !== "autodrive") {
      AppState.activePattern = null;
      document.querySelectorAll?.(".pattern-card")?.forEach?.((c) => c.classList.remove("active"));
    }
    sendSoftStop({ keepStrength: false, writer: "safety" });
    log("Manual Soft-Stop (XToys-ähnlich: Output 0).", "warning");
  });

  DOM["btn-clear-logs"]?.addEventListener("click", () => {
    const terminal = DOM["terminal-log"];
    if (terminal) terminal.textContent = "[SYSTEM] Diagnose-Protokoll zur\u00fcckgesetzt.";
  });

  DOM["btn-export-logs"]?.addEventListener("click", async () => {
    const terminal = DOM["terminal-log"];
    const content = terminal ? terminal.innerText || terminal.textContent || "" : "";
    if (window.electronAPI && typeof window.electronAPI.exportLog === "function") {
      const result = await window.electronAPI.exportLog(content);
      if (result?.ok) {
        log(`Diagnose-Log exportiert: ${result.filePath}`, "success");
      } else if (!result?.canceled) {
        log(`Diagnose-Export fehlgeschlagen: ${result?.error || "unbekannt"}`, "error");
      }
    } else {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coyote-diagnose-${Date.now()}.log`;
      a.click();
      URL.revokeObjectURL(url);
      log("Diagnose-Log heruntergeladen (Browser-Fallback).", "info");
    }
  });

  const navItems = document.querySelectorAll(".nav-menu .nav-item");
  const tabViews = document.querySelectorAll(".tab-view");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const tabName = item.getAttribute("data-tab");

      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");

      tabViews.forEach((view) => view.classList.remove("active"));
      const targetView = document.getElementById(`view-${tabName}`);
      if (targetView) targetView.classList.add("active");

      // PR2 / v3.2.0 — persist last-open tab
      saveActiveTab(tabName);

      // v4.0: control subnav + more-group expansion (nav-shell may also listen)
      try {
        document.body.dataset.activeTab = tabName || "";
      } catch {
        /* ignore */
      }

      const headerTitle = DOM["view-title"];
      const headerSub = DOM["view-subtitle"];

      const titles = {
        home: [
          i18nText("nav_home", "Home"),
          i18nText("view_home_subtitle", "Verbinden · Soft-Limits · Autodrive"),
        ],
        autodrive: [
          i18nText("nav_autodrive", "Autodrive"),
          i18nText("view_autodrive_subtitle", "Adaptive Session · Feedback · Climax"),
        ],
        deck: [
          i18nText("nav_deck", "Manual"),
          i18nText("view_subtitle_deck", "XToys-Coyote · Strength · Freq · Patterns"),
        ],
        stim: [
          i18nText("nav_stim", "STIM Player"),
          i18nText("view_stim_subtitle", "XToys Audio-Pattern · Strength/Freq-Mapping"),
        ],
        games: [
          i18nText("nav_games", "Play"),
          i18nText("view_stim_title_alt", "Interaktives Feedback-Training"),
        ],
        editor: [
          i18nText("nav_editor", "Library"),
          i18nText("view_editor_subtitle", "Patterns · Sessions · Recordings"),
        ],
        remote: [
          i18nText("nav_remote", "Connect"),
          i18nText("view_remote_subtitle", "WebSocket-Steuerung & API"),
        ],
        ai: [
          i18nText("view_ai_title", "AI"),
          i18nText("view_ai_subtitle", "Chat · Director · Overlay"),
        ],
        settings: [
          i18nText("nav_settings", "Einstellungen"),
          i18nText("view_settings_subtitle", "Sicherheit zuerst · Erweitert einklappbar"),
        ],
      };

      if (tabName === "editor") {
        startEditorVisualizers();
        if (PATTERN_EDITOR2.updateUI) {
          setTimeout(() => {
            PATTERN_EDITOR2.updateUI();
            PATTERN_EDITOR2.renderSavedList();
          }, 100);
        }
      }
      if (tabName === "remote") {
        updateEditorRemoteUI();
      }

      if (titles[tabName]) {
        if (headerTitle) headerTitle.textContent = titles[tabName][0];
        if (headerSub) headerSub.textContent = titles[tabName][1];
        if (tabName === "stim") initCanvasVisualizers();
      }
    });
  });

  DOM["slider-intensity-a"]?.addEventListener("input", (e) => updateSlidersA(e.target.value));
  DOM["slider-intensity-b"]?.addEventListener("input", (e) => updateSlidersB(e.target.value));

  DOM["btn-dec-a"]?.addEventListener("click", () =>
    updateSlidersA(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthA - 5))
  );
  DOM["btn-inc-a"]?.addEventListener("click", () =>
    updateSlidersA(Math.min(AppState.softLimitA, AppState.strengthA + 5))
  );
  DOM["btn-dec-b"]?.addEventListener("click", () =>
    updateSlidersB(Math.max(CONSTANTS.MIN_INTENSITY, AppState.strengthB - 5))
  );
  DOM["btn-inc-b"]?.addEventListener("click", () =>
    updateSlidersB(Math.min(AppState.softLimitB, AppState.strengthB + 5))
  );

  DOM["select-freq-a"]?.addEventListener("change", (e) => {
    setChannelFreq("A", e.target.value);
  });
  DOM["select-freq-b"]?.addEventListener("change", (e) => {
    setChannelFreq("B", e.target.value);
  });
  DOM["slider-freq-a"]?.addEventListener("input", (e) => {
    setChannelFreq("A", e.target.value);
  });
  DOM["slider-freq-b"]?.addEventListener("input", (e) => {
    setChannelFreq("B", e.target.value);
  });
  // Frequency ± like Strength (XToys-style dial steps)
  document.getElementById("btn-freq-dec-a")?.addEventListener("click", () => {
    setChannelFreq("A", Math.max(10, (AppState.frequencyA || 45) - 5));
  });
  document.getElementById("btn-freq-inc-a")?.addEventListener("click", () => {
    setChannelFreq("A", Math.min(240, (AppState.frequencyA || 45) + 5));
  });
  document.getElementById("btn-freq-dec-b")?.addEventListener("click", () => {
    setChannelFreq("B", Math.max(10, (AppState.frequencyB || 45) - 5));
  });
  document.getElementById("btn-freq-inc-b")?.addEventListener("click", () => {
    setChannelFreq("B", Math.min(240, (AppState.frequencyB || 45) + 5));
  });

  DOM["slider-width-a"]?.addEventListener("input", (e) => {
    AppState.pulseWidthA = parseInt(e.target.value, 10);
    if (DOM["label-width-a"]) DOM["label-width-a"].textContent = `${AppState.pulseWidthA}%`;
    if (AppState.isConnected) {
      sendStrengthCommand(AppState.strengthA, AppState.strengthB);
      if (!AppState.activePattern && !AppState.isAudioPlaying) {
        sendWaveformCommand(AppState.frequencyA, 100, AppState.frequencyB, 100);
      }
    }
  });

  DOM["slider-width-b"]?.addEventListener("input", (e) => {
    AppState.pulseWidthB = parseInt(e.target.value, 10);
    if (DOM["label-width-b"]) DOM["label-width-b"].textContent = `${AppState.pulseWidthB}%`;
    if (AppState.isConnected) {
      sendStrengthCommand(AppState.strengthA, AppState.strengthB);
      if (!AppState.activePattern && !AppState.isAudioPlaying) {
        sendWaveformCommand(AppState.frequencyA, 100, AppState.frequencyB, 100);
      }
    }
  });

  // Initial labels
  syncFreqUI("A");
  syncFreqUI("B");
  if (DOM["label-width-a"]) DOM["label-width-a"].textContent = `${AppState.pulseWidthA}%`;
  if (DOM["label-width-b"]) DOM["label-width-b"].textContent = `${AppState.pulseWidthB}%`;

  // Master scale — scales wire strength + wave amp; re-apply absolute B0 immediately
  DOM["slider-master"]?.addEventListener("input", (e) => {
    const pct = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
    AppState.masterScale = pct / 100;
    if (DOM["master-val-text"]) DOM["master-val-text"].textContent = `${Math.round(pct)}%`;
    if (AppState.isConnected && AppState.writeChar) {
      // Absolute strength re-scale + continuous wave so master is felt right away
      sendStrengthCommand(AppState.strengthA, AppState.strengthB);
      if (!AppState.activePattern && !AppState.isAudioPlaying) {
        sendWaveformCommand(AppState.frequencyA, 100, AppState.frequencyB, 100, {
          writer: "wave-loop",
          force: true,
        });
      }
    }
    applyAudioMasterLink();
    updateOutputStatus();
  });

  // Settings: Soft Limits
  DOM["slider-limit-a"]?.addEventListener("input", (e) => {
    AppState.softLimitA = parseInt(e.target.value);
    if (DOM["label-limit-a"]) DOM["label-limit-a"].textContent = AppState.softLimitA;
    if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].max = AppState.softLimitA;
    if (AppState.isConnected) sendV3Init();
    log(`Soft Limit Kanal A ge\u00e4ndert auf: ${AppState.softLimitA}`, "warning");
    if (AppState.strengthA > AppState.softLimitA) updateSlidersA(AppState.softLimitA);
  });

  DOM["slider-limit-b"]?.addEventListener("input", (e) => {
    AppState.softLimitB = parseInt(e.target.value);
    if (DOM["label-limit-b"]) DOM["label-limit-b"].textContent = AppState.softLimitB;
    if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].max = AppState.softLimitB;
    if (AppState.isConnected) sendV3Init();
    log(`Soft Limit Kanal B ge\u00e4ndert auf: ${AppState.softLimitB}`, "warning");
    if (AppState.strengthB > AppState.softLimitB) updateSlidersB(AppState.softLimitB);
  });

  // Pattern Cards
  document.querySelectorAll(".pattern-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (!AppState.isConnected) {
        log("Fehler: DG-LAB Controller ist nicht verbunden.", "error");
        return;
      }

      const id = card.getAttribute("data-pattern");
      document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));

      if (SESSION_STATE.activeSession) SESSION_STATE.stop();

      if (AppState.activePattern === id) {
        AppState.activePattern = null;
        try {
          releaseOutput("pattern");
        } catch {
          /* ignore */
        }
        sendSoftStop({ keepStrength: true });
      } else {
        const claim = claimOutput("pattern");
        if (!claim.ok) {
          log(`Pattern-Claim fehlgeschlagen: ${claim.error}`, "error");
          return;
        }
        AppState.activePattern = id;
        card.classList.add("active");
        ensureGameStrength(40);
      }
      updateAIDashboard();
      if (AppState.activePattern) {
        trackStat("pattern_used", AppState.activePattern);
      }
      log(`Muster ge\u00e4ndert: ${AppState.activePattern || "Aus"}`, "info");
    });
  });

  DOM["btn-stop-pattern"]?.addEventListener("click", () => {
    document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));
    if (SESSION_STATE.activeSession) SESSION_STATE.stop();
    AppState.activePattern = null;
    try {
      releaseOutput("pattern");
    } catch {
      /* ignore */
    }
    updateSlidersA(0);
    updateSlidersB(0);
    sendSoftStop({ keepStrength: false, zeroUiStrength: true });
    updateAIDashboard();
    log("Muster gestoppt.", "info");
  });

  document.querySelectorAll(".session-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (!AppState.isConnected) {
        log("Fehler: DG-LAB Controller ist nicht verbunden.", "error");
        return;
      }
      const sessionId = card.getAttribute("data-session");
      if (SESSION_STATE.activeSession) SESSION_STATE.stop();
      const claim = claimOutput("session");
      if (!claim.ok) {
        log(`Session-Claim fehlgeschlagen: ${claim.error}`, "error");
        return;
      }
      ensureGameStrength(40);
      SESSION_STATE.start(sessionId);
    });
  });

  DOM["btn-session-pause"]?.addEventListener("click", () => {
    if (SESSION_STATE.sessionPaused) SESSION_STATE.resume();
    else SESSION_STATE.pause();
  });

  DOM["btn-session-stop"]?.addEventListener("click", () => {
    SESSION_STATE.stop();
    sendSoftStop({ keepStrength: true });
  });
});
