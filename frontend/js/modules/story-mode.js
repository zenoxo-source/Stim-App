// story-mode.js - Branching-narrative engine + AI scene generation.
//
// Story format (JSON):
//   {
//     id: "captive",
//     title: "The Captive",
//     description: "...",
//     startScene: "intro",
//     scenes: {
//       "intro": {
//         narrative: "...",
//         stimCommand: { type: "set-strength", channel: "A", value: 30 } | null,
//         choices: [
//           { label: "Struggle", next: "struggle", stimCommand: {...} | null },
//           { label: "Submit",  next: "submit",  stimCommand: {...} | null }
//         ],
//         autoAdvance: { next: "intro2", delaySec: 30 } | null,
//         isEnd: false
//       }
//     }
//   }
//
// Engine: scene state machine. Each scene can trigger a stim command, then
// either wait for a user choice OR auto-advance after delaySec.
//
// AI generator: prompts the LLM to produce a fresh scene based on a theme +
// current state. The response must be valid JSON; we validate before playing.

import { log } from "../state.js";
import { sendSoftStop } from "./bluetooth.js";
import { updateSlidersA, updateSlidersB, setChannelFreq } from "../control-deck.js";

const STORY_KEY = "stim_app_stories_v1";
const PROGRESS_KEY = "stim_app_story_progress_v1";

let activeStory = null;
let currentSceneId = null;
let autoAdvanceTimer = null;
let onSceneChangeCallback = null;

// ---------------------------------------------------------------------------
// Built-in stories (3 starter scenarios)
// ---------------------------------------------------------------------------

export const BUILTIN_STORIES = [
  {
    id: "captive",
    title: "The Captive",
    description: "Du wirst gefangen gehalten. W\u00e4hle deine Antworten weise.",
    duration: "~10 Min",
    startScene: "intro",
    scenes: {
      intro: {
        narrative: `Du wachst auf einem Stuhl auf. Deine H\u00e4nde sind gefesselt. Eine ged\u00e4mpfte Stimme fl\u00fcstert: \u201eWillkommen.\u201c`,
        stimCommand: { type: "set-strength", channel: "both", value: 20 },
        choices: [
          { label: "Struggle against the restraints", next: "struggle" },
          { label: "Stay still and listen", next: "listen" },
        ],
        autoAdvance: null,
        isEnd: false,
      },
      struggle: {
        narrative: `Du zerrst an den Fesseln. Ein leises Lachen ert\u00f6nt. \u201eKr\u00e4ftiger\u201c, sagt die Stimme.`,
        stimCommand: { type: "set-strength", channel: "both", value: 40 },
        choices: [
          { label: "Continue struggling", next: "exhausted" },
          { label: "Give up", next: "submit" },
        ],
        autoAdvance: null,
        isEnd: false,
      },
      listen: {
        narrative: `Du bleibst still. Die Stimme sagt: \u201eGut. Du lernst schnell.\u201c Die Spannung steigt.`,
        stimCommand: { type: "set-strength", channel: "A", value: 30 },
        choices: [{ label: "Wait for instructions", next: "instructions" }],
        autoAdvance: null,
        isEnd: false,
      },
      submit: {
        narrative: `Du ergibst dich. Die Stimme fl\u00fcstert: \u201eVern\u00fcnftige Wahl.\u201c Die Spannung sinkt.`,
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      },
      exhausted: {
        narrative: `Du bist ersch\u00f6pft. Die Fesseln haben sich nicht bewegt. \u201eGenug\u201c, sagt die Stimme.`,
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      },
      instructions: {
        narrative: `Die Stimme gibt dir eine Aufgabe. W\u00e4hrend du sie ausf\u00fchrst, steigt die Intensit\u00e4t.`,
        stimCommand: { type: "set-strength", channel: "both", value: 60 },
        choices: [{ label: "Complete the task", next: "ending_complete" }],
        autoAdvance: { next: "ending_fail", delaySec: 30 },
        isEnd: false,
      },
      ending_complete: {
        narrative: `Du hast die Aufgabe erf\u00fcllt. \u201eSehr gut.\u201c Die Spannung l\u00f6st sich.`,
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      },
      ending_fail: {
        narrative: "Die Zeit ist abgelaufen. Du hast es nicht geschafft.",
        stimCommand: { type: "set-strength", channel: "both", value: 80 },
        choices: [],
        autoAdvance: { next: "submit", delaySec: 5 },
        isEnd: false,
      },
    },
  },
  {
    id: "interrogation",
    title: "Interrogation",
    description: "Verh\u00f6r mit zunehmendem Druck. Gestehst du?",
    duration: "~8 Min",
    startScene: "intro",
    scenes: {
      intro: {
        narrative: `Ein Vernehmungsoffizier tritt ein. \u201eWir haben Fragen.\u201c`,
        stimCommand: null,
        choices: [
          { label: "Schweigen", next: "silent" },
          { label: "Reden", next: "talk" },
        ],
        autoAdvance: null,
        isEnd: false,
      },
      silent: {
        narrative: `Du schweigst. Der Offizier nickt. \u201eWir haben Mittel.\u201c`,
        stimCommand: { type: "set-strength", channel: "A", value: 25 },
        choices: [{ label: "Weiter schweigen", next: "pressure_up" }],
        autoAdvance: null,
        isEnd: false,
      },
      talk: {
        narrative: `Du redest. Der Offizier l\u00e4chelt: \u201eMehr.\u201c`,
        stimCommand: { type: "set-strength", channel: "both", value: 15 },
        choices: [{ label: "Mehr verraten", next: "betrayal" }],
        autoAdvance: null,
        isEnd: false,
      },
      pressure_up: {
        narrative: `Der Druck steigt. Du sp\u00fcrst jede Frage st\u00e4rker.`,
        stimCommand: { type: "set-strength", channel: "both", value: 55 },
        choices: [{ label: "Aufgeben", next: "confession" }],
        autoAdvance: { next: "confession", delaySec: 20 },
        isEnd: false,
      },
      betrayal: {
        narrative: `Du hast alles verraten. \u201eDu warst... entt\u00e4uschend.\u201c`,
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      },
      confession: {
        narrative: "Du gestehst. Der Druck l\u00e4sst nach.",
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      },
    },
  },
  {
    id: "edge-rush",
    title: "Edge Rush",
    description: "Steigerung bis an den Rand, dann w\u00e4hle: durchhalten oder zur\u00fcckziehen.",
    duration: "~6 Min",
    startScene: "warmup",
    scenes: {
      warmup: {
        narrative: "Sanfter Anfang. Du kannst dich entspannen.",
        stimCommand: { type: "set-strength", channel: "both", value: 20 },
        choices: [{ label: "Bereit f\u00fcr mehr", next: "rising" }],
        autoAdvance: { next: "rising", delaySec: 15 },
        isEnd: false,
      },
      rising: {
        narrative: `Die Intensit\u00e4t steigt. Achte auf deinen Atem.`,
        stimCommand: { type: "set-strength", channel: "both", value: 45 },
        choices: [{ label: "Weiter", next: "edge" }],
        autoAdvance: { next: "edge", delaySec: 20 },
        isEnd: false,
      },
      edge: {
        narrative: "Du bist nah dran. Halte durch oder zieh zur\u00fcck.",
        stimCommand: { type: "set-strength", channel: "both", value: 75 },
        choices: [
          { label: "Durchhalten", next: "climax" },
          { label: "Zur\u00fcckziehen", next: "cooldown" },
        ],
        autoAdvance: null,
        isEnd: false,
      },
      climax: {
        narrative: "Du hast es geschafft. Tiefes Durchatmen.",
        stimCommand: { type: "set-strength", channel: "both", value: 30 },
        choices: [{ label: "Ende", next: "end_relax" }],
        autoAdvance: { next: "end_relax", delaySec: 10 },
        isEnd: false,
      },
      cooldown: {
        narrative: "Du hast dich zur\u00fcckgezogen. Respekt.",
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      },
      end_relax: {
        narrative: `Abschluss. Die Spannung flie\u00dft ab.`,
        stimCommand: { type: "soft-stop" },
        choices: [],
        autoAdvance: null,
        isEnd: true,
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Storage (custom user stories)
// ---------------------------------------------------------------------------

/**
 * Load custom user stories (built-ins are added on top).
 * @returns {Array}
 */
export function loadCustomStories() {
  try {
    const raw = localStorage.getItem(STORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist custom stories.
 * @param {Array} list
 */
export function saveCustomStories(list) {
  try {
    localStorage.setItem(STORY_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/**
 * Add a custom story. Validates first.
 * @param {object} story
 * @returns {{ ok: boolean, error?: string, story?: object }}
 */
export function addCustomStory(story) {
  const v = validateStory(story);
  if (!v.ok) return v;
  const list = loadCustomStories();
  const final = { ...story, id: story.id || makeId() };
  // Replace if id exists
  const idx = list.findIndex((s) => s.id === final.id);
  if (idx >= 0) list[idx] = final;
  else list.push(final);
  saveCustomStories(list);
  return { ok: true, story: final };
}

/**
 * Remove a custom story.
 * @param {string} id
 */
export function removeCustomStory(id) {
  const list = loadCustomStories().filter((s) => s.id !== id);
  saveCustomStories(list);
}

/**
 * List all stories (built-in + custom).
 * @returns {Array}
 */
export function listStories() {
  return [...BUILTIN_STORIES, ...loadCustomStories()];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a story object.
 * @param {any} story
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateStory(story) {
  if (!story || typeof story !== "object") return { ok: false, error: "Story fehlt" };
  if (typeof story.title !== "string" || !story.title.trim()) {
    return { ok: false, error: "title fehlt" };
  }
  if (typeof story.startScene !== "string" || !story.startScene) {
    return { ok: false, error: "startScene fehlt" };
  }
  if (!story.scenes || typeof story.scenes !== "object") {
    return { ok: false, error: "scenes fehlt" };
  }
  if (!story.scenes[story.startScene]) {
    return { ok: false, error: `startScene "${story.startScene}" nicht in scenes` };
  }
  // Each scene validates
  for (const [id, scene] of Object.entries(story.scenes)) {
    const r = validateScene(scene, id);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Validate a single scene.
 * @param {any} scene
 * @param {string} id
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateScene(scene, id) {
  if (!scene || typeof scene !== "object") {
    return { ok: false, error: `Scene "${id}" fehlt` };
  }
  if (typeof scene.narrative !== "string") {
    return { ok: false, error: `Scene "${id}".narrative fehlt` };
  }
  // stimCommand optional
  if (scene.stimCommand !== null && scene.stimCommand !== undefined) {
    const r = validateStimCommand(scene.stimCommand, `Scene "${id}".stimCommand`);
    if (!r.ok) return r;
  }
  // choices must be array
  if (scene.choices !== undefined && !Array.isArray(scene.choices)) {
    return { ok: false, error: `Scene "${id}".choices muss Array sein` };
  }
  // Each choice validates
  if (Array.isArray(scene.choices)) {
    for (let i = 0; i < scene.choices.length; i++) {
      const c = scene.choices[i];
      if (!c || typeof c.label !== "string" || typeof c.next !== "string") {
        return { ok: false, error: `Scene "${id}".choices[${i}] benötigt label + next` };
      }
    }
  }
  // autoAdvance optional
  if (scene.autoAdvance !== null && scene.autoAdvance !== undefined) {
    if (
      !scene.autoAdvance ||
      typeof scene.autoAdvance.next !== "string" ||
      typeof scene.autoAdvance.delaySec !== "number"
    ) {
      return { ok: false, error: `Scene "${id}".autoAdvance benötigt next + delaySec` };
    }
  }
  return { ok: true };
}

/**
 * Validate a stimCommand object.
 * @param {any} cmd
 * @param {string} label
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateStimCommand(cmd, label = "stimCommand") {
  if (!cmd || typeof cmd !== "object") return { ok: false, error: `${label} fehlt` };
  const validTypes = ["set-strength", "set-frequency", "soft-stop"];
  if (!validTypes.includes(cmd.type)) {
    return { ok: false, error: `${label}.type ungültig: ${cmd.type}` };
  }
  if (cmd.type === "set-strength" || cmd.type === "set-frequency") {
    if (!["A", "B", "both"].includes(cmd.channel)) {
      return { ok: false, error: `${label}.channel muss A/B/both sein` };
    }
    if (typeof cmd.value !== "number") {
      return { ok: false, error: `${label}.value muss Zahl sein` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Start a story from its startScene (or saved progress if available).
 * @param {string} storyId
 * @returns {{ ok: boolean, error?: string }}
 */
export function startStory(storyId) {
  stopStory("start-new");
  const story = listStories().find((s) => s.id === storyId);
  if (!story) return { ok: false, error: "Story nicht gefunden" };
  activeStory = story;
  // Resume from saved progress if any
  const progress = loadProgress();
  currentSceneId = progress[storyId] || story.startScene;
  // Validate resume point
  if (!story.scenes[currentSceneId]) {
    currentSceneId = story.startScene;
  }
  enterScene(currentSceneId);
  return { ok: true };
}

/**
 * Stop the active story. Cancels timers, soft-stops output (story-controlled).
 */
export function stopStory(reason = "manuell") {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  if (activeStory) {
    log(`Story „${activeStory.title}" gestoppt (${reason}).`, "info");
  }
  activeStory = null;
  currentSceneId = null;
  if (onSceneChangeCallback) {
    try {
      onSceneChangeCallback(null);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Make a choice (advance to next scene). Validates choice index.
 * @param {number} choiceIdx
 * @returns {{ ok: boolean, error?: string }}
 */
export function makeChoice(choiceIdx) {
  if (!activeStory || currentSceneId === null) {
    return { ok: false, error: "Keine Story aktiv" };
  }
  const scene = activeStory.scenes[currentSceneId];
  if (!scene || !Array.isArray(scene.choices)) {
    return { ok: false, error: "Aktuelle Scene hat keine Choices" };
  }
  const choice = scene.choices[choiceIdx];
  if (!choice) return { ok: false, error: "Choice-Index ungültig" };
  // Cancel auto-advance if running
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  // Apply choice's stimCommand (optional override)
  if (choice.stimCommand) {
    executeStimCommand(choice.stimCommand);
  }
  // Move to next scene
  if (!activeStory.scenes[choice.next]) {
    return { ok: false, error: `Ziel-Scene "${choice.next}" existiert nicht` };
  }
  enterScene(choice.next);
  return { ok: true };
}

/**
 * Enter a scene: play narrative + stimCommand + set up auto-advance.
 * @param {string} sceneId
 */
function enterScene(sceneId) {
  currentSceneId = sceneId;
  saveProgress(activeStory.id, sceneId);
  const scene = activeStory.scenes[sceneId];
  if (!scene) {
    log(`Story-Fehler: Scene "${sceneId}" nicht gefunden.`, "error");
    stopStory("missing-scene");
    return;
  }
  // Show narrative
  log(`📖 ${activeStory.title}: ${scene.narrative}`, "info");
  // Apply stimCommand
  if (scene.stimCommand) {
    executeStimCommand(scene.stimCommand);
  }
  // Notify UI
  if (onSceneChangeCallback) {
    try {
      onSceneChangeCallback({
        story: activeStory,
        scene,
        sceneId,
        choices: scene.choices || [],
        isEnd: !!scene.isEnd,
      });
    } catch {
      /* ignore */
    }
  }
  // Schedule auto-advance
  if (scene.autoAdvance && activeStory.scenes[scene.autoAdvance.next]) {
    autoAdvanceTimer = setTimeout(
      () => {
        autoAdvanceTimer = null;
        enterScene(scene.autoAdvance.next);
      },
      Math.max(500, scene.autoAdvance.delaySec * 1000)
    );
  }
}

/**
 * Execute a stimCommand (centralized so AI-generated scenes go through the
 * same validation as built-in ones).
 * @param {object} cmd
 */
function executeStimCommand(cmd) {
  const v = validateStimCommand(cmd);
  if (!v.ok) {
    log(`stimCommand übersprungen: ${v.error}`, "warning");
    return;
  }
  try {
    switch (cmd.type) {
      case "set-strength": {
        const val = cmd.value;
        if (cmd.channel === "A") updateSlidersA(val);
        else if (cmd.channel === "B") updateSlidersB(val);
        else {
          updateSlidersA(val);
          updateSlidersB(val);
        }
        break;
      }
      case "set-frequency": {
        if (cmd.channel === "A") setChannelFreq("A", cmd.value);
        else if (cmd.channel === "B") setChannelFreq("B", cmd.value);
        else {
          setChannelFreq("A", cmd.value);
          setChannelFreq("B", cmd.value);
        }
        break;
      }
      case "soft-stop":
        sendSoftStop({ keepStrength: false });
        break;
    }
  } catch (err) {
    log(`stimCommand Fehler: ${err.message}`, "error");
  }
}

/**
 * Register a callback fired whenever a scene is entered (or story stops).
 * @param {(state: object|null) => void} fn
 */
export function onSceneChange(fn) {
  onSceneChangeCallback = fn;
}

/**
 * Get the current story state snapshot.
 * @returns {object|null}
 */
export function getCurrentState() {
  if (!activeStory || currentSceneId === null) return null;
  const scene = activeStory.scenes[currentSceneId];
  if (!scene) return null;
  return {
    storyId: activeStory.id,
    storyTitle: activeStory.title,
    sceneId: currentSceneId,
    narrative: scene.narrative,
    choices: scene.choices || [],
    isEnd: !!scene.isEnd,
    hasAutoAdvance: !!scene.autoAdvance,
  };
}

// ---------------------------------------------------------------------------
// Progress persistence (so user can resume a half-played story)
// ---------------------------------------------------------------------------

/**
 * @returns {Record<string, string>} storyId → sceneId
 */
export function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Save current scene as progress for a story.
 * @param {string} storyId
 * @param {string} sceneId
 */
export function saveProgress(storyId, sceneId) {
  const all = loadProgress();
  all[storyId] = sceneId;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/**
 * Reset progress for a story (or all).
 * @param {string} [storyId] if omitted, clears ALL progress
 */
export function resetProgress(storyId) {
  if (!storyId) {
    try {
      localStorage.removeItem(PROGRESS_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const all = loadProgress();
  delete all[storyId];
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// AI scene generation
// ---------------------------------------------------------------------------

/**
 * Build a prompt for the LLM to generate a single new scene.
 * Pure helper — for testing.
 * @param {string} theme
 * @param {string} currentScene
 * @param {Array<string>} visitedScenes
 * @returns {string}
 */
export function buildSceneGenPrompt(theme, currentScene, visitedScenes = []) {
  return [
    `Du bist ein Story-Engine für eine E-Stim-App. Generiere eine neue Szene für das Thema „${theme}".`,
    `Bisher besuchte Szenen: ${visitedScenes.join(", ") || "(keine)"}.`,
    `Aktuelle Szene: ${currentScene || "(Beginn)"}.`,
    ``,
    `Antworte NUR mit JSON in diesem Format:`,
    `{`,
    `  "narrative": "...",`,
    `  "stimCommand": { "type": "set-strength" | "set-frequency" | "soft-stop", "channel": "A"|"B"|"both", "value": 0-200 } | null,`,
    `  "choices": [ { "label": "...", "next": "next_a" }, { "label": "...", "next": "next_b" } ],`,
    `  "autoAdvance": { "next": "...", "delaySec": 30 } | null,`,
    `  "isEnd": false`,
    `}`,
  ].join("\n");
}

/**
 * Parse + validate the LLM's JSON response into a scene object.
 * @param {string} rawText
 * @returns {{ ok: boolean, error?: string, scene?: object }}
 */
export function parseAiScene(rawText) {
  if (typeof rawText !== "string") return { ok: false, error: "Kein String" };
  // Strip ```json ... ``` fences
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { ok: false, error: `JSON-Parsing: ${err.message}` };
  }
  const r = validateScene(parsed, "_ai_generated");
  if (!r.ok) return { ok: false, error: `Validierung: ${r.error}` };
  return { ok: true, scene: parsed };
}

function makeId() {
  return "story_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
