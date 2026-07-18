// control-deck.js - Core state, UI, and wave loop for DG-LAB Coyote 3.0

// ==========================================
// TAB NAVIGATION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
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

      const headerTitle = DOM["view-title"];
      const headerSub = DOM["view-subtitle"];

      const titles = {
        deck: ["Control Deck", "Stim App · DG-LAB Coyote 3.0"],
        stim: ["STIM Player", "Audio · Playlist · Amplituden → A/B"],
        games: ["Mini-Spiele", "Interaktives Feedback-Training"],
        ai: ["AI Steuerungs-Assistent", "Tool-Calls & Streaming"],
        settings: ["Einstellungen", "Sicherheit, Updates & Diagnose"],
      };

      if (titles[tabName]) {
        if (headerTitle) headerTitle.textContent = titles[tabName][0];
        if (headerSub) headerSub.textContent = titles[tabName][1];
        if (tabName === "stim") initCanvasVisualizers();
      }
    });
  });

  // ==========================================
  // WAVE LOOP - Central playback engine
  // ==========================================

  window.startWaveLoop = function () {
    if (AppState.waveLoopInterval) clearInterval(AppState.waveLoopInterval);

    if (!AppState.aiVisRunning) {
      AppState.aiVisRunning = true;
      renderAIVisualizer();
    }

    AppState.waveLoopInterval = setInterval(async () => {
      if (!AppState.isConnected) return;
      AppState.loopTimeCounter += 1;

      if (AppState.activePattern === "session") {
        const tick = SESSION_STATE.computeTick();
        if (tick) {
          AppState.lastWaveFreqA = tick.fA;
          AppState.lastWaveAmpA = tick.aA;
          AppState.lastWaveFreqB = tick.fB;
          AppState.lastWaveAmpB = tick.aB;
          await sendWaveformCommand(tick.fA, tick.aA, tick.fB, tick.aB);
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

        AppState.lastWaveFreqA = fA;
        AppState.lastWaveAmpA = aA;
        AppState.lastWaveFreqB = fB;
        AppState.lastWaveAmpB = aB;

        await sendWaveformCommand(fA, aA, fB, aB);
      } else if (AppState.isAudioPlaying && AppState.analyserA && AppState.analyserB) {
        const arrayA = new Uint8Array(AppState.analyserA.fftSize);
        const arrayB = new Uint8Array(AppState.analyserB.fftSize);

        AppState.analyserA.getByteTimeDomainData(arrayA);
        AppState.analyserB.getByteTimeDomainData(arrayB);

        const getPeak = (arr) => {
          let max = 0;
          for (let i = 0; i < arr.length; i++) {
            const val = Math.abs(arr[i] - 128) / 128;
            if (val > max) max = val;
          }
          return max;
        };

        const peakA = getPeak(arrayA);
        let peakB = getPeak(arrayB);
        if (peakB === 0) peakB = peakA;

        const freqArrayA = new Uint8Array(AppState.analyserA.frequencyBinCount);
        AppState.analyserA.getByteFrequencyData(freqArrayA);
        let maxBinA = 0,
          maxValA = 0;
        for (let i = 0; i < freqArrayA.length; i++) {
          if (freqArrayA[i] > maxValA) {
            maxValA = freqArrayA[i];
            maxBinA = i;
          }
        }
        const mappedFreqA =
          maxValA > 20
            ? Math.round(CONSTANTS.MIN_FREQUENCY + maxBinA * 3)
            : CONSTANTS.DEFAULT_FREQUENCY;

        let ampA = Math.round(peakA * 100 * AppState.sensitivityA);
        let ampB = Math.round(peakB * 100 * AppState.sensitivityB);

        ampA = Math.min(100, Math.max(0, ampA));
        ampB = Math.min(100, Math.max(0, ampB));

        await sendWaveformCommand(mappedFreqA, ampA, mappedFreqA, ampB);

        if (DOM["visualizer-val-a"]) DOM["visualizer-val-a"].textContent = `${ampA}%`;
        if (DOM["visualizer-val-b"]) DOM["visualizer-val-b"].textContent = `${ampB}%`;
      } else if (AppState.reflexState === "SHOCKING") {
        await sendWaveformCommand(80, AppState.reflexShockVal, 80, AppState.reflexShockVal);
      } else if (
        AppState.rhythmState !== "IDLE" ||
        AppState.edgeState === "RUNNING" ||
        AppState.potatoState === "LIVE" ||
        AppState.potatoState === "BOOM" ||
        AppState.survivalState === "RUNNING"
      ) {
        // Mini-games own their waveform output
      } else {
        // Idle: constant output at user frequency, 100% amplitude
        // Strength in 0xB0 packet controls actual output level
        await sendWaveformCommand(AppState.frequencyA, 100, AppState.frequencyB, 100);
      }
    }, CONSTANTS.WAVE_LOOP_INTERVAL_MS);
  };

  window.stopWaveLoop = function () {
    if (AppState.waveLoopInterval) {
      clearInterval(AppState.waveLoopInterval);
      AppState.waveLoopInterval = null;
    }
  };

  // ==========================================
  // AI DASHBOARD UPDATE
  // ==========================================

  window.updateAIDashboard = function () {
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
  };

  // ==========================================
  // SLIDER & CONTROL HANDLERS
  // ==========================================

  window.updateSlidersA = function (val) {
    AppState.strengthA = parseInt(val);
    if (DOM["slider-intensity-a"]) DOM["slider-intensity-a"].value = AppState.strengthA;
    if (DOM["intensity-circle-a"]) DOM["intensity-circle-a"].textContent = AppState.strengthA;
    if (DOM["label-intensity-a"]) DOM["label-intensity-a"].textContent = AppState.strengthA;
    if (
      AppState.softLimitA > 0 &&
      AppState.strengthA >= AppState.softLimitA &&
      AppState.strengthA > 0
    ) {
      log(`Kanal A am Soft-Limit (${AppState.softLimitA}).`, "warning");
    }
    updateAIDashboard();
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
    if (typeof updateOutputStatus === "function") updateOutputStatus();
  };

  window.updateSlidersB = function (val) {
    AppState.strengthB = parseInt(val);
    if (DOM["slider-intensity-b"]) DOM["slider-intensity-b"].value = AppState.strengthB;
    if (DOM["intensity-circle-b"]) DOM["intensity-circle-b"].textContent = AppState.strengthB;
    if (DOM["label-intensity-b"]) DOM["label-intensity-b"].textContent = AppState.strengthB;
    if (
      AppState.softLimitB > 0 &&
      AppState.strengthB >= AppState.softLimitB &&
      AppState.strengthB > 0
    ) {
      log(`Kanal B am Soft-Limit (${AppState.softLimitB}).`, "warning");
    }
    updateAIDashboard();
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
    if (typeof updateOutputStatus === "function") updateOutputStatus();
  };

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
    AppState.frequencyA = parseInt(e.target.value);
    log(`Frequenz A ge\u00e4ndert auf: ${AppState.frequencyA} Hz`, "info");
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
  });

  DOM["select-freq-b"]?.addEventListener("change", (e) => {
    AppState.frequencyB = parseInt(e.target.value);
    log(`Frequenz B ge\u00e4ndert auf: ${AppState.frequencyB} Hz`, "info");
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
  });

  DOM["slider-width-a"]?.addEventListener("input", (e) => {
    AppState.pulseWidthA = parseInt(e.target.value);
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
  });

  DOM["slider-width-b"]?.addEventListener("input", (e) => {
    AppState.pulseWidthB = parseInt(e.target.value);
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
  });

  // Master scale
  DOM["slider-master"]?.addEventListener("input", (e) => {
    AppState.masterScale = parseFloat(e.target.value) / 100;
    if (DOM["master-val-text"]) DOM["master-val-text"].textContent = `${e.target.value}%`;
    sendStrengthCommand(AppState.strengthA, AppState.strengthB);
    if (typeof applyAudioMasterLink === "function") applyAudioMasterLink();
    if (typeof updateOutputStatus === "function") updateOutputStatus();
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
        sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
      } else {
        AppState.activePattern = id;
        card.classList.add("active");
        if ((AppState.strengthA || 0) === 0 && (AppState.strengthB || 0) === 0) {
          log(
            "Hinweis: Intensit\u00e4t A/B steht auf 0 – ohne Basisst\u00e4rke kein sp\u00fcrbarer Output. Slider oder Preset nutzen.",
            "warning"
          );
        }
      }
      updateAIDashboard();
      log(`Muster ge\u00e4ndert: ${AppState.activePattern || "Aus"}`, "info");
    });
  });

  DOM["btn-stop-pattern"]?.addEventListener("click", () => {
    document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));
    if (SESSION_STATE.activeSession) SESSION_STATE.stop();
    AppState.activePattern = null;
    if (typeof updateSlidersA === "function") updateSlidersA(0);
    if (typeof updateSlidersB === "function") updateSlidersB(0);
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
      SESSION_STATE.start(sessionId);
    });
  });

  DOM["btn-session-pause"]?.addEventListener("click", () => {
    if (SESSION_STATE.sessionPaused) SESSION_STATE.resume();
    else SESSION_STATE.pause();
  });

  DOM["btn-session-stop"]?.addEventListener("click", () => {
    SESSION_STATE.stop();
    sendWaveformCommand(CONSTANTS.DEFAULT_FREQUENCY, 0, CONSTANTS.DEFAULT_FREQUENCY, 0);
  });
});
