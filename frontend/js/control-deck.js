// control-deck.js - Core state, UI, and wave loop for DG-LAB Coyote 3.0
import { AppState, DOM, log, CONSTANTS } from "./state.js";
import * as ProtocolUtils from "./lib/protocol-utils.js";
import { SESSION_STATE, updateSessionUI } from "./modules/sessions.js";
import { RECORDER } from "./modules/recorder.js";
import { PATTERN_EDITOR2, startEditorVisualizers } from "./modules/pattern-editor-v2.js";
import { trackStat } from "./modules/stats.js";
import { applyAudioMasterLink, initCanvasVisualizers } from "./modules/audio.js";
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

// Moved to lib/pattern-engine.js; imported for internal use and re-exported
// so existing importers and tests keep working unchanged.
import { computeNamedPatternWave, computePatternSlots } from "./lib/pattern-engine.js";
export { computeNamedPatternWave, computePatternSlots };
import { vibratoDelta } from "./lib/wire-shaping.js";

// v5.1: 25 ms fast wire path (shaping/beat) — the wave loop stores the base
// step instead of sending while the fast path owns the wire.
import {
  isFastWireActive,
  setShapingBase,
  syncFastWire,
  stopFastWire,
  getWireShapingCfg,
} from "./modules/fast-wire.js";

// ==========================================
// WAVE LOOP - Central playback engine
// ==========================================

export function startWaveLoop() {
  if (AppState.waveLoopInterval) clearTimeout(AppState.waveLoopInterval);

  // v5.1: let the fast path take over immediately when enabled.
  syncFastWire();

  // Coyote V3: B0 every ~100ms while outputting. Idle 500ms only when silent
  // (no strength / no wave / no pattern) — otherwise manual strength "dies"
  // after one frame.
  function hasLiveOutput() {
    return (
      AppState.activePattern ||
      AppState.isAudioPlaying ||
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

  /**
   * v6.5: 4×25 ms micro-slots from the pattern's own slot texture. Each slot
   * samples the pulse train at fractional ticks (smooth intensity ramp inside
   * the B0 packet) and applies the per-pattern frequency texture. The global
   * wire-shaping freqVibrato is layered on top when configured.
   */
  function microSlots(patternId, tick, computePattern, fA, fB) {
    if (!patternId || typeof computePattern !== "function") return undefined;
    try {
      const slots = computePatternSlots(patternId, tick, fA, fB);
      if (!slots) return undefined;
      const vib = getWireShapingCfg().freqVibrato || "none";
      if (vib === "none") return slots;
      const tBase = Date.now();
      const addVib = (list, ch) =>
        list.map((s, i) => ({
          ...s,
          freq:
            s.freq > 0
              ? Math.max(10, Math.min(240, s.freq + vibratoDelta(vib, tBase + i * 25, ch)))
              : 0,
        }));
      return { A: addVib(slots.A, 0), B: addVib(slots.B, 1) };
    } catch {
      return undefined;
    }
  }

  async function waveLoopTick() {
    if (!AppState.isConnected) {
      AppState.waveLoopInterval = setTimeout(waveLoopTick, getLoopInterval());
      return;
    }
    AppState.loopTimeCounter += 1;
    updateHeartbeat();

    // v5.1: while the fast path owns the wire, route base steps to it.
    const routeWave = (fA, aA, fB, aB, opts, stamp) => {
      if (isFastWireActive()) {
        setShapingBase({ fA, aA, fB, aB }, stamp);
        return Promise.resolve();
      }
      return sendWaveformCommand(fA, aA, fB, aB, opts);
    };
    const adStamp = () => "ad:" + (getAutodriveState()?.phase || "IDLE");

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
          await routeWave(
            audio.fA,
            audio.aA,
            audio.fB,
            audio.aB,
            opts || { writer: "wave-loop" },
            "ad:audio"
          );
          return;
        }
        await routeWave(fA, aA, fB, aB, opts || { writer: "wave-loop" }, adStamp());
      }, computeNamedPatternWave);
    } else if (AppState.activePattern === "session") {
      const tick = SESSION_STATE.computeTick();
      if (tick) {
        AppState.lastWaveFreqA = tick.fA;
        AppState.lastWaveAmpA = tick.aA;
        AppState.lastWaveFreqB = tick.fB;
        AppState.lastWaveAmpB = tick.aB;
        await routeWave(tick.fA, tick.aA, tick.fB, tick.aB, { writer: "wave-loop" }, "session");
        updateSessionUI();
      }
    } else if (AppState.activePattern) {
      let fA = AppState.frequencyA,
        aA = 0;
      let fB = AppState.frequencyB,
        aB = 0;

      // v6.5: named patterns are computed exclusively in pattern-engine.js
      // (single source of truth — envelopes + freq coupling + phase play).
      // Only ai_custom needs the live custom arrays, so it stays inline.
      if (AppState.activePattern === CONSTANTS.PATTERNS.AI_CUSTOM) {
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
      } else {
        const w = computeNamedPatternWave(AppState.activePattern, AppState.loopTimeCounter);
        fA = w.fA;
        aA = w.aA;
        fB = w.fB;
        aB = w.aB;
      }

      // XToys: optional "update frequency when intensity changes"
      const ov = maybeOverridePatternFreq(fA, fB);
      fA = ov.fA;
      fB = ov.fB;

      AppState.lastWaveFreqA = fA;
      AppState.lastWaveAmpA = aA;
      AppState.lastWaveFreqB = fB;
      AppState.lastWaveAmpB = aB;

      // F10: 25 ms micro-slots for smooth manual pattern playback.
      const pid =
        AppState.activePattern === CONSTANTS.PATTERNS.AI_CUSTOM ? null : AppState.activePattern;
      const slots = microSlots(pid, AppState.loopTimeCounter, computeNamedPatternWave, fA, fB);
      await routeWave(
        fA,
        aA,
        fB,
        aB,
        { writer: "wave-loop", slotsA: slots?.A, slotsB: slots?.B },
        String(AppState.activePattern)
      );
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

      await routeWave(out.fA, out.aA, out.fB, out.aB, { writer: "wave-loop" }, "audio");

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
    } else {
      // Idle: constant output at user frequency (owner none).
      await routeWave(
        AppState.frequencyA,
        100,
        AppState.frequencyB,
        100,
        {
          writer: "wave-loop",
        },
        "idle"
      );
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
  stopFastWire();
  if (AppState.waveLoopInterval) {
    clearTimeout(AppState.waveLoopInterval);
    AppState.waveLoopInterval = null;
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
  sendStrengthCommand(AppState.strengthA, AppState.strengthB, { writer: "manual" });
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
  sendStrengthCommand(AppState.strengthA, AppState.strengthB, { writer: "manual" });
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
  // Re-sync both channels — link-freq may mirror the change onto the peer.
  syncFreqUI("A");
  syncFreqUI("B");
  if (source !== "silent") {
    log(`Wave-Freq ${channel}: ${freqLabel(wire)}`, "info");
  }
  if (AppState.isConnected) {
    sendStrengthCommand(AppState.strengthA, AppState.strengthB, { writer: "master" });
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
        editor: [
          i18nText("nav_editor", "Library"),
          i18nText("view_editor_subtitle", "Patterns · Sessions · Recordings"),
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
      sendStrengthCommand(AppState.strengthA, AppState.strengthB, { writer: "master" });
      if (!AppState.activePattern && !AppState.isAudioPlaying) {
        sendWaveformCommand(AppState.frequencyA, 100, AppState.frequencyB, 100);
      }
    }
  });

  DOM["slider-width-b"]?.addEventListener("input", (e) => {
    AppState.pulseWidthB = parseInt(e.target.value, 10);
    if (DOM["label-width-b"]) DOM["label-width-b"].textContent = `${AppState.pulseWidthB}%`;
    if (AppState.isConnected) {
      sendStrengthCommand(AppState.strengthA, AppState.strengthB, { writer: "master" });
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
      sendStrengthCommand(AppState.strengthA, AppState.strengthB, { writer: "master" });
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
      }
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
