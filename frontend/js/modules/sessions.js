// sessions.js - Multi-phase session engines for DG-LAB Coyote 3.0

const SESSIONS = {
  SLOW_BURN: {
    id: "slow_burn",
    name: "Slow Burn",
    icon: "\uD83D\uDD25",
    durationSec: 300,
    phases: [
      { name: "Awakening", startSec: 0, endSec: 60 },
      { name: "Rising Heat", startSec: 60, endSec: 120 },
      { name: "Simmer", startSec: 120, endSec: 200 },
      { name: "Boiling Point", startSec: 200, endSec: 260 },
      { name: "Afterglow", startSec: 260, endSec: 300 },
    ],
    compute(t) {
      const f = t / 300;
      if (f < 0.2) {
        const p = f / 0.2;
        return {
          fA: Math.round(35 + p * 15),
          aA: Math.round(p * p * 50),
          fB: Math.round(40 + p * 10),
          aB: Math.round(p * p * 40),
        };
      }
      if (f < 0.4) {
        const p = (f - 0.2) / 0.2;
        return {
          fA: Math.round(50 + 15 * Math.sin(p * Math.PI * 2)),
          aA: Math.round(50 + 25 * Math.sin(p * Math.PI * 3)),
          fB: Math.round(50 + 10 * Math.cos(p * Math.PI * 2)),
          aB: Math.round(40 + 25 * Math.cos(p * Math.PI * 3)),
        };
      }
      if (f < 0.67) {
        const p = (f - 0.4) / 0.27;
        const wave = Math.sin(t * 0.8) * 0.3 + 0.7;
        return {
          fA: Math.round(55 + 20 * Math.sin(p * Math.PI)),
          aA: Math.round(75 * wave + 15 * Math.sin(t * 2)),
          fB: Math.round(55 + 15 * Math.cos(p * Math.PI)),
          aB: Math.round(70 * wave + 15 * Math.cos(t * 2)),
        };
      }
      if (f < 0.87) {
        const p = (f - 0.67) / 0.2;
        const surge = Math.sin(t * 1.5) * 0.15;
        return {
          fA: Math.round(70 + 20 * p + 10 * Math.sin(t * 0.5)),
          aA: Math.min(100, Math.round(90 + 10 * p + surge * 20)),
          fB: Math.round(65 + 25 * p + 10 * Math.cos(t * 0.5)),
          aB: Math.min(100, Math.round(85 + 15 * p + surge * 20)),
        };
      }
      const p = (f - 0.87) / 0.13;
      return {
        fA: Math.round(80 - 40 * p),
        aA: Math.round(95 * (1 - p * p)),
        fB: Math.round(85 - 45 * p),
        aB: Math.round(90 * (1 - p * p)),
      };
    },
  },

  OCEAN_RIDE: {
    id: "ocean_ride",
    name: "Ocean Ride",
    icon: "\uD83C\uDF0A",
    durationSec: 360,
    phases: [
      { name: "Calm Waters", startSec: 0, endSec: 60 },
      { name: "Building Swell", startSec: 60, endSec: 140 },
      { name: "Rising Wave", startSec: 140, endSec: 210 },
      { name: "The Crest", startSec: 210, endSec: 270 },
      { name: "Ebb & Flow", startSec: 270, endSec: 330 },
      { name: "Shore", startSec: 330, endSec: 360 },
    ],
    compute(t) {
      const f = t / 360;
      const swell = Math.sin(t * 0.25) * 0.5 + 0.5;
      const ripple = Math.sin(t * 1.8) * 0.15;

      if (f < 0.17) {
        const p = f / 0.17;
        return {
          fA: Math.round(35 + 5 * swell),
          aA: Math.round(15 + 15 * p * swell),
          fB: Math.round(38 + 4 * Math.cos(t * 0.25)),
          aB: Math.round(12 + 12 * p * swell),
        };
      }
      if (f < 0.39) {
        const p = (f - 0.17) / 0.22;
        return {
          fA: Math.round(40 + 20 * p + 10 * swell),
          aA: Math.round(30 + 30 * p * swell + ripple * 10),
          fB: Math.round(42 + 15 * p + 8 * Math.cos(t * 0.25)),
          aB: Math.round(25 + 25 * p * swell + ripple * 10),
        };
      }
      if (f < 0.58) {
        const p = (f - 0.39) / 0.19;
        const wavePulse = Math.sin(t * 0.6) * 0.3 + 0.7;
        return {
          fA: Math.round(60 + 15 * Math.sin(p * Math.PI) + 8 * swell),
          aA: Math.round(60 * wavePulse + 20 * p),
          fB: Math.round(57 + 18 * Math.cos(p * Math.PI) + 8 * Math.cos(t * 0.25)),
          aB: Math.round(55 * wavePulse + 20 * p),
        };
      }
      if (f < 0.75) {
        const p = (f - 0.58) / 0.17;
        const crash = Math.sin(t * 2.5) * 0.2 + 0.8;
        return {
          fA: Math.round(75 + 15 * Math.sin(t * 0.4) + 10 * swell),
          aA: Math.min(100, Math.round(80 + 20 * p * crash)),
          fB: Math.round(72 + 12 * Math.cos(t * 0.4) + 8 * Math.cos(t * 0.25)),
          aB: Math.min(100, Math.round(75 + 25 * p * crash)),
        };
      }
      if (f < 0.92) {
        const p = (f - 0.75) / 0.17;
        const retreat = 1 - p * 0.5;
        const wash = Math.sin(t * 0.35) * 0.4 + 0.6;
        return {
          fA: Math.round(65 * retreat + 10 * swell),
          aA: Math.round(70 * wash * retreat),
          fB: Math.round(60 * retreat + 8 * Math.cos(t * 0.25)),
          aB: Math.round(65 * wash * retreat),
        };
      }
      const p = (f - 0.92) / 0.08;
      return {
        fA: Math.round(40 - 5 * p),
        aA: Math.round(20 * (1 - p)),
        fB: Math.round(38 - 3 * p),
        aB: Math.round(15 * (1 - p)),
      };
    },
  },

  ELECTRIC_STORM: {
    id: "electric_storm",
    name: "Electric Storm",
    icon: "\u26C8\uFE0F",
    durationSec: 240,
    phases: [
      { name: "Static Charge", startSec: 0, endSec: 30 },
      { name: "First Strikes", startSec: 30, endSec: 80 },
      { name: "Thunder Roll", startSec: 80, endSec: 150 },
      { name: "Lightning Barrage", startSec: 150, endSec: 200 },
      { name: "Passing Storm", startSec: 200, endSec: 240 },
    ],
    compute(t) {
      const f = t / 240;
      const flicker = Math.random();

      if (f < 0.125) {
        const p = f / 0.125;
        const crackle = flicker > 0.85 ? 20 : 0;
        return {
          fA: Math.round(50 + 10 * p),
          aA: Math.round(5 + 20 * p + crackle),
          fB: Math.round(55 + 8 * p),
          aB: Math.round(3 + 15 * p + crackle * 0.5),
        };
      }
      if (f < 0.33) {
        const p = (f - 0.125) / 0.205;
        const strike = Math.sin(t * 3) > 0.7 ? 1 : 0;
        return {
          fA: Math.round(60 + 20 * p + 15 * strike),
          aA: Math.round(25 + 30 * p + 25 * strike * flicker),
          fB: Math.round(58 + 15 * p + 10 * strike),
          aB: Math.round(20 + 25 * p + 20 * strike * flicker),
        };
      }
      if (f < 0.625) {
        const p = (f - 0.33) / 0.295;
        const roll = Math.sin(t * 0.8) * 0.3 + 0.7;
        const bolt = Math.sin(t * 4) > 0.6 ? 1 : 0;
        return {
          fA: Math.round(80 + 20 * Math.sin(p * Math.PI) + 10 * bolt),
          aA: Math.round(55 + 25 * p * roll + 20 * bolt * flicker),
          fB: Math.round(75 + 18 * Math.cos(p * Math.PI) + 8 * bolt),
          aB: Math.round(50 + 20 * p * roll + 15 * bolt * flicker),
        };
      }
      if (f < 0.83) {
        const p = (f - 0.625) / 0.205;
        const barrage = Math.sin(t * 6) > 0.4 ? 1 : 0;
        const chaos = Math.sin(t * 2.5) * 0.4 + 0.6;
        return {
          fA: Math.round(100 + 30 * Math.sin(t * 1.2)),
          aA: Math.min(100, Math.round(80 + 20 * p + barrage * 20 * flicker)),
          fB: Math.round(95 + 25 * Math.cos(t * 1.2)),
          aB: Math.min(100, Math.round(75 + 25 * p * chaos + barrage * 15 * flicker)),
        };
      }
      const p = (f - 0.83) / 0.17;
      const distantBolt = Math.sin(t * 1.5) > 0.8 ? 15 : 0;
      return {
        fA: Math.round(70 - 30 * p + distantBolt),
        aA: Math.round(60 * (1 - p * p)),
        fB: Math.round(65 - 25 * p + distantBolt * 0.5),
        aB: Math.round(55 * (1 - p * p)),
      };
    },
  },

  DEEP_DIVE: {
    id: "deep_dive",
    name: "Deep Dive",
    icon: "\uD83D\uDC19",
    durationSec: 420,
    phases: [
      { name: "Descent", startSec: 0, endSec: 70 },
      { name: "The Abyss", startSec: 70, endSec: 180 },
      { name: "Pressure", startSec: 180, endSec: 280 },
      { name: "Crush Zone", startSec: 280, endSec: 350 },
      { name: "Ascent", startSec: 350, endSec: 420 },
    ],
    compute(t) {
      const f = t / 420;
      const throb = Math.sin(t * 0.4) * 0.2 + 0.8;

      if (f < 0.17) {
        const p = f / 0.17;
        return {
          fA: Math.round(30 + 5 * p),
          aA: Math.round(20 + 30 * p * throb),
          fB: Math.round(28 + 4 * p),
          aB: Math.round(15 + 25 * p * throb),
        };
      }
      if (f < 0.43) {
        const p = (f - 0.17) / 0.26;
        const pulse = Math.sin(t * 0.3) * 0.35 + 0.65;
        return {
          fA: Math.round(35 + 10 * Math.sin(t * 0.15)),
          aA: Math.round(50 + 20 * p * pulse),
          fB: Math.round(32 + 8 * Math.cos(t * 0.15)),
          aB: Math.round(40 + 20 * p * pulse),
        };
      }
      if (f < 0.67) {
        const p = (f - 0.43) / 0.24;
        const squeeze = Math.sin(t * 0.5) * 0.3 + 0.7;
        return {
          fA: Math.round(45 + 15 * p + 5 * Math.sin(t * 0.2)),
          aA: Math.round(70 + 15 * p * squeeze),
          fB: Math.round(40 + 18 * p + 5 * Math.cos(t * 0.2)),
          aB: Math.round(60 + 20 * p * squeeze),
        };
      }
      if (f < 0.83) {
        const p = (f - 0.67) / 0.16;
        const crush = Math.sin(t * 0.7) * 0.25 + 0.75;
        return {
          fA: Math.round(60 + 10 * Math.sin(t * 0.25)),
          aA: Math.min(100, Math.round(85 + 15 * p * crush)),
          fB: Math.round(58 + 12 * Math.cos(t * 0.25)),
          aB: Math.min(100, Math.round(80 + 20 * p * crush)),
        };
      }
      const p = (f - 0.83) / 0.17;
      const relief = 1 - p * p;
      return {
        fA: Math.round(55 - 25 * p),
        aA: Math.round(85 * relief * throb),
        fB: Math.round(50 - 22 * p),
        aB: Math.round(80 * relief * throb),
      };
    },
  },

  ROLLERCOASTER: {
    id: "rollercoaster",
    name: "Rollercoaster",
    icon: "\uD83C\uDFA2",
    durationSec: 360,
    phases: [
      { name: "Lift Hill", startSec: 0, endSec: 50 },
      { name: "First Drop", startSec: 50, endSec: 80 },
      { name: "Loop-the-Loop", startSec: 80, endSec: 160 },
      { name: "Corkscrew", startSec: 160, endSec: 240 },
      { name: "Final Plunge", startSec: 240, endSec: 300 },
      { name: "Brake Run", startSec: 300, endSec: 360 },
    ],
    compute(t) {
      const f = t / 360;

      if (f < 0.14) {
        const p = f / 0.14;
        const anticipation = Math.sin(t * 0.8) * 5;
        return {
          fA: Math.round(35 + 20 * p + anticipation),
          aA: Math.round(10 + 40 * p * p),
          fB: Math.round(38 + 18 * p - anticipation),
          aB: Math.round(8 + 35 * p * p),
        };
      }
      if (f < 0.22) {
        const p = (f - 0.14) / 0.08;
        const rush = p * p;
        return {
          fA: Math.round(55 + 40 * rush),
          aA: Math.min(100, Math.round(50 + 50 * rush)),
          fB: Math.round(56 + 38 * rush),
          aB: Math.min(100, Math.round(43 + 57 * rush)),
        };
      }
      if (f < 0.44) {
        const p = (f - 0.22) / 0.22;
        const loop = Math.sin(p * Math.PI * 4);
        return {
          fA: Math.round(95 + 25 * loop),
          aA: Math.round(80 + 20 * Math.sin(p * Math.PI * 6)),
          fB: Math.round(94 - 20 * loop),
          aB: Math.round(75 + 25 * Math.cos(p * Math.PI * 6)),
        };
      }
      if (f < 0.67) {
        const p = (f - 0.44) / 0.23;
        const spin = Math.sin(t * 3) * 0.4 + 0.6;
        const twist = Math.cos(t * 2.5) * 0.3 + 0.7;
        return {
          fA: Math.round(90 + 30 * Math.sin(p * Math.PI * 5)),
          aA: Math.round(75 * spin + 25 * twist),
          fB: Math.round(85 + 25 * Math.cos(p * Math.PI * 5)),
          aB: Math.round(70 * twist + 30 * spin),
        };
      }
      if (f < 0.83) {
        const p = (f - 0.67) / 0.16;
        const plunge = Math.sin(t * 1.5) * 0.2 + 0.8;
        return {
          fA: Math.round(100 + 20 * (1 - p)),
          aA: Math.min(100, Math.round(85 + 15 * plunge)),
          fB: Math.round(95 + 25 * (1 - p)),
          aB: Math.min(100, Math.round(80 + 20 * plunge)),
        };
      }
      const p = (f - 0.83) / 0.17;
      return {
        fA: Math.round(80 - 45 * p),
        aA: Math.round(90 * (1 - p * p)),
        fB: Math.round(75 - 37 * p),
        aB: Math.round(85 * (1 - p * p)),
      };
    },
  },
};

const SESSION_STATE = {
  activeSession: null,
  sessionStartTime: 0,
  sessionPauseAccum: 0,
  sessionPauseStart: 0,
  sessionPaused: false,

  start(sessionId) {
    const session = Object.values(SESSIONS).find((s) => s.id === sessionId);
    if (!session) return;
    if (AppState.activePattern) {
      AppState.activePattern = null;
      document.querySelectorAll(".pattern-card").forEach((c) => c.classList.remove("active"));
    }
    this.activeSession = session;
    this.sessionStartTime = Date.now();
    this.sessionPauseAccum = 0;
    this.sessionPaused = false;
    AppState.activePattern = "session";
    if (typeof ensureGameStrength === "function") ensureGameStrength(40);
    updateAIDashboard();
    updateSessionUI();
    log(`Session "${session.name}" gestartet (${session.durationSec}s)`, "success");
  },

  stop() {
    if (!this.activeSession) return;
    const name = this.activeSession.name;
    this.activeSession = null;
    this.sessionPaused = false;
    AppState.activePattern = null;
    if (typeof sendSoftStop === "function") sendSoftStop({ keepStrength: true });
    updateAIDashboard();
    updateSessionUI();
    if (typeof trackStat === "function") trackStat("session_completed");
    log(`Session "${name}" beendet.`, "info");
  },

  pause() {
    if (!this.activeSession || this.sessionPaused) return;
    this.sessionPaused = true;
    this.sessionPauseStart = Date.now();
    if (typeof sendSoftStop === "function") sendSoftStop({ keepStrength: true });
    updateSessionUI();
    log("Session pausiert.", "warning");
  },

  resume() {
    if (!this.activeSession || !this.sessionPaused) return;
    this.sessionPaused = false;
    this.sessionPauseAccum += Date.now() - this.sessionPauseStart;
    updateSessionUI();
    log("Session fortgesetzt.", "info");
  },

  getElapsedSec() {
    if (!this.activeSession) return 0;
    if (this.sessionPaused) {
      return (this.sessionPauseStart - this.sessionStartTime - this.sessionPauseAccum) / 1000;
    }
    return (Date.now() - this.sessionStartTime - this.sessionPauseAccum) / 1000;
  },

  computeTick() {
    if (!this.activeSession) return null;
    const t = this.getElapsedSec();
    const dur = this.activeSession.durationSec;
    if (t >= dur) {
      this.stop();
      return null;
    }
    return this.activeSession.compute(t);
  },

  getCurrentPhase() {
    if (!this.activeSession) return null;
    const t = this.getElapsedSec();
    const phases = this.activeSession.phases;
    for (let i = phases.length - 1; i >= 0; i--) {
      if (t >= phases[i].startSec) return phases[i];
    }
    return phases[0];
  },
};

function updateSessionUI() {
  const indicator = document.getElementById("session-indicator");
  const phaseEl = document.getElementById("session-phase");
  const timeEl = document.getElementById("session-time");
  const progressEl = document.getElementById("session-progress");
  const btnPause = document.getElementById("btn-session-pause");

  if (!SESSION_STATE.activeSession) {
    if (indicator) indicator.style.display = "none";
    document.querySelectorAll(".session-card").forEach((c) => c.classList.remove("active"));
    return;
  }

  const session = SESSION_STATE.activeSession;
  const elapsed = SESSION_STATE.getElapsedSec();
  const phase = SESSION_STATE.getCurrentPhase();
  const remaining = Math.max(0, session.durationSec - elapsed);
  const pct = Math.min(100, (elapsed / session.durationSec) * 100);

  if (indicator) {
    indicator.style.display = "flex";
    const nameEl = indicator.querySelector(".session-indicator-name");
    if (nameEl) nameEl.textContent = session.name;
  }
  if (phaseEl) phaseEl.textContent = phase ? phase.name : "";
  if (timeEl) {
    const m = Math.floor(remaining / 60);
    const s = Math.floor(remaining % 60);
    timeEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;
  }
  if (progressEl) progressEl.style.width = `${pct}%`;
  if (btnPause) {
    btnPause.textContent = SESSION_STATE.sessionPaused ? "\u25B6" : "\u23F8";
  }

  document.querySelectorAll(".session-card").forEach((c) => {
    c.classList.toggle("active", c.getAttribute("data-session") === session.id);
  });
}

window.SESSIONS = SESSIONS;
window.SESSION_STATE = SESSION_STATE;
window.updateSessionUI = updateSessionUI;
