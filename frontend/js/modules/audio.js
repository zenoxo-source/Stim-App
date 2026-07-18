// audio.js - STIM Audio extraction player with playlist

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
  el.innerHTML = list
    .map((t, i) => {
      const active = i === AppState.playlistIndex ? "active" : "";
      const safe = ProtocolUtils?.escapeHtml
        ? ProtocolUtils.escapeHtml(t.name)
        : t.name.replace(/</g, "&lt;");
      return `<div class="stim-playlist-item ${active}" data-index="${i}">
        <span class="pl-name">${i + 1}. ${safe}</span>
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
    // Auto-advance playlist
    if (AppState.playlist && AppState.playlistIndex < AppState.playlist.length - 1) {
      loadPlaylistIndex(AppState.playlistIndex + 1, true);
    } else {
      AppState.isAudioPlaying = false;
      if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "▶️ Play";
      if (typeof sendSoftStop === "function") sendSoftStop({ keepStrength: true });
      else sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
      log("STIM Wiedergabe beendet.", "info");
      if (typeof updateOutputStatus === "function") updateOutputStatus();
    }
  };
}

function applyAudioMasterLink() {
  if (!AppState.audioGainNode) return;
  const hear = AppState.audioHearSound;
  const link = document.getElementById("check-audio-master-link")?.checked ?? true;
  const base = CONSTANTS.DEFAULT_AUDIO_GAIN;
  const scale = link ? AppState.masterScale || 0 : 1;
  AppState.audioGainNode.gain.value = hear ? base * scale : 0;
}

window.applyAudioMasterLink = applyAudioMasterLink;

function playSTIMAudio() {
  if (!AppState.audioCtx || !AppState.audioElement?.src) return;

  if (AppState.audioCtx.state === "suspended") {
    AppState.audioCtx.resume();
  }

  if (!AppState.mediaElementSource) {
    AppState.mediaElementSource = AppState.audioCtx.createMediaElementSource(AppState.audioElement);

    AppState.analyserA = AppState.audioCtx.createAnalyser();
    AppState.analyserB = AppState.audioCtx.createAnalyser();

    AppState.analyserA.fftSize = CONSTANTS.ANALYZER_FFT_SIZE;
    AppState.analyserB.fftSize = CONSTANTS.ANALYZER_FFT_SIZE;

    AppState.audioSplitterNode = AppState.audioCtx.createChannelSplitter(2);
    AppState.mediaElementSource.connect(AppState.audioSplitterNode);
    AppState.audioSplitterNode.connect(AppState.analyserA, 0);
    AppState.audioSplitterNode.connect(AppState.analyserB, 1);

    AppState.audioGainNode = AppState.audioCtx.createGain();
    AppState.mediaElementSource.connect(AppState.audioGainNode);
    AppState.audioGainNode.connect(AppState.audioCtx.destination);
  }

  AppState.audioHearSound = DOM["check-hear-audio"]?.checked ?? true;
  if (DOM["check-settings-audio"]) DOM["check-settings-audio"].checked = AppState.audioHearSound;
  applyAudioMasterLink();

  // V3: wave amps alone are not enough – need channel strength
  if (typeof ensureGameStrength === "function") ensureGameStrength(40);

  AppState.audioElement.play();
  AppState.isAudioPlaying = true;
  if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "⏸️ Pause";

  log("STIM Wiedergabe gestartet.", "info");

  if (AppState.audioTimer) clearInterval(AppState.audioTimer);
  AppState.audioTimer = setInterval(updateSTIMTimeline, 250);

  drawVisualizerLoop();
  if (typeof updateOutputStatus === "function") updateOutputStatus();
}

function pauseSTIMAudio() {
  if (!AppState.audioElement) return;

  AppState.isAudioPlaying = false;
  AppState.audioElement.pause();
  if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "▶️ Play";
  clearInterval(AppState.audioTimer);

  if (typeof sendSoftStop === "function") sendSoftStop({ keepStrength: true });
  else sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  log("STIM Wiedergabe pausiert.", "info");
  if (typeof updateOutputStatus === "function") updateOutputStatus();
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

// eslint-disable-next-line no-unused-vars
function initCanvasVisualizers() {
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
  });

  DOM["slider-sens-b"]?.addEventListener("input", (e) => {
    AppState.sensitivityB = parseFloat(e.target.value);
  });
});
