// pattern-editor.js - Visual pattern editor for custom waveforms
// Users can draw amplitude curves for channels A and B across 16 steps.

const PATTERN_EDITOR = {
  steps: 16,
  channelA: [],
  channelB: [],
  customName: "",
  customPatterns: {}, // stored custom patterns

  init() {
    // Initialize with flat 50% amplitude
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

  setStep(channel, index, value) {
    if (index < 0 || index >= this.steps) return;
    const v = Math.min(100, Math.max(0, Math.round(value)));
    if (channel === "A") this.channelA[index] = v;
    else if (channel === "B") this.channelB[index] = v;
    this.updateUI();
  },

  setAll(channel, value) {
    const v = Math.min(100, Math.max(0, Math.round(value)));
    for (let i = 0; i < this.steps; i++) {
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
    for (let i = 0; i < this.steps; i++) {
      this.channelA[i] = Math.round(Math.random() * 100);
      this.channelB[i] = Math.round(Math.random() * 100);
    }
    this.updateUI();
  },

  smooth() {
    const smoothArr = (arr) => {
      const out = [...arr];
      for (let i = 1; i < arr.length - 1; i++) {
        out[i] = Math.round((arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4);
      }
      return out;
    };
    this.channelA = smoothArr(this.channelA);
    this.channelB = smoothArr(this.channelB);
    this.updateUI();
  },

  saveCurrent() {
    const name = (this.customName || "").trim() || `custom_${Date.now()}`;
    this.customPatterns[name] = {
      steps: this.steps,
      channelA: [...this.channelA],
      channelB: [...this.channelB],
      createdAt: new Date().toISOString(),
    };
    this.saveCustomPatterns();
    log(`Pattern "${name}" gespeichert.`, "success");
    this.renderSavedList();
  },

  loadPattern(name) {
    const p = this.customPatterns[name];
    if (!p) {
      log(`Pattern "${name}" nicht gefunden.`, "error");
      return;
    }
    this.steps = p.steps || 16;
    this.channelA = [...p.channelA];
    this.channelB = [...p.channelB];
    this.customName = name;
    this.updateUI();
    log(`Pattern "${name}" geladen.`, "info");
  },

  deletePattern(name) {
    if (!this.customPatterns[name]) return;
    delete this.customPatterns[name];
    this.saveCustomPatterns();
    log(`Pattern "${name}" gelöscht.`, "info");
    this.renderSavedList();
  },

  playPattern() {
    if (!AppState.isConnected) {
      log("Nicht verbunden — Pattern kann nicht abgespielt werden.", "error");
      return;
    }
    AppState.aiCustomPatternA = [...this.channelA];
    AppState.aiCustomPatternB = [...this.channelB];
    AppState.aiCustomInterval = CONSTANTS.WAVE_LOOP_INTERVAL_MS || 100;
    AppState.activePattern = CONSTANTS.PATTERNS.AI_CUSTOM;
    document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));
    if (typeof ensureGameStrength === "function") ensureGameStrength(40);
    log("Custom Pattern wird abgespielt.", "success");
    if (typeof updateAIDashboard === "function") updateAIDashboard();
  },

  updateUI() {
    const grid = document.getElementById("pattern-editor-grid");
    if (!grid) return;

    // Build grid if first time
    if (grid.children.length === 0) {
      grid.innerHTML = "";
      // Header row
      const hdrNum = document.createElement("div");
      hdrNum.className = "pattern-editor-step-num";
      hdrNum.textContent = "#";
      const hdrA = document.createElement("div");
      hdrA.textContent = "Kanal A";
      hdrA.style.fontSize = "11px";
      const hdrB = document.createElement("div");
      hdrB.textContent = "Kanal B";
      hdrB.style.fontSize = "11px";
      grid.appendChild(hdrNum);
      grid.appendChild(hdrA);
      grid.appendChild(hdrB);

      for (let i = 0; i < this.steps; i++) {
        const num = document.createElement("div");
        num.className = "pattern-editor-step-num";
        num.textContent = i + 1;
        grid.appendChild(num);

        const cellA = this.makeSlider("A", i);
        const cellB = this.makeSlider("B", i);
        grid.appendChild(cellA);
        grid.appendChild(cellB);
      }
    }

    // Update slider values
    for (let i = 0; i < this.steps; i++) {
      const slA = document.getElementById(`pe-slider-A-${i}`);
      const lblA = document.getElementById(`pe-label-A-${i}`);
      const slB = document.getElementById(`pe-slider-B-${i}`);
      const lblB = document.getElementById(`pe-label-B-${i}`);
      if (slA) slA.value = this.channelA[i];
      if (lblA) lblA.textContent = this.channelA[i];
      if (slB) slB.value = this.channelB[i];
      if (lblB) lblB.textContent = this.channelB[i];
    }

    const nameInput = document.getElementById("pattern-editor-name");
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = this.customName;
    }
  },

  makeSlider(channel, index) {
    const cell = document.createElement("div");
    cell.className = "pattern-editor-cell";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.id = `pe-slider-${channel}-${index}`;
    slider.addEventListener("input", (e) => {
      PATTERN_EDITOR.setStep(channel, index, parseInt(e.target.value, 10));
    });
    const label = document.createElement("span");
    label.id = `pe-label-${channel}-${index}`;
    label.style.fontSize = "10px";
    label.style.minWidth = "24px";
    label.textContent = channel === "A" ? this.channelA[index] : this.channelB[index];
    cell.appendChild(slider);
    cell.appendChild(label);
    return cell;
  },

  renderSavedList() {
    const list = document.getElementById("pattern-editor-saved");
    if (!list) return;
    const names = Object.keys(this.customPatterns);
    if (names.length === 0) {
      list.innerHTML = "<p style='font-size:12px;opacity:0.6;'>Keine gespeicherten Patterns.</p>";
      return;
    }
    list.innerHTML = names
      .map(
        (name) => `
      <div class="stat-list-row">
        <span>${name}</span>
        <span>
          <button class="btn btn-secondary btn-sm pe-load-btn" data-name="${name}" style="padding:2px 8px;font-size:10px;">Laden</button>
          <button class="btn btn-danger btn-sm pe-del-btn" data-name="${name}" style="padding:2px 8px;font-size:10px;">Löschen</button>
        </span>
      </div>
    `
      )
      .join("");

    list.querySelectorAll(".pe-load-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.loadPattern(btn.dataset.name));
    });
    list.querySelectorAll(".pe-del-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.deletePattern(btn.dataset.name));
    });
  },
};

document.addEventListener("DOMContentLoaded", () => {
  PATTERN_EDITOR.init();

  document.getElementById("btn-pe-clear")?.addEventListener("click", () => PATTERN_EDITOR.clear());
  document
    .getElementById("btn-pe-random")
    ?.addEventListener("click", () => PATTERN_EDITOR.randomize());
  document
    .getElementById("btn-pe-smooth")
    ?.addEventListener("click", () => PATTERN_EDITOR.smooth());
  document.getElementById("btn-pe-save")?.addEventListener("click", () => {
    const nameInput = document.getElementById("pattern-editor-name");
    if (nameInput) PATTERN_EDITOR.customName = nameInput.value;
    PATTERN_EDITOR.saveCurrent();
  });
  document
    .getElementById("btn-pe-play")
    ?.addEventListener("click", () => PATTERN_EDITOR.playPattern());

  const nameInput = document.getElementById("pattern-editor-name");
  nameInput?.addEventListener("input", (e) => {
    PATTERN_EDITOR.customName = e.target.value;
  });

  // Render when settings tab is opened
  document.querySelector('.nav-item[data-tab="settings"]')?.addEventListener("click", () => {
    setTimeout(() => {
      PATTERN_EDITOR.updateUI();
      PATTERN_EDITOR.renderSavedList();
    }, 100);
  });

  PATTERN_EDITOR.updateUI();
  PATTERN_EDITOR.renderSavedList();
});

window.PATTERN_EDITOR = PATTERN_EDITOR;
