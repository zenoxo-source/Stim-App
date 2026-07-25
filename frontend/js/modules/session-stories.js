// session-stories.js — Guided multi-step session templates

import { startAutodrive } from "./autodrive.js";
import { applyStimAudioPreset } from "./stim-player.js";
import { log } from "../state.js";

/**
 * Story definitions: narrative + autodrive/stim config.
 */
export const SESSION_STORIES = Object.freeze({
  quick_evening: {
    id: "quick_evening",
    label: "5 Min Quick",
    description: "Kurz & direkt — Turbo-Autodrive",
    run() {
      return startAutodrive({
        templateId: "turbo",
        storyId: "quick_evening",
        skipCalibration: true,
        hybridAudio: false,
      });
    },
  },
  edge_night: {
    id: "edge_night",
    label: "20 Min Edge-Abend",
    description: "Langer Tease, 4 Edges, sanft",
    run() {
      return startAutodrive({
        templateId: "long_tease",
        storyId: "edge_night",
        targetDurationMin: 20,
        hybridAudio: false,
      });
    },
  },
  classic_story: {
    id: "classic_story",
    label: "Klassische Reise",
    description: "12 Min Klassisch mit Fullscreen-Empfehlung",
    run() {
      return startAutodrive({
        templateId: "classic",
        storyId: "classic_story",
        fullscreenPreferred: true,
      });
    },
  },
  stim_then_drive: {
    id: "stim_then_drive",
    label: "STIM + Autodrive Hybrid",
    description: "Audio-Preset „Freq folgt“ + Autodrive steuert Strength-Hülle",
    run() {
      applyStimAudioPreset("freq_follow");
      const r = startAutodrive({
        templateId: "classic",
        storyId: "stim_then_drive",
        hybridAudio: true,
        skipCalibration: true,
      });
      if (r.ok) {
        log("Hybrid: starte Audio im STIM-Tab für Wave/Freq.", "info");
        // Soft prompt to open stim
        setTimeout(() => {
          document.querySelector('.nav-item[data-tab="stim"]')?.click();
        }, 400);
      }
      return r;
    },
  },
  deny_story: {
    id: "deny_story",
    label: "Deny & Release Story",
    description: "Edge → Fast-Abspritzen → Deny → Push",
    run() {
      return startAutodrive({
        templateId: "deny",
        storyId: "deny_story",
      });
    },
  },
  aftercare_wave: {
    id: "aftercare_wave",
    label: "Sanfte STIM-Welle",
    description: "Nur STIM Preset sanft — kein Autodrive",
    run() {
      applyStimAudioPreset("soft_smooth");
      document.querySelector('.nav-item[data-tab="stim"]')?.click();
      log("Sanftes STIM-Preset geladen — Datei wählen und Play.", "success");
      return { ok: true, stimOnly: true };
    },
  },
});

export function listStories() {
  return Object.values(SESSION_STORIES);
}

export function runStory(id) {
  const s = SESSION_STORIES[id];
  if (!s) return { ok: false, error: "Story unbekannt" };
  return s.run();
}
