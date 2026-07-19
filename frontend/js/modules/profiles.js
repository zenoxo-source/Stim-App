// profiles.js - Multi-profile system.
//
// A profile is a named snapshot of UI-relevant state: soft limits, master
// scale, frequencies, pulse widths, balances, audio + AI settings. Users can
// create, switch, rename, and delete profiles.
//
// Storage: localStorage "stim_app_profiles_v1" → { active: id, profiles: {id: {...}} }
//
// Cross-platform: pure localStorage + AppState mutation. No platform code.

import { AppState, log } from "../state.js";
import { loadSettings, saveSettings, applySettings } from "./settings.js";

const PROFILES_KEY = "stim_app_profiles_v1";

const DEFAULT_PROFILE_NAME = "Standard";

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} name
 * @property {number} softLimitA
 * @property {number} softLimitB
 * @property {number} masterScale
 * @property {number} frequencyA
 * @property {number} frequencyB
 * @property {number} pulseWidthA
 * @property {number} pulseWidthB
 * @property {number} freqBalanceA
 * @property {number} freqBalanceB
 * @property {number} waveBalanceA
 * @property {number} waveBalanceB
 * @property {boolean} swapChannels
 * @property {boolean} audioHearSound
 * @property {number} sensitivityA
 * @property {number} sensitivityB
 * @property {string} aiProvider
 * @property {string} aiEndpoint
 * @property {string} aiModel
 * @property {string} aiSystemPrompt
 */

/** Generate a stable unique id. */
function makeId() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Snapshot the current AppState + AI settings into a profile object.
 * @param {string} name
 * @returns {Profile}
 */
export function snapshotCurrentState(name) {
  const s = loadSettings();
  return {
    id: makeId(),
    name: name || DEFAULT_PROFILE_NAME,
    softLimitA: AppState.softLimitA,
    softLimitB: AppState.softLimitB,
    masterScale: AppState.masterScale,
    frequencyA: AppState.frequencyA,
    frequencyB: AppState.frequencyB,
    pulseWidthA: AppState.pulseWidthA,
    pulseWidthB: AppState.pulseWidthB,
    freqBalanceA: AppState.freqBalanceA,
    freqBalanceB: AppState.freqBalanceB,
    waveBalanceA: AppState.waveBalanceA,
    waveBalanceB: AppState.waveBalanceB,
    swapChannels: AppState.swapChannels,
    audioHearSound: AppState.audioHearSound,
    sensitivityA: AppState.sensitivityA,
    sensitivityB: AppState.sensitivityB,
    aiProvider: s.aiProvider,
    aiEndpoint: s.aiEndpoint,
    aiModel: s.aiModel,
    aiSystemPrompt: s.aiSystemPrompt,
  };
}

/**
 * Load the profiles map from storage.
 * @returns {{ active: string, profiles: Record<string, Profile> }}
 */
export function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) {
      // First-run: create a default profile from current state
      const def = snapshotCurrentState(DEFAULT_PROFILE_NAME);
      const initial = { active: def.id, profiles: { [def.id]: def } };
      saveProfiles(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.profiles) {
      throw new Error("invalid profiles format");
    }
    return parsed;
  } catch {
    const def = snapshotCurrentState(DEFAULT_PROFILE_NAME);
    const initial = { active: def.id, profiles: { [def.id]: def } };
    saveProfiles(initial);
    return initial;
  }
}

/**
 * Persist profiles map.
 * @param {{ active: string, profiles: Record<string, Profile> }} data
 */
export function saveProfiles(data) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Failed to save profiles:", err);
  }
}

/**
 * Get the active profile (or null if none).
 * @returns {Profile|null}
 */
export function getActiveProfile() {
  const data = loadProfiles();
  return data.profiles[data.active] ?? null;
}

/**
 * Create a new profile from the current AppState. Switches to it.
 * @param {string} name
 * @returns {Profile}
 */
export function createProfile(name) {
  const data = loadProfiles();
  const profile = snapshotCurrentState(name);
  data.profiles[profile.id] = profile;
  data.active = profile.id;
  saveProfiles(data);
  log(`Profil „${name}" erstellt.`, "success");
  return profile;
}

/**
 * Update the active profile's stored snapshot to match the current AppState.
 * Useful when the user changes soft-limits etc. and wants them saved into the
 * active profile.
 * @returns {Profile|null}
 */
export function updateActiveProfile() {
  const data = loadProfiles();
  const current = data.profiles[data.active];
  if (!current) return null;
  const snap = snapshotCurrentState(current.name);
  snap.id = current.id;
  data.profiles[current.id] = snap;
  saveProfiles(data);
  log(`Profil „${current.name}" aktualisiert.`, "info");
  return snap;
}

/**
 * Switch to a different profile by id. Applies the profile's state.
 * @param {string} id
 * @returns {{ ok: boolean, error?: string }}
 */
export function switchProfile(id) {
  const data = loadProfiles();
  const profile = data.profiles[id];
  if (!profile) return { ok: false, error: "Profil nicht gefunden" };
  data.active = id;
  saveProfiles(data);
  applyProfileToState(profile);
  log(`Profil „${profile.name}" aktiviert.`, "success");
  return { ok: true };
}

/**
 * Rename a profile.
 * @param {string} id
 * @param {string} newName
 */
export function renameProfile(id, newName) {
  const data = loadProfiles();
  const profile = data.profiles[id];
  if (!profile) return;
  profile.name = newName || profile.name;
  saveProfiles(data);
}

/**
 * Delete a profile. Refuses to delete the last remaining one.
 * @param {string} id
 * @returns {{ ok: boolean, error?: string }}
 */
export function deleteProfile(id) {
  const data = loadProfiles();
  if (Object.keys(data.profiles).length <= 1) {
    return { ok: false, error: "Das letzte Profil kann nicht gelöscht werden." };
  }
  delete data.profiles[id];
  if (data.active === id) {
    data.active = Object.keys(data.profiles)[0];
    applyProfileToState(data.profiles[data.active]);
  }
  saveProfiles(data);
  log("Profil gelöscht.", "info");
  return { ok: true };
}

/**
 * Apply a profile's values to AppState + DOM inputs.
 * @param {Profile} profile
 */
function applyProfileToState(profile) {
  AppState.softLimitA = profile.softLimitA;
  AppState.softLimitB = profile.softLimitB;
  AppState.masterScale = profile.masterScale;
  AppState.frequencyA = profile.frequencyA;
  AppState.frequencyB = profile.frequencyB;
  AppState.pulseWidthA = profile.pulseWidthA;
  AppState.pulseWidthB = profile.pulseWidthB;
  AppState.freqBalanceA = profile.freqBalanceA;
  AppState.freqBalanceB = profile.freqBalanceB;
  AppState.waveBalanceA = profile.waveBalanceA;
  AppState.waveBalanceB = profile.waveBalanceB;
  AppState.swapChannels = profile.swapChannels;
  AppState.audioHearSound = profile.audioHearSound;
  AppState.sensitivityA = profile.sensitivityA;
  AppState.sensitivityB = profile.sensitivityB;
  // Apply via settings pipeline so all DOM inputs (sliders, labels) update
  try {
    applySettings({
      ...profile,
      aiApiKey: "",
    });
    saveSettings();
  } catch (err) {
    console.warn("Profile applySettings failed:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Initialize default profile if first run
  loadProfiles();
});
