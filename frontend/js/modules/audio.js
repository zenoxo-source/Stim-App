// audio.js - STIM Audio extraction player for DG-LAB Coyote 3.0

function handleAudioFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const isAudioExt = ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extension);

  if (!file.type.match("audio.*") && !isAudioExt) {
    log(
      `Ungltiges Dateiformat (${file.type || "unbekannt"}). Bitte whle eine Audiodatei (MP3/WAV) aus.`,
      "error"
    );
    return;
  }

  log(`Lade STIM-Datei: ${file.name}...`, "info");
  if (DOM["audio-track-title"]) DOM["audio-track-title"].textContent = file.name;

  if (!AppState.audioCtx) {
    AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  AppState.audioElement.pause();
  if (AppState.audioElement.src) {
    URL.revokeObjectURL(AppState.audioElement.src);
  }

  AppState.audioElement.src = URL.createObjectURL(file);
  AppState.audioElement.load();

  AppState.audioElement.onloadedmetadata = () => {
    log("STIM-Datei erfolgreich geladen!", "success");
    if (DOM["audio-panel"]) {
      DOM["audio-panel"].style.opacity = "1";
      DOM["audio-panel"].style.pointerEvents = "all";
    }
    if (DOM["audio-time-duration"])
      DOM["audio-time-duration"].textContent = formatTime(AppState.audioElement.duration);
    if (DOM["audio-timeline-slider"])
      DOM["audio-timeline-slider"].max = Math.floor(AppState.audioElement.duration);

    AppState.isAudioPlaying = false;
    if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "\u25b6\ufe0f Play";
    if (DOM["audio-timeline-slider"]) DOM["audio-timeline-slider"].value = 0;
    if (DOM["audio-time-elapsed"]) DOM["audio-time-elapsed"].textContent = "00:00";
  };

  AppState.audioElement.onerror = () => {
    log("Fehler beim Laden der Audiodatei.", "error");
  };
}

function playSTIMAudio() {
  if (!AppState.audioCtx || !AppState.audioElement) return;

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
  if (AppState.audioGainNode)
    AppState.audioGainNode.gain.value = AppState.audioHearSound
      ? CONSTANTS.DEFAULT_AUDIO_GAIN
      : 0.0;

  AppState.audioElement.play();
  AppState.isAudioPlaying = true;
  if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "\u23f8\ufe0f Pause";

  log("STIM Wiedergabe gestartet.", "info");

  if (AppState.audioTimer) clearInterval(AppState.audioTimer);
  AppState.audioTimer = setInterval(updateSTIMTimeline, 250);

  drawVisualizerLoop();
}

function pauseSTIMAudio() {
  if (!AppState.isAudioPlaying || !AppState.audioElement) return;

  AppState.isAudioPlaying = false;
  AppState.audioElement.pause();
  if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "\u25b6\ufe0f Play";
  clearInterval(AppState.audioTimer);

  sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  log("STIM Wiedergabe pausiert.", "info");
}

function updateSTIMTimeline() {
  if (!AppState.isAudioPlaying || !AppState.audioElement) return;

  const elapsed = AppState.audioElement.currentTime;
  if (AppState.audioElement.ended) {
    AppState.isAudioPlaying = false;
    if (DOM["btn-play-audio"]) DOM["btn-play-audio"].textContent = "\u25b6\ufe0f Play";
    if (DOM["audio-timeline-slider"]) DOM["audio-timeline-slider"].value = 0;
    if (DOM["audio-time-elapsed"]) DOM["audio-time-elapsed"].textContent = "00:00";
    clearInterval(AppState.audioTimer);
    sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
    log("STIM Wiedergabe beendet.", "info");
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

    if (e.dataTransfer.files.length > 0) {
      handleAudioFile(e.dataTransfer.files[0]);
    }
  });

  DOM["input-stim-file"]?.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleAudioFile(e.target.files[0]);
    }
  });

  DOM["btn-play-audio"]?.addEventListener("click", () => {
    if (!AppState.audioElement || !AppState.audioElement.src) return;

    if (AppState.isAudioPlaying) {
      pauseSTIMAudio();
    } else {
      playSTIMAudio();
    }
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
    if (AppState.audioGainNode)
      AppState.audioGainNode.gain.value = AppState.audioHearSound
        ? CONSTANTS.DEFAULT_AUDIO_GAIN
        : 0.0;
  });

  DOM["check-settings-audio"]?.addEventListener("change", (e) => {
    AppState.audioHearSound = e.target.checked;
    if (DOM["check-hear-audio"]) DOM["check-hear-audio"].checked = AppState.audioHearSound;
    if (AppState.audioGainNode)
      AppState.audioGainNode.gain.value = AppState.audioHearSound
        ? CONSTANTS.DEFAULT_AUDIO_GAIN
        : 0.0;
  });

  DOM["slider-sens-a"]?.addEventListener("input", (e) => {
    AppState.sensitivityA = parseFloat(e.target.value);
  });

  DOM["slider-sens-b"]?.addEventListener("input", (e) => {
    AppState.sensitivityB = parseFloat(e.target.value);
  });
});
