/**
 * Tests for story-mode.js - validation, state machine, AI parsing.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import {
  BUILTIN_STORIES,
  validateStory,
  validateScene,
  validateStimCommand,
  listStories,
  loadCustomStories,
  saveCustomStories,
  addCustomStory,
  removeCustomStory,
  startStory,
  stopStory,
  makeChoice,
  getCurrentState,
  loadProgress,
  saveProgress,
  resetProgress,
  buildSceneGenPrompt,
  parseAiScene,
} from "../../frontend/js/modules/story-mode.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  stopStory("test-setup");
});

describe("story-mode.js - BUILTIN_STORIES", () => {
  it("ships with at least 3 stories", () => {
    assert.ok(BUILTIN_STORIES.length >= 3);
  });

  it("all built-in stories are valid", () => {
    BUILTIN_STORIES.forEach((s) => {
      const r = validateStory(s);
      assert.ok(r.ok, `Story ${s.id} invalid: ${r.error}`);
    });
  });

  it("built-in stories have unique ids", () => {
    const ids = BUILTIN_STORIES.map((s) => s.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size);
  });
});

describe("story-mode.js - validateStory", () => {
  it("rejects null/undefined", () => {
    assert.equal(validateStory(null).ok, false);
    assert.equal(validateStory(undefined).ok, false);
  });

  it("rejects missing title", () => {
    assert.equal(
      validateStory({ startScene: "a", scenes: { a: { narrative: "x" } } }).ok,
      false
    );
  });

  it("rejects missing startScene", () => {
    assert.equal(validateStory({ title: "T", scenes: { a: { narrative: "x" } } }).ok, false);
  });

  it("rejects startScene not in scenes", () => {
    const r = validateStory({ title: "T", startScene: "x", scenes: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /startScene/);
  });

  it("accepts minimal valid story", () => {
    const r = validateStory({
      title: "T",
      startScene: "a",
      scenes: { a: { narrative: "Hello", isEnd: true } },
    });
    assert.equal(r.ok, true);
  });
});

describe("story-mode.js - validateScene", () => {
  it("rejects missing narrative", () => {
    const r = validateScene({}, "x");
    assert.equal(r.ok, false);
    assert.match(r.error, /narrative/);
  });

  it("rejects invalid choice (missing label/next)", () => {
    const r = validateScene(
      { narrative: "x", choices: [{ label: "ok" }] },
      "x"
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /choices/);
  });

  it("rejects autoAdvance missing next/delaySec", () => {
    const r = validateScene({ narrative: "x", autoAdvance: { next: "y" } }, "x");
    assert.equal(r.ok, false);
    assert.match(r.error, /autoAdvance/);
  });

  it("accepts valid scene with choices + autoAdvance", () => {
    const r = validateScene(
      {
        narrative: "Choose",
        choices: [{ label: "A", next: "a" }],
        autoAdvance: { next: "b", delaySec: 30 },
      },
      "x"
    );
    assert.equal(r.ok, true);
  });
});

describe("story-mode.js - validateStimCommand", () => {
  it("rejects null/undefined", () => {
    assert.equal(validateStimCommand(null).ok, false);
    assert.equal(validateStimCommand(undefined).ok, false);
  });

  it("rejects unknown type", () => {
    assert.equal(validateStimCommand({ type: "explode" }).ok, false);
  });

  it("rejects set-strength without value", () => {
    assert.equal(validateStimCommand({ type: "set-strength", channel: "A" }).ok, false);
  });

  it("rejects set-frequency without channel", () => {
    assert.equal(validateStimCommand({ type: "set-frequency", value: 50 }).ok, false);
  });

  it("accepts soft-stop without extra fields", () => {
    assert.equal(validateStimCommand({ type: "soft-stop" }).ok, true);
  });

  it("accepts well-formed set-strength", () => {
    assert.equal(
      validateStimCommand({ type: "set-strength", channel: "both", value: 50 }).ok,
      true
    );
  });
});

describe("story-mode.js - CRUD", () => {
  it("starts with only built-in stories", () => {
    assert.equal(loadCustomStories().length, 0);
    assert.equal(listStories().length, BUILTIN_STORIES.length);
  });

  it("addCustomStory rejects invalid", () => {
    const r = addCustomStory({ title: "" });
    assert.equal(r.ok, false);
    assert.equal(loadCustomStories().length, 0);
  });

  it("addCustomStory persists", () => {
    const r = addCustomStory({
      title: "Custom",
      startScene: "start",
      scenes: { start: { narrative: "Hello", isEnd: true } },
    });
    assert.equal(r.ok, true);
    assert.ok(r.story.id);
    assert.equal(loadCustomStories().length, 1);
    assert.equal(listStories().length, BUILTIN_STORIES.length + 1);
  });

  it("addCustomStory replaces existing id", () => {
    const r = addCustomStory({
      id: "test-id",
      title: "V1",
      startScene: "s",
      scenes: { s: { narrative: "x", isEnd: true } },
    });
    addCustomStory({
      id: "test-id",
      title: "V2",
      startScene: "s",
      scenes: { s: { narrative: "y", isEnd: true } },
    });
    const list = loadCustomStories();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "V2");
  });

  it("removeCustomStory deletes", () => {
    const r = addCustomStory({
      title: "X",
      startScene: "s",
      scenes: { s: { narrative: "x", isEnd: true } },
    });
    removeCustomStory(r.story.id);
    assert.equal(loadCustomStories().length, 0);
  });
});

describe("story-mode.js - engine state machine", () => {
  it("starts with no active story", () => {
    assert.equal(getCurrentState(), null);
  });

  it("startStory activates + enters startScene", () => {
    const r = startStory("captive");
    assert.equal(r.ok, true);
    const state = getCurrentState();
    assert.ok(state);
    assert.equal(state.storyId, "captive");
    assert.equal(state.sceneId, "intro");
    assert.ok(state.narrative);
    assert.equal(state.isEnd, false);
  });

  it("startStory rejects unknown id", () => {
    const r = startStory("does-not-exist");
    assert.equal(r.ok, false);
  });

  it("makeChoice advances scene", () => {
    startStory("captive");
    const r = makeChoice(0); // first choice = "Struggle"
    assert.equal(r.ok, true);
    const state = getCurrentState();
    assert.equal(state.sceneId, "struggle");
  });

  it("makeChoice rejects invalid index", () => {
    startStory("captive");
    const r = makeChoice(999);
    assert.equal(r.ok, false);
  });

  it("stopStory resets state", () => {
    startStory("captive");
    stopStory("test");
    assert.equal(getCurrentState(), null);
  });

  it("end scene has isEnd=true", () => {
    startStory("captive");
    makeChoice(0); // "Struggle" → struggle
    const state = getCurrentState();
    assert.equal(state.sceneId, "struggle");
    makeChoice(1); // "Give up" → submit (isEnd)
    const state2 = getCurrentState();
    assert.equal(state2.isEnd, true);
    assert.equal(state2.choices.length, 0);
  });
});

describe("story-mode.js - progress", () => {
  it("starts empty", () => {
    assert.deepEqual(loadProgress(), {});
  });

  it("saveProgress + loadProgress", () => {
    saveProgress("captive", "struggle");
    const p = loadProgress();
    assert.equal(p.captive, "struggle");
  });

  it("resetProgress single story", () => {
    saveProgress("a", "x");
    saveProgress("b", "y");
    resetProgress("a");
    const p = loadProgress();
    assert.equal(p.a, undefined);
    assert.equal(p.b, "y");
  });

  it("resetProgress all", () => {
    saveProgress("a", "x");
    resetProgress();
    assert.deepEqual(loadProgress(), {});
  });
});

describe("story-mode.js - AI generation", () => {
  it("buildSceneGenPrompt includes theme + visited scenes", () => {
    const p = buildSceneGenPrompt("Captivity", "intro", ["intro", "struggle"]);
    assert.match(p, /Captivity/);
    assert.match(p, /intro, struggle/);
    assert.match(p, /JSON/);
  });

  it("parseAiScene accepts valid JSON", () => {
    const r = parseAiScene(
      JSON.stringify({
        narrative: "Test",
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      })
    );
    assert.equal(r.ok, true);
    assert.equal(r.scene.narrative, "Test");
  });

  it("parseAiScene strips ```json fences", () => {
    const raw = "```json\n" + JSON.stringify({ narrative: "X", isEnd: true }) + "\n```";
    const r = parseAiScene(raw);
    assert.equal(r.ok, true);
  });

  it("parseAiScene rejects invalid JSON", () => {
    const r = parseAiScene("{ not json");
    assert.equal(r.ok, false);
    assert.match(r.error, /JSON/);
  });

  it("parseAiScene rejects valid JSON but invalid scene", () => {
    const r = parseAiScene(JSON.stringify({ noNarrative: true }));
    assert.equal(r.ok, false);
    assert.match(r.error, /narrative|Validierung/);
  });
});
