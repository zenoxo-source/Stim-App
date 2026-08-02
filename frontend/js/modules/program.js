// program.js — curated evening programs: sequential steps (patterns, sessions,
// Autodrive templates) with per-step durations, then a wind-down.
//
// Steps run through the existing output pipeline; the program owns the output
// ("program" owner) and stops cleanly at the end. Panic aborts it.

import { AppState, log } from "../state.js";
import { claimOutput, releaseOutput } from "./output-owner.js";
import { sendSoftStop } from "./bluetooth.js";
import { SESSION_STATE } from "./sessions.js";
import { startAutodrive, stopAutodrive, isAutodriveActive } from "./autodrive.js";

/** @type {Record<string, {label: string, steps: Array<{type: string, id?: string, sec: number}>}>} */
export const PROGRAMS = Object.freeze({
  classic: {
    label: "Klassisch",
    steps: [
      { type: "pattern", id: "breath", sec: 120 },
      { type: "session", id: "slow_burn", sec: 300 },
      { type: "pattern", id: "gentle", sec: 180 },
    ],
  },
  climax_factory: {
    label: "Climax-Fabrik",
    steps: [
      { type: "pattern", id: "breath", sec: 90 },
      { type: "autodrive", id: "climax_factory", sec: 1080 },
      { type: "pattern", id: "heartbeat", sec: 180 },
    ],
  },
  hfo_ritual: {
    label: "HFO-Ritual",
    steps: [
      { type: "pattern", id: "breath", sec: 120 },
      { type: "autodrive", id: "hfo", sec: 1500 },
      { type: "pattern", id: "gentle", sec: 240 },
    ],
  },
});

let runner = null; // {programId, stepIdx, timer, stepStartedAt}

/** @returns {{running: boolean, programId?: string, stepIdx?: number, label?: string, remainingSec?: number}} */
export function getProgramState() {
  if (!runner) return { running: false };
  const prog = PROGRAMS[runner.programId];
  const step = prog?.steps[runner.stepIdx];
  return {
    running: true,
    programId: runner.programId,
    label: prog?.label,
    stepIdx: runner.stepIdx,
    stepLabel: stepLabel(step),
    remainingSec: Math.max(0, Math.round((runner.stepEndsAt - Date.now()) / 1000)),
  };
}

function stepLabel(step) {
  if (!step) return "";
  if (step.type === "pattern") return `Pattern ${step.id}`;
  if (step.type === "session") return `Session ${step.id}`;
  if (step.type === "autodrive") return `Autodrive ${step.id}`;
  return step.type;
}

function startStep(step) {
  // Clear any prior output source for this step.
  try {
    if (isAutodriveActive()) stopAutodrive("program");
  } catch {
    /* optional */
  }
  try {
    if (SESSION_STATE.activeSession) SESSION_STATE.stop();
  } catch {
    /* optional */
  }
  AppState.activePattern = null;

  if (step.type === "pattern") {
    AppState.activePattern = step.id;
    AppState.lastWaveFreqA = 45;
    AppState.lastWaveAmpA = 60;
    AppState.lastWaveFreqB = 45;
    AppState.lastWaveAmpB = 60;
  } else if (step.type === "session") {
    SESSION_STATE.start(step.id);
  } else if (step.type === "autodrive") {
    startAutodrive({ templateId: step.id, skipCalibration: true });
  }
  log(`Programm: Schritt ${runner.stepIdx + 1} — ${stepLabel(step)} (${step.sec}s)`, "info");
}

function advanceStep() {
  if (!runner) return;
  const prog = PROGRAMS[runner.programId];
  const steps = prog?.steps || [];
  if (runner.stepIdx + 1 >= steps.length) {
    stopProgram("fertig");
    return;
  }
  runner.stepIdx += 1;
  const step = steps[runner.stepIdx];
  runner.stepEndsAt = Date.now() + step.sec * 1000;
  startStep(step);
  runner.timer = setTimeout(advanceStep, step.sec * 1000);
  updateProgramUi();
}

/** Start a program by id. */
export function runProgram(programId) {
  const prog = PROGRAMS[programId];
  if (!prog) return { ok: false, error: "Unbekanntes Programm." };
  if (!AppState.isConnected) return { ok: false, error: "Nicht verbunden." };
  if (runner) stopProgram("neu");

  const claim = claimOutput("program");
  if (!claim.ok) return { ok: false, error: claim.error || "Claim fehlgeschlagen." };

  runner = { programId, stepIdx: 0, timer: null, stepEndsAt: 0 };
  const first = prog.steps[0];
  runner.stepEndsAt = Date.now() + first.sec * 1000;
  startStep(first);
  runner.timer = setTimeout(advanceStep, first.sec * 1000);
  log(`Abendprogramm „${prog.label}" gestartet.`, "success");
  updateProgramUi();
  return { ok: true };
}

/** Stop the running program (clean wind-down). */
export function stopProgram(reason = "manuell") {
  if (!runner) return;
  clearTimeout(runner.timer);
  runner = null;
  try {
    if (isAutodriveActive()) stopAutodrive("program");
  } catch {
    /* optional */
  }
  try {
    if (SESSION_STATE.activeSession) SESSION_STATE.stop();
  } catch {
    /* optional */
  }
  AppState.activePattern = null;
  try {
    releaseOutput("program");
  } catch {
    /* ignore */
  }
  sendSoftStop({ keepStrength: false });
  log(`Abendprogramm beendet (${reason}).`, "info");
  updateProgramUi();
}

function updateProgramUi() {
  const status = document.getElementById("program-status");
  if (!status) return;
  const st = getProgramState();
  status.textContent = st.running
    ? `Läuft: ${st.label} · Schritt ${(st.stepIdx || 0) + 1} (${st.stepLabel}) · noch ~${st.remainingSec}s`
    : "Kein Programm aktiv.";
}

window.addEventListener("stim:kill-all", () => stopProgram("panic"));

if (typeof document !== "undefined") {
  const wire = () => {
    Object.entries(PROGRAMS).forEach(([id, prog]) => {
      document.getElementById(`btn-program-${id}`)?.addEventListener("click", () => {
        const r = runProgram(id);
        if (!r.ok) log(`Programm: ${r.error}`, "error");
      });
    });
    document
      .getElementById("btn-program-stop")
      ?.addEventListener("click", () => stopProgram("manuell"));
    // Live progress ticker while running.
    setInterval(updateProgramUi, 1000);
    updateProgramUi();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
}
