// audio.js - STIM Audio extraction player with playlist (XToys-inspired mapping)
import { AppState, DOM, CONSTANTS, log } from "../state.js";
import * as ProtocolUtils from "../lib/protocol-utils.js";
import { sendSoftStop, sendStrengthCommand, sendWaveformCommand } from "./bluetooth.js";
import { updateOutputStatus } from "./status-ui.js";
import { ensureGameStrength } from "./games-extra.js";
import { claimOutput, releaseOutput, registerOwnerStop } from "./output-owner.js";
import {
  loadStimConfig,
  saveStimConfig,
  resetStimSmoothing,
  applyStimAudioPreset,
  STIM_AUDIO_PRESETS,
} from "./stim-player.js";

registerOwnerStop("audio", () => {
  if (AppState.isAudioPlaying) pauseSTIMAudio();
});

function handleAudioFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const isAudioExt = ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extension);

  if (!file.type.match("audio.*") && !isAudioExt) {
    log(
      `Ungültiges Dateiformat (${file.type || "unbekannt"}). Bitte eine Audiodatei (MP3/WAV) wählen.`,
      "error"
    );
    return false;
  }

  if (!AppState.playlist) AppState.playlist = [];
  AppState.playlist.push({
    id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    name: file.name,
    file,
    url: URL.createObjectURL(file),
  });
  renderPlaylist();
  // Auto-load if nothing active
  if (!AppState.audioElement?.src || AppState.playlist.length === 1) {
    loadPlaylistIndex(AppState.playlist.length - 1);
  }
  log(`Zur Playlist: ${file.name}`, "info");
  return true;
}

function handleAudioFiles(fileList) {
  const files = Array.from(fileList || []);
  files.forEach((f) => handleAudioFile(f));
}

function renderPlaylist() {
  const el = document.getElementById("stim-playlist");
  if (!el) return;
  const list = AppState.playlist || [];
  if (list.length === 0) {
    el.innerHTML = "";
    return;
  }
  // F2: total duration of all tracks (known durations only).
  const known = list.filter((t) => Number.isFinite(t.duration));
  const totalSec = known.reduce((sum, t) => sum + t.duration, 0);
  const totalLine =
    known.length > 0
      ? `<div style="font-size:11px;opacity:0.65;padding:4px 2px;">${list.length} Tracks · Gesamt ${formatTime(totalSec)}</div>`
      : "";
  el.innerHTML =
    totalLine +
    list
      .map((t, i) => {
        const active = i === AppState.playlistIndex ? "active" : "";
        const safe = ProtocolUtils.escapeHtml(t.name);
        const dur = Number.isFinite(t.duration)
          ? ` <span style="opacity:0.5;">${formatTime(t.duration)}</span>`
          : "";
        return `<div class="stim-playlist-item ${active}" data-index="${i}">
        <span class="pl-name${active && t.name && t.name.length > 30 ? " pl-scroll" : ""}" title="${safe}">${i + 1}. ${safe}${dur}</span>
        <button type="button" class="pl-remove" data-remove="${i}" title="Entfernen">×</button>
      </div>`;
      })
      .join("");

  el.querySelectorAll(".stim-playlist-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("pl-remove")) return;
      const idx = parseInt(row.getAttribute("data-index"), 10);
      loadPlaylistIndex(idx, AppState.isAudioPlaying);
    });
  });
  el.querySelectorAll(".pl-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removePlaylistIndex(parseInt(btn.getAttribute("data-remove"), 10));
    });
  });
}

function removePlaylistIndex(idx) {
  if (!AppState.playlist || !AppState.playlist[idx]) return;
  const wasCurrent = idx === AppState.playlistIndex;
  try {
    URL.revokeObjectURL(AppState.playlist[idx].url);
  } catch (e) {
    /* ignore */
  }
  AppState.playlist.splice(idx, 1);
  if (AppState.playlist.length === 0) {
    AppState.playlistIndex = -1;
    pauseSTIMAudio();
    if (AppState.audioElement) {
      AppState.audioElement.removeAttribute("src");
      AppState.audioElement.load();
    }
    if (DOM["audio-track-title"]) DOM["audio-track-title"].textContent = "Keine Datei geladen";
    if (DOM["audio-panel"]) {
      DOM["audio-panel"].style.opacity = "0.5";
      DOM["audio-panel"].style.pointerEvents = "none";
    }
  } else if (wasCurrent) {
    const next = Math.min(idx, AppState.playlist.length - 1);
    loadPlaylistIndex(next, false);
  } else if (AppState.playlistIndex > idx) {
    AppState.playlistIndex -= 1;
  }
  renderPlaylist();
}

function loadPlaylistIndex(idx, autoplay = false) {
  if (!AppState.playlist || !AppState.playlist[idx]) return;
  AppState.playlistIndex = idx;
  const track = AppState.playlist[idx];

  if (!AppState.audioCtx) {
    AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  const wasPlaying = AppState.isAudioPlaying;
  AppState.audioElement.pause();
  AppState.audioElement.src = track.url;
  AppState.audioElement.load();
  if (DOM["audio-track-title"]) DOM["audio-track-title"].textContent = track.name;
  renderPlaylist();

  AppState.audioElement.onloadedmetadata = () => {
    log(`STIM geladen: ${track.name}`, "success");
    // F2: remember duration for the playlist total.
    if (Number.isFinite(AppState.audioElement.duration)) {
      track.duration = AppState.audioElement.duration;
    }
    renderPlaylist();
    if (DOM["audio-panel"]) {
      DOM["audio-panel"].style.opacity = "1";
      DOM["audio-panel"].style.pointerEvents = "all";
    }
    if (DOM["audio-time-duration"])
      DOM["audio-time-duration"].textContent = formatTime(AppState.audioElement.duration);
    if (DOM["audio-timeline-slider"])
      DOM["audio-timeline-slider"].max = Math.floor(AppState.audioElement.duration);
    if (DOM["audio-timeline-slider"]) DOM["audio-timeline-slider"].value = 0;
    if (DOM["audio-time-elapsed"]) DOM["audio-time-elapsed"].textContent = "00:00";
    AppState.isAudioPlaying = false;
    if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "▶️ Play";
    if (autoplay || wasPlaying) playSTIMAudio();
  };

  AppState.audioElement.onerror = () => {
    log("Fehler beim Laden der Audiodatei.", "error");
  };

  AppState.audioElement.onended = () => {
    const cfg = loadStimConfig();
    if (AppState.playlist && AppState.playlist.length > 0) {
      // Repeat-one wins over shuffle/next (works in multi-track playlists).
      if (cfg.repeatOne) {
        loadPlaylistIndex(AppState.playlistIndex, true);
        return;
      }
      if (cfg.loop && AppState.playlist.length === 1) {
        loadPlaylistIndex(0, true);
        return;
      }
      if (cfg.shuffle && AppState.playlist.length > 1) {
        let next = AppState.playlistIndex;
        while (next === AppState.playlistIndex && AppState.playlist.length > 1) {
          next = Math.floor(Math.random() * AppState.playlist.length);
        }
        loadPlaylistIndex(next, true);
        return;
      }
      if (AppState.playlistIndex < AppState.playlist.length - 1) {
        loadPlaylistIndex(AppState.playlistIndex + 1, true);
        return;
      }
      if (cfg.loop) {
        loadPlaylistIndex(0, true);
        return;
      }
    }
    AppState.isAudioPlaying = false;
    if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "▶️ Play";
    try {
      releaseOutput("audio");
    } catch {
      /* ignore */
    }
    sendSoftStop({ keepStrength: true });
    log("STIM Wiedergabe beendet.", "info");
    updateOutputStatus();
  };
}

export function applyAudioMasterLink() {
  if (!AppState.audioGainNode) return;
  const hear = AppState.audioHearSound;
  const link = document.getElementById("check-audio-master-link")?.checked ?? true;
  const base = CONSTANTS.DEFAULT_AUDIO_GAIN;
  const scale = link ? AppState.masterScale || 0 : 1;
  AppState.audioGainNode.gain.value = hear ? base * scale : 0;
}

function playSTIMAudio() {
  if (!AppState.audioCtx || !AppState.audioElement?.src) return;
  if (!AppState.isConnected) {
    log("STIM: Bluetooth verbinden, bevor Audio→Stim startet.", "error");
    return;
  }

  const claim = claimOutput("audio");
  if (!claim.ok) {
    log(`STIM: Output-Claim fehlgeschlagen (${claim.error})`, "error");
    return;
  }

  if (AppState.audioCtx.state === "suspended") {
    AppState.audioCtx.resume();
  }

  if (!AppState.mediaElementSource) {
    AppState.mediaElementSource = AppState.audioCtx.createMediaElementSource(AppState.audioElement);

    AppState.analyserA = AppState.audioCtx.createAnalyser();
    AppState.analyserB = AppState.audioCtx.createAnalyser();

    AppState.analyserA.fftSize = CONSTANTS.ANALYZER_FFT_SIZE;
    AppState.analyserB.fftSize = CONSTANTS.ANALYZER_FFT_SIZE;

    // v5.1 melody tracking: dedicated high-resolution analyser for pitch.
    AppState.pitchAnalyser = AppState.audioCtx.createAnalyser();
    AppState.pitchAnalyser.fftSize = 1024;

    AppState.audioSplitterNode = AppState.audioCtx.createChannelSplitter(2);
    AppState.mediaElementSource.connect(AppState.audioSplitterNode);
    AppState.audioSplitterNode.connect(AppState.analyserA, 0);
    AppState.audioSplitterNode.connect(AppState.analyserB, 1);
    AppState.audioSplitterNode.connect(AppState.pitchAnalyser, 0);

    AppState.audioGainNode = AppState.audioCtx.createGain();
    AppState.mediaElementSource.connect(AppState.audioGainNode);
    AppState.audioGainNode.connect(AppState.audioCtx.destination);
  }

  AppState.audioHearSound = DOM["check-hear-audio"]?.checked ?? true;
  if (DOM["check-settings-audio"]) DOM["check-settings-audio"].checked = AppState.audioHearSound;
  applyAudioMasterLink();

  const cfg = loadStimConfig();
  // Baseline strength (XToys calibration min); strengthDrive updates continuously
  ensureGameStrength(cfg.baseStrength || 40);
  resetStimSmoothing();

  AppState.audioElement.play();
  AppState.isAudioPlaying = true;
  if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "⏸️ Pause";

  log(
    `STIM gestartet · Freq=${cfg.freqMode} · StrengthDrive=${cfg.strengthDrive ? "an" : "aus"} · ${cfg.channelMode}`,
    "info"
  );

  if (AppState.audioTimer) clearInterval(AppState.audioTimer);
  AppState.audioTimer = setInterval(updateSTIMTimeline, 250);

  drawVisualizerLoop();
  updateOutputStatus();
}

function pauseSTIMAudio() {
  if (!AppState.audioElement) return;

  AppState.isAudioPlaying = false;
  AppState.audioElement.pause();
  if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "▶️ Play";
  clearInterval(AppState.audioTimer);

  try {
    releaseOutput("audio");
  } catch {
    /* ignore */
  }
  sendSoftStop({ keepStrength: true });
  log("STIM Wiedergabe pausiert.", "info");
  updateOutputStatus();
}

export { playSTIMAudio, pauseSTIMAudio, loadPlaylistIndex };

// ---------------------------------------------------------------------------
// Global media keys (F3): Play/Pause + Next/Prev work while the window is
// hidden in the tray. Wired from the main process via IPC.
// ---------------------------------------------------------------------------

export function toggleStimPlayback() {
  if (!AppState.playlist || AppState.playlist.length === 0) {
    log("Media-Key: keine Playlist geladen.", "info");
    return;
  }
  if (AppState.isAudioPlaying) {
    pauseSTIMAudio();
  } else {
    if (AppState.playlistIndex < 0 || AppState.playlistIndex >= AppState.playlist.length) {
      loadPlaylistIndex(0);
    }
    playSTIMAudio();
  }
}

export function stimPlayNext() {
  if (!AppState.playlist || AppState.playlist.length === 0) return;
  const next = (AppState.playlistIndex + 1) % AppState.playlist.length;
  loadPlaylistIndex(next, true);
}

export function stimPlayPrev() {
  if (!AppState.playlist || AppState.playlist.length === 0) return;
  const prev = (AppState.playlistIndex - 1 + AppState.playlist.length) % AppState.playlist.length;
  loadPlaylistIndex(prev, true);
}

function updateSTIMTimeline() {
  if (!AppState.isAudioPlaying || !AppState.audioElement) return;

  const elapsed = AppState.audioElement.currentTime;
  if (AppState.audioElement.ended) {
    return;
  }

  if (DOM["audio-timeline-slider"]) DOM["audio-timeline-slider"].value = Math.floor(elapsed);
  if (DOM["audio-time-elapsed"]) DOM["audio-time-elapsed"].textContent = formatTime(elapsed);
}

function formatTime(secs) {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(secs % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export function initCanvasVisualizers() {
  const canvasA = document.getElementById("canvas-vis-a");
  const canvasB = document.getElementById("canvas-vis-b");
  if (canvasA && canvasB) {
    AppState.canvasCtxA = canvasA.getContext("2d");
    AppState.canvasCtxB = canvasB.getContext("2d");
  }
}

function drawVisualizerLoop() {
  if (!AppState.isAudioPlaying) {
    cancelAnimationFrame(AppState.animationFrameId);
    return;
  }

  AppState.animationFrameId = requestAnimationFrame(drawVisualizerLoop);

  const canvasA = document.getElementById("canvas-vis-a");
  const canvasB = document.getElementById("canvas-vis-b");

  if (
    !AppState.canvasCtxA ||
    !AppState.canvasCtxB ||
    !canvasA ||
    !canvasB ||
    !AppState.analyserA ||
    !AppState.analyserB
  )
    return;

  if (canvasA.width !== canvasA.clientWidth) canvasA.width = canvasA.clientWidth;
  if (canvasA.height !== canvasA.clientHeight) canvasA.height = canvasA.clientHeight;
  if (canvasB.width !== canvasB.clientWidth) canvasB.width = canvasB.clientWidth;
  if (canvasB.height !== canvasB.clientHeight) canvasB.height = canvasB.clientHeight;

  const drawChannel = (canvas, ctx, analyser, color) => {
    const width = canvas.width;
    const height = canvas.height;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.stroke();
  };

  drawChannel(canvasA, AppState.canvasCtxA, AppState.analyserA, "#0078d4");
  drawChannel(canvasB, AppState.canvasCtxB, AppState.analyserB, "#8660a9");
}

document.addEventListener("DOMContentLoaded", () => {
  AppState.playlist = [];
  AppState.playlistIndex = -1;

  // Global media keys (F3): play/pause + next/prev from the OS media keys.
  if (window.electronAPI && typeof window.electronAPI.onMediaKey === "function") {
    window.electronAPI.onMediaKey((action) => {
      if (action === "play_pause") toggleStimPlayback();
      else if (action === "next") stimPlayNext();
      else if (action === "prev") stimPlayPrev();
    });
  }

  DOM["drop-zone"]?.addEventListener("click", () => DOM["input-stim-file"]?.click());

  DOM["drop-zone"]?.addEventListener("dragover", (e) => {
    e.preventDefault();
    DOM["drop-zone"].style.borderColor = "var(--accent-primary)";
  });

  DOM["drop-zone"]?.addEventListener("dragleave", () => {
    DOM["drop-zone"].style.borderColor = "var(--border-color)";
  });

  DOM["drop-zone"]?.addEventListener("drop", (e) => {
    e.preventDefault();
    DOM["drop-zone"].style.borderColor = "var(--border-color)";
    if (e.dataTransfer.files.length > 0) handleAudioFiles(e.dataTransfer.files);
  });

  DOM["input-stim-file"]?.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleAudioFiles(e.target.files);
      e.target.value = "";
    }
  });

  DOM["btn-play-audio"]?.addEventListener("click", () => {
    if (!AppState.audioElement || !AppState.audioElement.src) return;
    if (AppState.isAudioPlaying) pauseSTIMAudio();
    else playSTIMAudio();
  });

  document.getElementById("btn-prev-track")?.addEventListener("click", () => {
    if (!AppState.playlist?.length) return;
    const idx = Math.max(0, (AppState.playlistIndex || 0) - 1);
    loadPlaylistIndex(idx, AppState.isAudioPlaying);
  });

  document.getElementById("btn-next-track")?.addEventListener("click", () => {
    if (!AppState.playlist?.length) return;
    const idx = Math.min(AppState.playlist.length - 1, (AppState.playlistIndex || 0) + 1);
    loadPlaylistIndex(idx, AppState.isAudioPlaying);
  });

  DOM["audio-timeline-slider"]?.addEventListener("change", (e) => {
    if (!AppState.audioElement) return;
    const targetTime = parseFloat(e.target.value);
    AppState.audioElement.currentTime = targetTime;
    if (DOM["audio-time-elapsed"]) DOM["audio-time-elapsed"].textContent = formatTime(targetTime);
  });

  DOM["check-hear-audio"]?.addEventListener("change", (e) => {
    AppState.audioHearSound = e.target.checked;
    if (DOM["check-settings-audio"]) DOM["check-settings-audio"].checked = AppState.audioHearSound;
    applyAudioMasterLink();
  });

  DOM["check-settings-audio"]?.addEventListener("change", (e) => {
    AppState.audioHearSound = e.target.checked;
    if (DOM["check-hear-audio"]) DOM["check-hear-audio"].checked = AppState.audioHearSound;
    applyAudioMasterLink();
  });

  document.getElementById("check-audio-master-link")?.addEventListener("change", () => {
    applyAudioMasterLink();
  });

  DOM["slider-sens-a"]?.addEventListener("input", (e) => {
    AppState.sensitivityA = parseFloat(e.target.value);
    saveStimConfig({ sensitivityA: AppState.sensitivityA });
  });

  DOM["slider-sens-b"]?.addEventListener("input", (e) => {
    AppState.sensitivityB = parseFloat(e.target.value);
    saveStimConfig({ sensitivityB: AppState.sensitivityB });
  });

  // --- Stim mapping UI ---
  function bindStimCfg() {
    const cfg = loadStimConfig();
    const set = (id, val, isCheck) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (isCheck) el.checked = !!val;
      else el.value = String(val);
    };
    set("stim-strength-drive", cfg.strengthDrive, true);
    set("stim-str-min", cfg.strengthMin);
    set("stim-str-max", cfg.strengthMax);
    set("stim-base-str", cfg.baseStrength);
    set("stim-freq-mode", cfg.freqMode);
    set("stim-freq-fixed", cfg.freqFixed);
    set("stim-freq-min", cfg.freqMin);
    set("stim-freq-max", cfg.freqMax);
    set("stim-channel-mode", cfg.channelMode);
    set("stim-smoothing", cfg.smoothing);
    set("stim-amp-min", cfg.waveAmpMin);
    set("stim-amp-max", cfg.waveAmpMax);
    set("stim-loop", cfg.loop, true);
    set("stim-shuffle", cfg.shuffle, true);
    set("stim-repeat-one", cfg.repeatOne, true);
    set("stim-multiband", cfg.multiband, true);
    const sv = document.getElementById("stim-smoothing-val");
    if (sv) sv.textContent = Number(cfg.smoothing).toFixed(2);
    if (DOM["slider-sens-a"]) DOM["slider-sens-a"].value = cfg.sensitivityA;
    if (DOM["slider-sens-b"]) DOM["slider-sens-b"].value = cfg.sensitivityB;
    AppState.sensitivityA = cfg.sensitivityA;
    AppState.sensitivityB = cfg.sensitivityB;
  }

  function readStimCfgFromUi() {
    const num = (id, fb) => {
      const v = Number(document.getElementById(id)?.value);
      return Number.isFinite(v) ? v : fb;
    };
    const chk = (id, fb) => {
      const el = document.getElementById(id);
      return el ? !!el.checked : fb;
    };
    return saveStimConfig({
      strengthDrive: chk("stim-strength-drive", true),
      strengthMin: num("stim-str-min", 15),
      strengthMax: num("stim-str-max", 80),
      baseStrength: num("stim-base-str", 40),
      freqMode: document.getElementById("stim-freq-mode")?.value || "spectrum",
      freqFixed: num("stim-freq-fixed", 45),
      freqMin: num("stim-freq-min", 25),
      freqMax: num("stim-freq-max", 110),
      channelMode: document.getElementById("stim-channel-mode")?.value || "stereo",
      smoothing: num("stim-smoothing", 0.4),
      waveAmpMin: num("stim-amp-min", 15),
      waveAmpMax: num("stim-amp-max", 100),
      loop: chk("stim-loop", false),
      shuffle: chk("stim-shuffle", false),
      repeatOne: chk("stim-repeat-one", false),
      multiband: chk("stim-multiband", false),
      sensitivityA: AppState.sensitivityA,
      sensitivityB: AppState.sensitivityB,
    });
  }

  bindStimCfg();
  [
    "stim-strength-drive",
    "stim-str-min",
    "stim-str-max",
    "stim-base-str",
    "stim-freq-mode",
    "stim-freq-fixed",
    "stim-freq-min",
    "stim-freq-max",
    "stim-channel-mode",
    "stim-smoothing",
    "stim-amp-min",
    "stim-amp-max",
    "stim-loop",
    "stim-shuffle",
    "stim-repeat-one",
    "stim-multiband",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      readStimCfgFromUi();
      if (id === "stim-smoothing") {
        const sv = document.getElementById("stim-smoothing-val");
        if (sv)
          sv.textContent = Number(document.getElementById("stim-smoothing")?.value || 0).toFixed(2);
      }
    });
    document.getElementById(id)?.addEventListener("input", () => {
      if (id === "stim-smoothing") {
        const sv = document.getElementById("stim-smoothing-val");
        if (sv)
          sv.textContent = Number(document.getElementById("stim-smoothing")?.value || 0).toFixed(2);
      }
    });
  });

  // Audio presets
  const presetBox = document.getElementById("stim-preset-grid");
  if (presetBox) {
    presetBox.innerHTML = Object.values(STIM_AUDIO_PRESETS)
      .map(
        (p) =>
          `<button type="button" class="btn btn-secondary btn-sm stim-preset-btn" data-preset="${p.id}">${p.label}</button>`
      )
      .join("");
    presetBox.querySelectorAll(".stim-preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyStimAudioPreset(btn.getAttribute("data-preset"));
        bindStimCfg();
        log(`STIM-Preset: ${btn.textContent}`, "success");
      });
    });
  }

  // STIM calibration wizard
  let calib = { phase: "idle", min: 15, max: 80, probe: 10 };
  const setCalibStatus = (t) => {
    const el = document.getElementById("stim-calib-status");
    if (el) el.textContent = t;
  };

  document.getElementById("btn-stim-calib-start")?.addEventListener("click", () => {
    if (!AppState.isConnected) {
      log("Kalib: Bluetooth verbinden.", "error");
      return;
    }
    calib = { phase: "find_min", min: 15, max: 80, probe: 12 };
    claimOutput("manual");
    AppState.btPendingMode = CONSTANTS.V3_MODE_ABSOLUTE_BOTH;
    sendStrengthCommand(calib.probe, calib.probe, { writer: "manual" });
    sendWaveformCommand(45, 55, 45, 55, { writer: "wave-loop" });
    setCalibStatus(`Fühlschwelle: ${calib.probe}. + erhöhen, dann „Fühlbar“.`);
  });

  document.getElementById("btn-stim-calib-up")?.addEventListener("click", () => {
    if (calib.phase === "idle" || calib.phase === "done") return;
    calib.probe = Math.min(AppState.softLimitA || 150, calib.probe + 5);
    sendStrengthCommand(calib.probe, calib.probe, { writer: "manual" });
    sendWaveformCommand(45, 60, 45, 60, { writer: "wave-loop" });
    setCalibStatus(`Probe ${calib.probe} (${calib.phase})`);
  });

  document.getElementById("btn-stim-calib-feel")?.addEventListener("click", () => {
    if (calib.phase === "find_min") {
      calib.min = calib.probe;
      calib.phase = "find_max";
      calib.probe = Math.min(AppState.softLimitA || 150, calib.min + 15);
      sendStrengthCommand(calib.probe, calib.probe, { writer: "manual" });
      setCalibStatus(`Min=${calib.min}. Cap suchen ab ${calib.probe}. + / „Zu stark“.`);
    } else if (calib.phase === "find_max") {
      calib.probe = Math.min(AppState.softLimitA || 150, calib.probe + 8);
      sendStrengthCommand(calib.probe, calib.probe, { writer: "manual" });
      setCalibStatus(`Weiter ${calib.probe}… „Zu stark“ speichert Cap.`);
    }
  });

  document.getElementById("btn-stim-calib-strong")?.addEventListener("click", () => {
    if (calib.phase === "find_min") {
      calib.min = Math.max(5, calib.probe - 3);
      calib.phase = "find_max";
      calib.probe = Math.min(AppState.softLimitA || 150, calib.min + 20);
      sendStrengthCommand(calib.probe, calib.probe, { writer: "manual" });
      setCalibStatus(`Min≈${calib.min}. Max ab ${calib.probe}…`);
      return;
    }
    if (calib.phase !== "find_max") {
      setCalibStatus("Zuerst Kalib starten.");
      return;
    }
    calib.max = Math.max(calib.min + 10, calib.probe - 3);
    calib.phase = "done";
    const maxC = Math.min(calib.max, AppState.softLimitA || 150);
    saveStimConfig({
      strengthMin: calib.min,
      strengthMax: maxC,
      baseStrength: Math.round((calib.min + maxC) / 3),
      strengthDrive: true,
    });
    bindStimCfg();
    sendSoftStop({ keepStrength: false, writer: "safety" });
    releaseOutput("manual");
    setCalibStatus(`Gespeichert: ${calib.min}–${maxC}.`);
    log(`STIM-Kalib: min=${calib.min} max=${maxC}`, "success");
  });
});
