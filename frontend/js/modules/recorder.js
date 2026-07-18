// recorder.js - Session recording & replay
// Records waveform output data and saves/loads as JSON.

const RECORDER = {
  recording: false,
  replaying: false,
  frames: [],
  startTime: 0,
  replayIndex: 0,
  replayTimer: null,

  // Called by wave loop each tick to capture current state
  captureTick(fA, aA, fB, aB) {
    if (!this.recording) return;
    this.frames.push({
      t: Date.now() - this.startTime,
      fA: Math.round(fA),
      aA: Math.round(aA),
      fB: Math.round(fB),
      aB: Math.round(aB),
      strA: AppState.strengthA,
      strB: AppState.strengthB,
    });
  },

  start() {
    this.recording = true;
    this.replaying = false;
    this.frames = [];
    this.startTime = Date.now();
    log("Aufnahme gestartet.", "info");
    this.updateUI();
  },

  stop() {
    if (!this.recording) return;
    this.recording = false;
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    log(`Aufnahme gestoppt. ${this.frames.length} Frames, ${duration}s.`, "success");
    this.updateUI();
  },

  save() {
    if (this.frames.length === 0) {
      log("Keine Aufnahme zum Speichern.", "warning");
      return;
    }
    const data = {
      format: "stim-app-recording",
      version: 1,
      duration: this.frames.length > 0 ? this.frames[this.frames.length - 1].t : 0,
      frames: this.frames,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stim-recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log(`Aufnahme gespeichert (${this.frames.length} Frames).`, "success");
  },

  async load(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.format !== "stim-app-recording" || !Array.isArray(data.frames)) {
        throw new Error("Ungültiges Aufnahme-Format");
      }
      this.frames = data.frames;
      this.replaying = false;
      this.recording = false;
      log(`Aufnahme geladen: ${this.frames.length} Frames.`, "success");
      this.updateUI();
    } catch (err) {
      log(`Aufnahme laden fehlgeschlagen: ${err.message}`, "error");
    }
  },

  replay() {
    if (this.frames.length === 0) {
      log("Keine Aufnahme zum Abspielen.", "warning");
      return;
    }
    if (!AppState.isConnected) {
      log("Nicht verbunden — Replay nicht möglich.", "error");
      return;
    }

    this.replaying = true;
    this.replayIndex = 0;
    const self = this;
    log(`Replay gestartet (${this.frames.length} Frames).`, "info");

    function nextFrame() {
      if (!self.replaying || self.replayIndex >= self.frames.length) {
        self.replaying = false;
        self.replayTimer = null;
        log("Replay beendet.", "info");
        self.updateUI();
        return;
      }

      const frame = self.frames[self.replayIndex];
      self.replayIndex++;

      // Apply recorded strength
      AppState.strengthA = frame.strA;
      AppState.strengthB = frame.strB;
      if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = frame.strA;
      if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = frame.strB;

      // Send recorded waveform
      sendWaveformCommand(frame.fA, frame.aA, frame.fB, frame.aB);

      // Schedule next frame based on recorded timestamp
      const nextT = self.replayIndex < self.frames.length ? self.frames[self.replayIndex].t : null;
      const delay = nextT !== null ? Math.max(10, nextT - frame.t) : 100;
      self.replayTimer = setTimeout(nextFrame, delay);
    }

    nextFrame();
    this.updateUI();
  },

  stopReplay() {
    this.replaying = false;
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
    if (typeof sendSoftStop === "function") sendSoftStop({ keepStrength: true });
    log("Replay gestoppt.", "info");
    this.updateUI();
  },

  updateUI() {
    const elRec = document.getElementById("recorder-status");
    const btnRec = document.getElementById("btn-recorder-toggle");
    const btnPlay = document.getElementById("btn-recorder-play");
    const btnStop = document.getElementById("btn-recorder-stop");
    const btnSave = document.getElementById("btn-recorder-save");
    const info = document.getElementById("recorder-info");

    if (elRec) {
      elRec.textContent = this.recording
        ? `Aufnahme läuft… ${this.frames.length} Frames`
        : this.replaying
          ? `Replay läuft… ${this.replayIndex}/${this.frames.length}`
          : "Bereit";
      elRec.className = this.recording
        ? "remote-status running"
        : this.replaying
          ? "remote-status running"
          : "remote-status";
    }
    if (btnRec) btnRec.textContent = this.recording ? "Aufnahme stoppen" : "Aufnahme starten";
    if (btnPlay) btnPlay.disabled = this.recording || this.replaying || this.frames.length === 0;
    if (btnStop) btnStop.disabled = !this.replaying;
    if (btnSave) btnSave.disabled = this.frames.length === 0;
    if (info) {
      info.textContent =
        this.frames.length > 0
          ? `${this.frames.length} Frames · ${((this.frames[this.frames.length - 1]?.t || 0) / 1000).toFixed(1)}s`
          : "Keine Aufnahme";
    }
  },
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-recorder-toggle")?.addEventListener("click", () => {
    if (RECORDER.recording) RECORDER.stop();
    else RECORDER.start();
  });

  document.getElementById("btn-recorder-play")?.addEventListener("click", () => {
    RECORDER.replay();
  });

  document.getElementById("btn-recorder-stop")?.addEventListener("click", () => {
    RECORDER.stopReplay();
  });

  document.getElementById("btn-recorder-save")?.addEventListener("click", () => {
    RECORDER.save();
  });

  document.getElementById("btn-recorder-load")?.addEventListener("click", () => {
    document.getElementById("input-recorder-load")?.click();
  });

  document.getElementById("input-recorder-load")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) RECORDER.load(file);
    e.target.value = "";
  });

  RECORDER.updateUI();
});

window.RECORDER = RECORDER;
