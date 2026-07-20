/**
 * Tests for ai-director.js - pure helpers + state machine.
 *
 * The LLM fetch path is exercised manually (Electron smoke), not here.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  loadConfig,
  saveConfig,
  sanitiseConfig,
  clampIntensity,
  computeNextBeatMs,
  buildDirectorMessages,
  parseDirectorResponse,
  isRunning,
  isPaused,
  isActive,
  getStatus,
  start,
  stop,
  pause,
  resume,
  _resetForTest,
} from "../../frontend/js/modules/ai-director.js";
import { AppState } from "../../frontend/js/state.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  AppState.isConnected = false;
  AppState.strengthA = 0;
  AppState.strengthB = 0;
  AppState.softLimitA = 150;
  AppState.softLimitB = 150;
  AppState.activePattern = null;
  AppState.panicCooldownUntil = 0;
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
});

describe("ai-director.js - config", () => {
  it("returns defaults on first call", () => {
    const cfg = loadConfig();
    assert.equal(cfg.persona, "domina");
    assert.equal(cfg.beatIntervalSec, 30);
    assert.equal(cfg.maxIntensity, 60);
    assert.equal(cfg.autoStopMinutes, 20);
    assert.equal(cfg.jitter, 0.3);
  });

  it("saveConfig merges with existing", () => {
    saveConfig({ maxIntensity: 80 });
    saveConfig({ theme: "Verhoer" });
    const cfg = loadConfig();
    assert.equal(cfg.maxIntensity, 80);
    assert.equal(cfg.theme, "Verhoer");
    assert.equal(cfg.beatIntervalSec, 30); // unchanged
  });

  it("survives corrupt localStorage", () => {
    localStorage.setItem("stim_app_director_v1", "not-json");
    const cfg = loadConfig();
    assert.equal(cfg.beatIntervalSec, 30);
  });

  it("sanitiseConfig clamps ranges", () => {
    const s = sanitiseConfig({
      beatIntervalSec: 1,
      maxIntensity: 9999,
      autoStopMinutes: -5,
      jitter: 5,
      persona: "unknown",
      theme: "x".repeat(500),
    });
    assert.equal(s.beatIntervalSec, 10);
    assert.equal(s.maxIntensity, 200);
    assert.equal(s.autoStopMinutes, 1);
    assert.equal(s.jitter, 0.8);
    assert.ok(!s.persona, "unknown persona rejected");
    assert.ok(s.theme.length <= 200);
  });
});

describe("ai-director.js - clampIntensity", () => {
  it("clamps to maxIntensity when lower than softLimit", () => {
    const v = clampIntensity(100, 50, 150, 150);
    assert.equal(v, 50);
  });

  it("clamps to softLimit when lower than maxIntensity", () => {
    const v = clampIntensity(100, 150, 40, 80);
    assert.equal(v, 40); // min(40,80) = 40
  });

  it("passes value through when within both caps", () => {
    assert.equal(clampIntensity(30, 60, 150, 150), 30);
  });

  it("clamps negative to 0", () => {
    assert.equal(clampIntensity(-20, 60, 150, 150), 0);
  });

  it("returns 0 for non-numeric input", () => {
    assert.equal(clampIntensity("abc", 60, 150, 150), 0);
    assert.equal(clampIntensity(undefined, 60, 150, 150), 0);
  });
});

describe("ai-director.js - computeNextBeatMs", () => {
  it("returns base when jitter is 0", () => {
    const ms = computeNextBeatMs({ beatIntervalSec: 30, jitter: 0 }, () => 0.5);
    assert.equal(ms, 30_000);
  });

  it("produces base value when rng returns 0.5 (midpoint)", () => {
    const ms = computeNextBeatMs({ beatIntervalSec: 60, jitter: 0.3 }, () => 0.5);
    assert.equal(ms, 60_000);
  });

  it("increases delay at rng=1", () => {
    const base = 30_000;
    const jitter = 0.3;
    const ms = computeNextBeatMs({ beatIntervalSec: 30, jitter }, () => 1.0);
    assert.equal(ms, Math.round(base * (1 + jitter)));
  });

  it("decreases delay at rng=0 but floors at 2000ms", () => {
    const ms = computeNextBeatMs({ beatIntervalSec: 30, jitter: 0.3 }, () => 0.0);
    assert.equal(ms, Math.round(30_000 * (1 - 0.3)));
    const msFloor = computeNextBeatMs({ beatIntervalSec: 5, jitter: 0.8 }, () => 0.0);
    assert.ok(msFloor >= 2000);
  });

  it("clamps interval into [10, 600]", () => {
    const ms = computeNextBeatMs({ beatIntervalSec: 1, jitter: 0 }, () => 0.5);
    assert.equal(ms, 10_000);
    const msHigh = computeNextBeatMs({ beatIntervalSec: 9999, jitter: 0 }, () => 0.5);
    assert.equal(msHigh, 600_000);
  });
});

describe("ai-director.js - buildDirectorMessages", () => {
  it("produces system + user strings containing key context", () => {
    const out = buildDirectorMessages({
      persona: "domina",
      userName: "Alex",
      theme: "Verhoer",
      beatNumber: 3,
      elapsedMin: 2,
      autoStopMin: 20,
      strA: 30,
      strB: 40,
      pattern: "tease",
      maxIntensity: 60,
      memorySnapshot: "mag Stufe 50",
      recentNarratives: ["Du zuckst zusammen.", "Mehr."],
    });
    assert.ok(out.system.includes("Alex"));
    assert.ok(out.system.includes("Director"));
    assert.ok(out.system.includes("Mistress"));
    assert.ok(out.user.includes("Verhoer"));
    assert.ok(out.user.includes("Beat Nr. 3"));
    assert.ok(out.user.includes("A=30"));
    assert.ok(out.user.includes("mag Stufe 50"));
    assert.ok(out.user.includes("Du zuckst zusammen"));
    // Schema reminder
    assert.ok(out.user.includes('"commands"'));
    assert.ok(out.user.includes('"narrative"'));
  });

  it("falls back when persona unknown", () => {
    const out = buildDirectorMessages({
      persona: "bogus",
      userName: "X",
      beatNumber: 1,
      maxIntensity: 50,
    });
    assert.ok(out.system.includes("Mistress"));
  });

  it("omits recent beats gracefully when none", () => {
    const out = buildDirectorMessages({
      persona: "master",
      userName: "X",
      beatNumber: 1,
      maxIntensity: 50,
      recentNarratives: [],
    });
    assert.ok(out.user.includes("(none)"));
  });
});

describe("ai-director.js - parseDirectorResponse", () => {
  it("parses a clean JSON response", () => {
    const raw = JSON.stringify({
      narrative: "Du zuckst.",
      commands: [{ name: "set_intensity", arguments: { levelA: 30, levelB: 40 } }],
      memory: "User mag 40",
      mood: "tease",
    });
    const r = parseDirectorResponse(raw);
    assert.equal(r.ok, true);
    assert.equal(r.narrative, "Du zuckst.");
    assert.equal(r.commands.length, 1);
    assert.equal(r.commands[0].name, "set_intensity");
    assert.equal(r.commands[0].arguments.levelA, 30);
    assert.equal(r.memory, "User mag 40");
    assert.equal(r.mood, "tease");
  });

  it("strips a single ```json fence", () => {
    const raw = "```json\n" + JSON.stringify({ narrative: "Hi", commands: [] }) + "\n```";
    const r = parseDirectorResponse(raw);
    assert.equal(r.ok, true);
    assert.equal(r.narrative, "Hi");
  });

  it("extracts JSON from surrounding prose", () => {
    const raw = `Hier ist deine Antwort: {"narrative":"X","commands":[]} hoffentlich ok`;
    const r = parseDirectorResponse(raw);
    assert.equal(r.ok, true);
    assert.equal(r.narrative, "X");
  });

  it("rejects empty input", () => {
    assert.equal(parseDirectorResponse("").ok, false);
    assert.equal(parseDirectorResponse("   ").ok, false);
  });

  it("rejects non-string", () => {
    assert.equal(parseDirectorResponse(null).ok, false);
    assert.equal(parseDirectorResponse(undefined).ok, false);
    assert.equal(parseDirectorResponse(42).ok, false);
  });

  it("rejects object without narrative and commands", () => {
    const r = parseDirectorResponse(JSON.stringify({ foo: "bar" }));
    assert.equal(r.ok, false);
  });

  it("filters unknown commands", () => {
    const r = parseDirectorResponse(
      JSON.stringify({
        narrative: "x",
        commands: [
          { name: "set_intensity", arguments: { levelA: 10 } },
          { name: "bogus_function", arguments: {} },
          { name: "play_pattern", arguments: { pattern_name: "tease" } },
        ],
      })
    );
    assert.equal(r.ok, true);
    assert.equal(r.commands.length, 2);
    assert.deepEqual(
      r.commands.map((c) => c.name),
      ["set_intensity", "play_pattern"]
    );
  });

  it("accepts legacy single command key", () => {
    const r = parseDirectorResponse(
      JSON.stringify({ narrative: "x", command: { name: "stop_all", arguments: {} } })
    );
    assert.equal(r.ok, true);
    assert.equal(r.commands.length, 1);
    assert.equal(r.commands[0].name, "stop_all");
  });

  it("normalises memory null/string variants", () => {
    const r1 = parseDirectorResponse(JSON.stringify({ narrative: "x", memory: null }));
    assert.equal(r1.memory, null);
    const r2 = parseDirectorResponse(JSON.stringify({ narrative: "x", memory: "null" }));
    assert.equal(r2.memory, null);
    const r3 = parseDirectorResponse(JSON.stringify({ narrative: "x", memory: "  " }));
    assert.equal(r3.memory, null);
    const r4 = parseDirectorResponse(JSON.stringify({ narrative: "x", memory: "Merke: X" }));
    assert.equal(r4.memory, "Merke: X");
  });

  it("falls back mood to neutral when invalid", () => {
    const r = parseDirectorResponse(JSON.stringify({ narrative: "x", mood: "explode" }));
    assert.equal(r.mood, "neutral");
  });

  it("allows narrative without commands", () => {
    const r = parseDirectorResponse(JSON.stringify({ narrative: "Nur Erzaehlung.", commands: [] }));
    assert.equal(r.ok, true);
    assert.equal(r.commands.length, 0);
  });

  it("allows commands without narrative", () => {
    const r = parseDirectorResponse(
      JSON.stringify({ commands: [{ name: "stop_all", arguments: {} }] })
    );
    assert.equal(r.ok, true);
    assert.equal(r.narrative, "");
    assert.equal(r.commands.length, 1);
  });
});

describe("ai-director.js - state machine", () => {
  it("starts as IDLE", () => {
    assert.equal(isRunning(), false);
    assert.equal(isPaused(), false);
    assert.equal(isActive(), false);
    assert.equal(getStatus().state, "IDLE");
  });

  it("rejects start when not connected", () => {
    AppState.isConnected = false;
    const r = start();
    assert.equal(r.ok, false);
    assert.match(r.error, /verbunden/i);
    assert.equal(isActive(), false);
  });

  it("transitions IDLE -> RUNNING -> IDLE when connected", () => {
    AppState.isConnected = true;
    const r = start({ beatIntervalSec: 20, maxIntensity: 30 });
    assert.equal(r.ok, true);
    assert.equal(isRunning(), true);
    assert.equal(isActive(), true);
    assert.equal(getStatus().state, "RUNNING");

    stop("test");
    assert.equal(isRunning(), false);
    assert.equal(isActive(), false);
    assert.equal(getStatus().state, "IDLE");
  });

  it("rejects double-start", () => {
    AppState.isConnected = true;
    start();
    const r = start();
    assert.equal(r.ok, false);
    stop("test");
  });

  it("supports RUNNING -> PAUSED -> RUNNING", () => {
    AppState.isConnected = true;
    start();
    assert.equal(isRunning(), true);
    pause();
    assert.equal(isPaused(), true);
    assert.equal(isRunning(), false);
    assert.equal(isActive(), true);
    resume();
    assert.equal(isRunning(), true);
    assert.equal(isPaused(), false);
    stop("test");
  });

  it("pause/resume are no-ops in IDLE", () => {
    pause();
    resume();
    assert.equal(isActive(), false);
  });

  it("stop is a no-op in IDLE", () => {
    stop("never started");
    assert.equal(isActive(), false);
  });

  it("getStatus reports beat number + mood defaults", () => {
    AppState.isConnected = true;
    start({ maxIntensity: 25 });
    const s = getStatus();
    assert.equal(s.beatNumber, 0); // first beat scheduled, not yet fired
    assert.equal(s.mood, "neutral");
    assert.equal(s.autoStopMin, loadConfig().autoStopMinutes);
    stop("test");
  });
});
