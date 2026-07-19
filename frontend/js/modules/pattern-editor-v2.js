// pattern-editor-v2.js - Enhanced standalone Pattern Editor with oscilloscope
// Features: waveform presets, channel operations, live preview, export, phase shift, fade, variable steps

import { AppState, CONSTANTS, log } from "../state.js";
import { sendSoftStop } from "./bluetooth.js";
import { updateAIDashboard } from "../control-deck.js";
import { ensureGameStrength } from "./games-extra.js";

export const PATTERN_EDITOR2 = {
  steps: 16,
  channelA: [],
  channelB: [],
  customName: "",
  customPatterns: {},
  editorVisRunning: false,
  editorVisAnimId: null,
  liveStep: 0,
  liveInterval: null,

  init() {
    this.channelA = new Array(this.steps).fill(50);
    this.channelB = new Array(this.steps).fill(50);
    this.loadCustomPatterns();
  },

  loadCustomPatterns() {
    try {
      const raw = localStorage.getItem("stim_custom_patterns");
      if (raw) this.customPatterns = JSON.parse(raw);
    } catch {
      this.customPatterns = {};
    }
  },

  saveCustomPatterns() {
    try {
      localStorage.setItem("stim_custom_patterns", JSON.stringify(this.customPatterns));
    } catch {
      // ignore
    }
  },

  setStepCount(newSteps) {
    newSteps = Math.min(32, Math.max(4, parseInt(newSteps, 10) || 16));
    if (newSteps === this.steps) return;
    var oldA = this.channelA;
    var oldB = this.channelB;
    this.steps = newSteps;
    this.channelA = new Array(newSteps).fill(0);
    this.channelB = new Array(newSteps).fill(0);
    for (var i = 0; i < Math.min(newSteps, oldA.length); i++) {
      this.channelA[i] = oldA[i];
      this.channelB[i] = oldB[i];
    }
    this.rebuildGrid();
    this.updateUI();
  },

  phaseShift(direction) {
    var a = [...this.channelA];
    var b = [...this.channelB];
    if (direction === "left") {
      for (var i = 0; i < this.steps - 1; i++) {
        this.channelA[i] = a[i + 1];
        this.channelB[i] = b[i + 1];
      }
      this.channelA[this.steps - 1] = a[0];
      this.channelB[this.steps - 1] = b[0];
    } else {
      this.channelA[0] = a[this.steps - 1];
      this.channelB[0] = b[this.steps - 1];
      for (var j = 1; j < this.steps; j++) {
        this.channelA[j] = a[j - 1];
        this.channelB[j] = b[j - 1];
      }
    }
    this.updateUI();
  },

  fadeIn() {
    for (var i = 0; i < this.steps; i++) {
      var f = i / (this.steps - 1);
      this.channelA[i] = Math.round(this.channelA[i] * f);
      this.channelB[i] = Math.round(this.channelB[i] * f);
    }
    this.updateUI();
  },

  fadeOut() {
    for (var i = 0; i < this.steps; i++) {
      var f = 1 - i / (this.steps - 1);
      this.channelA[i] = Math.round(this.channelA[i] * f);
      this.channelB[i] = Math.round(this.channelB[i] * f);
    }
    this.updateUI();
  },

  scale(factor) {
    factor = Math.max(0, Math.min(2, parseFloat(factor) || 1));
    for (var i = 0; i < this.steps; i++) {
      this.channelA[i] = Math.min(100, Math.round(this.channelA[i] * factor));
      this.channelB[i] = Math.min(100, Math.round(this.channelB[i] * factor));
    }
    this.updateUI();
  },

  duplicatePattern(name) {
    if (!this.customPatterns[name]) {
      log('Pattern "' + name + '" nicht gefunden.', "error");
      return;
    }
    var newName = name + "_copy";
    var n = 1;
    while (this.customPatterns[newName]) {
      n++;
      newName = name + "_copy" + n;
    }
    this.customPatterns[newName] = {
      steps: this.customPatterns[name].steps,
      channelA: [...this.customPatterns[name].channelA],
      channelB: [...this.customPatterns[name].channelB],
      createdAt: new Date().toISOString(),
    };
    this.saveCustomPatterns();
    log('Pattern "' + name + '" dupliziert als "' + newName + '".', "success");
    this.renderSavedList();
  },

  importPatterns(file) {
    var self = this;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        var count = 0;
        Object.keys(data).forEach(function (key) {
          if (data[key] && Array.isArray(data[key].channelA)) {
            self.customPatterns[key] = data[key];
            count++;
          }
        });
        self.saveCustomPatterns();
        log(count + " Pattern(s) importiert.", "success");
        self.renderSavedList();
      } catch (err) {
        log("Import fehlgeschlagen: " + err.message, "error");
      }
    };
    reader.readAsText(file);
  },

  setStep(channel, index, value) {
    if (index < 0 || index >= this.steps) return;
    var v = Math.min(100, Math.max(0, Math.round(value)));
    if (channel === "A") this.channelA[index] = v;
    else if (channel === "B") this.channelB[index] = v;
    this.updateUI();
  },

  setAll(channel, value) {
    var v = Math.min(100, Math.max(0, Math.round(value)));
    for (var i = 0; i < this.steps; i++) {
      if (channel === "A") this.channelA[i] = v;
      else if (channel === "B") this.channelB[i] = v;
    }
    this.updateUI();
  },

  clear() {
    this.channelA = new Array(this.steps).fill(0);
    this.channelB = new Array(this.steps).fill(0);
    this.updateUI();
  },

  randomize() {
    for (var i = 0; i < this.steps; i++) {
      this.channelA[i] = Math.round(Math.random() * 100);
      this.channelB[i] = Math.round(Math.random() * 100);
    }
    this.updateUI();
  },

  smooth() {
    var smoothArr = function (arr) {
      var out = [...arr];
      for (var i = 1; i < arr.length - 1; i++) {
        out[i] = Math.round((arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4);
      }
      return out;
    };
    this.channelA = smoothArr(this.channelA);
    this.channelB = smoothArr(this.channelB);
    this.updateUI();
  },

  // Waveform presets
  presetSine() {
    for (var i = 0; i < this.steps; i++) {
      var v = Math.round(50 + 50 * Math.sin((i / this.steps) * Math.PI * 2));
      this.channelA[i] = v;
      this.channelB[i] = v;
    }
    this.updateUI();
  },

  presetSaw() {
    for (var i = 0; i < this.steps; i++) {
      var v = Math.round((i / (this.steps - 1)) * 100);
      this.channelA[i] = v;
      this.channelB[i] = v;
    }
    this.updateUI();
  },

  presetSquare() {
    var half = Math.floor(this.steps / 2);
    for (var i = 0; i < this.steps; i++) {
      var v = i < half ? 100 : 0;
      this.channelA[i] = v;
      this.channelB[i] = v;
    }
    this.updateUI();
  },

  presetRamp() {
    for (var i = 0; i < this.steps; i++) {
      var v = 100 - Math.round((i / (this.steps - 1)) * 100);
      this.channelA[i] = v;
      this.channelB[i] = v;
    }
    this.updateUI();
  },

  presetTriangle() {
    var mid = this.steps / 2;
    for (var i = 0; i < this.steps; i++) {
      var v = Math.round(i < mid ? (i / mid) * 100 : (2 - i / mid) * 100);
      this.channelA[i] = v;
      this.channelB[i] = v;
    }
    this.updateUI();
  },

  // Channel operations
  copyAToB() {
    this.channelB = [...this.channelA];
    this.updateUI();
  },

  copyBToA() {
    this.channelA = [...this.channelB];
    this.updateUI();
  },

  mirror() {
    this.channelA = [...this.channelA].reverse();
    this.channelB = [...this.channelB].reverse();
    this.updateUI();
  },

  invert() {
    for (var i = 0; i < this.steps; i++) {
      this.channelA[i] = 100 - this.channelA[i];
      this.channelB[i] = 100 - this.channelB[i];
    }
    this.updateUI();
  },

  saveCurrent() {
    var name = (this.customName || "").trim() || "custom_" + Date.now();
    this.customPatterns[name] = {
      steps: this.steps,
      channelA: [...this.channelA],
      channelB: [...this.channelB],
      createdAt: new Date().toISOString(),
    };
    this.saveCustomPatterns();
    log('Pattern "' + name + '" gespeichert.', "success");
    this.renderSavedList();
  },

  loadPattern(name) {
    var p = this.customPatterns[name];
    if (!p) {
      log('Pattern "' + name + '" nicht gefunden.', "error");
      return;
    }
    this.steps = p.steps || 16;
    this.channelA = [...p.channelA];
    this.channelB = [...p.channelB];
    this.customName = name;
    this.rebuildGrid();
    this.updateUI();
    log('Pattern "' + name + '" geladen.', "info");
  },

  deletePattern(name) {
    if (!this.customPatterns[name]) return;
    delete this.customPatterns[name];
    this.saveCustomPatterns();
    log('Pattern "' + name + '" gel\u00f6scht.', "info");
    this.renderSavedList();
  },

  playPattern() {
    if (!AppState.isConnected) {
      log("Nicht verbunden \u2014 Pattern kann nicht abgespielt werden.", "error");
      return;
    }
    AppState.aiCustomPatternA = [...this.channelA];
    AppState.aiCustomPatternB = [...this.channelB];
    AppState.aiCustomInterval = CONSTANTS.WAVE_LOOP_INTERVAL_MS || 100;
    AppState.activePattern = CONSTANTS.PATTERNS.AI_CUSTOM;
    document.querySelectorAll(".pattern-card").forEach(function (c) {
      c.classList.remove("active");
    });
    ensureGameStrength(40);
    log("Custom Pattern wird abgespielt.", "success");
    updateAIDashboard();
    this.startLivePreview();
  },

  stopPattern() {
    AppState.activePattern = null;
    updateAIDashboard();
    sendSoftStop({ keepStrength: true });
    this.stopLivePreview();
    log("Pattern gestoppt.", "info");
  },

  startLivePreview() {
    this.liveStep = 0;
    var info = document.getElementById("editor-live-info");
    if (info) info.style.display = "block";
    var stepEl = document.getElementById("editor-live-step");
    this.stopLivePreview();
    var self = this;
    this.liveInterval = setInterval(function () {
      self.liveStep = (self.liveStep + 1) % self.steps;
      if (stepEl) stepEl.textContent = "Schritt " + (self.liveStep + 1) + "/" + self.steps;
    }, CONSTANTS.WAVE_LOOP_INTERVAL_MS || 100);
  },

  stopLivePreview() {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
    var info = document.getElementById("editor-live-info");
    if (info) info.style.display = "none";
  },

  exportAllPatterns() {
    var json = JSON.stringify(this.customPatterns, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "coyote-patterns-" + Date.now() + ".json";
    a.click();
    URL.revokeObjectURL(url);
    log("Alle Patterns exportiert.", "success");
  },

  rebuildGrid() {
    var grid = document.getElementById("editor-grid");
    if (!grid) return;
    grid.innerHTML = "";

    var hdrNum = document.createElement("div");
    hdrNum.className = "pattern-editor-step-num";
    hdrNum.textContent = "#";
    var hdrA = document.createElement("div");
    hdrA.textContent = "Kanal A";
    hdrA.style.fontSize = "11px";
    var hdrB = document.createElement("div");
    hdrB.textContent = "Kanal B";
    hdrB.style.fontSize = "11px";
    grid.appendChild(hdrNum);
    grid.appendChild(hdrA);
    grid.appendChild(hdrB);

    for (var i = 0; i < this.steps; i++) {
      var num = document.createElement("div");
      num.className = "pattern-editor-step-num";
      num.textContent = i + 1;
      grid.appendChild(num);
      grid.appendChild(this.makeSlider("A", i));
      grid.appendChild(this.makeSlider("B", i));
    }

    var stepSel = document.getElementById("editor-step-count");
    if (stepSel) stepSel.value = String(this.steps);
  },

  updateUI() {
    var grid = document.getElementById("editor-grid");
    if (!grid) return;

    if (grid.children.length === 0 || grid.children.length !== 3 + this.steps * 3) {
      this.rebuildGrid();
    }

    for (var j = 0; j < this.steps; j++) {
      var slA = document.getElementById("editor-slider-A-" + j);
      var lblA = document.getElementById("editor-label-A-" + j);
      var barA = document.getElementById("editor-bar-A-" + j);
      var slB = document.getElementById("editor-slider-B-" + j);
      var lblB = document.getElementById("editor-label-B-" + j);
      var barB = document.getElementById("editor-bar-B-" + j);
      if (slA) slA.value = this.channelA[j];
      if (lblA) lblA.textContent = this.channelA[j];
      if (barA) barA.style.height = (this.channelA[j] / 100) * 100 + "%";
      if (slB) slB.value = this.channelB[j];
      if (lblB) lblB.textContent = this.channelB[j];
      if (barB) barB.style.height = (this.channelB[j] / 100) * 100 + "%";
    }

    var nameInput = document.getElementById("editor-name");
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = this.customName;
    }
  },

  makeSlider(channel, index) {
    var cell = document.createElement("div");
    cell.className = "pattern-editor-cell";
    cell.style.position = "relative";
    cell.style.overflow = "hidden";

    var bar = document.createElement("div");
    bar.className = "pattern-editor-bar";
    bar.id = "editor-bar-" + channel + "-" + index;
    bar.style.cssText =
      "position:absolute;bottom:0;left:0;right:0;height:" +
      (channel === "A" ? this.channelA[index] : this.channelB[index]) +
      "%;background:" +
      (channel === "A" ? "rgba(0,120,212,0.15)" : "rgba(134,96,169,0.15)") +
      ";z-index:0;pointer-events:none;border-radius:2px;";

    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.id = "editor-slider-" + channel + "-" + index;
    slider.style.cssText = "position:relative;z-index:1;";
    var self = this;
    slider.addEventListener("input", function (e) {
      self.setStep(channel, index, parseInt(e.target.value, 10));
    });

    var label = document.createElement("span");
    label.id = "editor-label-" + channel + "-" + index;
    label.style.cssText = "font-size:10px;min-width:24px;position:relative;z-index:1;";
    label.textContent = channel === "A" ? this.channelA[index] : this.channelB[index];

    cell.appendChild(bar);
    cell.appendChild(slider);
    cell.appendChild(label);
    return cell;
  },

  renderSavedList() {
    var list = document.getElementById("editor-saved");
    if (!list) return;
    var names = Object.keys(this.customPatterns);
    if (names.length === 0) {
      list.innerHTML = '<p style="font-size:12px;opacity:0.6;">Keine gespeicherten Patterns.</p>';
      return;
    }
    var self = this;
    list.innerHTML = names
      .map(function (name) {
        var p = self.customPatterns[name];
        var steps = (p && p.steps) || "?";
        return (
          '<div class="stat-list-row"><span>' +
          name +
          ' <span style="font-size:10px;opacity:0.5;">(' +
          steps +
          " Schritte)</span></span><span>" +
          '<button class="btn btn-secondary btn-sm pe2-load-btn" data-name="' +
          name +
          '" style="padding:2px 8px;font-size:10px;">Laden</button> ' +
          '<button class="btn btn-secondary btn-sm pe2-dup-btn" data-name="' +
          name +
          '" style="padding:2px 8px;font-size:10px;">Dupl.</button> ' +
          '<button class="btn btn-danger btn-sm pe2-del-btn" data-name="' +
          name +
          '" style="padding:2px 8px;font-size:10px;">L\u00f6schen</button></span></div>'
        );
      })
      .join("");

    list.querySelectorAll(".pe2-load-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.loadPattern(this.dataset.name);
      });
    });
    list.querySelectorAll(".pe2-dup-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.duplicatePattern(this.dataset.name);
      });
    });
    list.querySelectorAll(".pe2-del-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.deletePattern(this.dataset.name);
      });
    });
  },
};

// Editor oscilloscope renderer
export function startEditorVisualizers() {
  if (PATTERN_EDITOR2.editorVisRunning) return;
  PATTERN_EDITOR2.editorVisRunning = true;

  function drawEditorWave(canvas, color, channelData, highlightStep) {
    if (!canvas) return;
    if (canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;
    if (canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight;

    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;

    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, width, height);

    if (!channelData.length) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    for (var gy = 0; gy < height; gy += height / 4) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    // Draw waveform
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    var stepW = width / (channelData.length - 1);
    for (var x = 0; x < channelData.length; x++) {
      var px = x * stepW;
      var py = height - (channelData[x] / 100) * height;
      if (x === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Highlight current step
    if (highlightStep >= 0 && highlightStep < channelData.length) {
      var hx = highlightStep * stepW;
      ctx.fillStyle = color.replace(")", ",0.3)").replace("rgb", "rgba");
      ctx.fillRect(hx - stepW / 2, 0, stepW, height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - stepW / 2, 0, stepW, height);
    }

    // Dot markers
    ctx.fillStyle = color;
    for (var d = 0; d < channelData.length; d++) {
      var dpx = d * stepW;
      var dpy = height - (channelData[d] / 100) * height;
      ctx.beginPath();
      ctx.arc(dpx, dpy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function editorVisLoop() {
    if (!PATTERN_EDITOR2.editorVisRunning) return;
    PATTERN_EDITOR2.editorVisAnimId = requestAnimationFrame(editorVisLoop);

    var isPlaying = !!(
      AppState.activePattern === CONSTANTS.PATTERNS.AI_CUSTOM && PATTERN_EDITOR2.liveInterval
    );
    var highlightA = isPlaying ? PATTERN_EDITOR2.liveStep % PATTERN_EDITOR2.steps : -1;
    var highlightB = isPlaying ? PATTERN_EDITOR2.liveStep % PATTERN_EDITOR2.steps : -1;

    drawEditorWave(
      document.getElementById("editor-visualizer-a"),
      "#5ab3ff",
      PATTERN_EDITOR2.channelA,
      highlightA
    );
    drawEditorWave(
      document.getElementById("editor-visualizer-b"),
      "#d7b4f3",
      PATTERN_EDITOR2.channelB,
      highlightB
    );
  }
  editorVisLoop();
}

export function stopEditorVisualizers() {
  PATTERN_EDITOR2.editorVisRunning = false;
  if (PATTERN_EDITOR2.editorVisAnimId) {
    cancelAnimationFrame(PATTERN_EDITOR2.editorVisAnimId);
    PATTERN_EDITOR2.editorVisAnimId = null;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  PATTERN_EDITOR2.init();

  document.getElementById("btn-editor-clear")?.addEventListener("click", function () {
    PATTERN_EDITOR2.clear();
  });
  document.getElementById("btn-editor-random")?.addEventListener("click", function () {
    PATTERN_EDITOR2.randomize();
  });
  document.getElementById("btn-editor-smooth")?.addEventListener("click", function () {
    PATTERN_EDITOR2.smooth();
  });
  document.getElementById("btn-editor-save")?.addEventListener("click", function () {
    var nameInput = document.getElementById("editor-name");
    if (nameInput) PATTERN_EDITOR2.customName = nameInput.value;
    PATTERN_EDITOR2.saveCurrent();
  });
  document.getElementById("btn-editor-play")?.addEventListener("click", function () {
    PATTERN_EDITOR2.playPattern();
  });
  document.getElementById("btn-editor-stop")?.addEventListener("click", function () {
    PATTERN_EDITOR2.stopPattern();
  });

  // Presets
  document.getElementById("btn-editor-preset-sine")?.addEventListener("click", function () {
    PATTERN_EDITOR2.presetSine();
  });
  document.getElementById("btn-editor-preset-saw")?.addEventListener("click", function () {
    PATTERN_EDITOR2.presetSaw();
  });
  document.getElementById("btn-editor-preset-square")?.addEventListener("click", function () {
    PATTERN_EDITOR2.presetSquare();
  });
  document.getElementById("btn-editor-preset-ramp")?.addEventListener("click", function () {
    PATTERN_EDITOR2.presetRamp();
  });
  document.getElementById("btn-editor-preset-triangle")?.addEventListener("click", function () {
    PATTERN_EDITOR2.presetTriangle();
  });

  // Channel ops
  document.getElementById("btn-editor-copy-ab")?.addEventListener("click", function () {
    PATTERN_EDITOR2.copyAToB();
  });
  document.getElementById("btn-editor-copy-ba")?.addEventListener("click", function () {
    PATTERN_EDITOR2.copyBToA();
  });
  document.getElementById("btn-editor-mirror")?.addEventListener("click", function () {
    PATTERN_EDITOR2.mirror();
  });
  document.getElementById("btn-editor-invert")?.addEventListener("click", function () {
    PATTERN_EDITOR2.invert();
  });

  // Phase shift
  document.getElementById("btn-editor-shift-left")?.addEventListener("click", function () {
    PATTERN_EDITOR2.phaseShift("left");
  });
  document.getElementById("btn-editor-shift-right")?.addEventListener("click", function () {
    PATTERN_EDITOR2.phaseShift("right");
  });

  // Fade
  document.getElementById("btn-editor-fade-in")?.addEventListener("click", function () {
    PATTERN_EDITOR2.fadeIn();
  });
  document.getElementById("btn-editor-fade-out")?.addEventListener("click", function () {
    PATTERN_EDITOR2.fadeOut();
  });

  // Step count
  document.getElementById("editor-step-count")?.addEventListener("change", function (e) {
    PATTERN_EDITOR2.setStepCount(parseInt(e.target.value, 10));
  });

  // Export / Import
  document.getElementById("btn-editor-export-all")?.addEventListener("click", function () {
    PATTERN_EDITOR2.exportAllPatterns();
  });
  document.getElementById("btn-editor-import")?.addEventListener("click", function () {
    document.getElementById("input-editor-import")?.click();
  });
  document.getElementById("input-editor-import")?.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) {
      PATTERN_EDITOR2.importPatterns(e.target.files[0]);
      e.target.value = "";
    }
  });

  // Name input
  var nameInput = document.getElementById("editor-name");
  nameInput?.addEventListener("input", function (e) {
    PATTERN_EDITOR2.customName = e.target.value;
  });

  PATTERN_EDITOR2.updateUI();
  PATTERN_EDITOR2.renderSavedList();
});
