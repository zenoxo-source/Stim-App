// midi-controller.js - Web MIDI API integration.
//
// Lets a hardware MIDI controller (Korg nanoKONTROL, Akai LPD8, etc.) drive
// strength, frequency, master scale, or trigger patterns.
//
// Cross-Platform notes:
//   - macOS + Windows: native OS-level MIDI in Chromium
//   - Linux: Chromium uses ALSA. User must have read access to /dev/snd/*
//     (typically in the `audio` group).
//
// Mapping format:
//   {
//     id: "midi_<inputName>_<cc>",
//     inputName: "nanoKONTROL Studio",  // matches MIDIInput.name (substring match)
//     channel: 0,                        // 0-15, or -1 for any
//     type: "cc" | "note" | "program",
//     number: 0,                         // CC number, note number, or program number
//     action: {
//       type: "set-strength" | "set-frequency" | "set-master" | "trigger-pattern" | "stop-pattern",
//       channel: "A" | "B" | "both",     // for strength/frequency
//       min: 0, max: 200,                // 7-bit MIDI value mapping range
//       patternName: "wave",             // for trigger-pattern
//     },
//     enabled: true,
//   }
//
// All mapping logic is pure (testable). Actual MIDI access happens via
// navigator.requestMIDIAccess which we mock in tests.

import { AppState, DOM, log } from "../state.js";
import { updateSlidersA, updateSlidersB, setChannelFreq } from "../control-deck.js";

const MAPPING_KEY = "stim_app_midi_mappings_v1";

let midiAccess = null;
let active = false;

// ---------------------------------------------------------------------------
// Mapping storage
// ---------------------------------------------------------------------------

/**
 * Load all stored mappings.
 * @returns {Array}
 */
export function loadMappings() {
  try {
    const raw = localStorage.getItem(MAPPING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist mappings.
 * @param {Array} list
 */
export function saveMappings(list) {
  try {
    localStorage.setItem(MAPPING_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Pure mapping logic (testable)
// ---------------------------------------------------------------------------

/**
 * Validate a single mapping.
 * @param {any} m
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateMapping(m) {
  if (!m || typeof m !== "object") return { ok: false, error: "Mapping fehlt" };
  if (!m.type || !["cc", "note", "program"].includes(m.type)) {
    return { ok: false, error: `type muss cc/note/program sein` };
  }
  if (typeof m.number !== "number" || m.number < 0 || m.number > 127) {
    return { ok: false, error: "number muss 0–127 sein" };
  }
  if (!m.action || !m.action.type) {
    return { ok: false, error: "action.type fehlt" };
  }
  const validActions = [
    "set-strength",
    "set-frequency",
    "set-master",
    "trigger-pattern",
    "stop-pattern",
  ];
  if (!validActions.includes(m.action.type)) {
    return { ok: false, error: `action.type unbekannt: ${m.action.type}` };
  }
  if (
    (m.action.type === "set-strength" || m.action.type === "set-frequency") &&
    !["A", "B", "both"].includes(m.action.channel || "")
  ) {
    return { ok: false, error: "action.channel muss A/B/both sein" };
  }
  if (m.action.type === "trigger-pattern" && !m.action.patternName) {
    return { ok: false, error: "action.patternName fehlt" };
  }
  if (m.channel !== undefined && m.channel !== null) {
    if (typeof m.channel !== "number" || m.channel < -1 || m.channel > 15) {
      return { ok: false, error: "channel muss -1 (any) oder 0–15 sein" };
    }
  }
  return { ok: true };
}

/**
 * Normalize a 7-bit MIDI value (0–127) into a target range.
 * Pure helper for testing.
 * @param {number} midiValue 0–127
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function mapMidiToRange(midiValue, min, max) {
  const v = Math.max(0, Math.min(127, Math.round(Number(midiValue) || 0)));
  const lo = Math.min(Math.max(0, Number(min) || 0), Number(max) || 0);
  const hi = Math.max(lo, Math.min(200, Number(max) || 0));
  if (hi === lo) return lo;
  return Math.round(lo + ((hi - lo) * v) / 127);
}

/**
 * Decide whether a raw MIDI message matches a mapping.
 * Pure helper.
 * @param {Uint8Array} message  raw MIDI bytes
 * @param {object} mapping
 * @param {string} inputName current input's name
 * @returns {{ match: boolean, value?: number }}
 */
export function matchMessage(message, mapping, inputName) {
  if (!message || message.length < 2) return { match: false };
  if (!mapping || mapping.enabled === false) return { match: false };
  if (mapping.inputName && inputName && !inputName.includes(mapping.inputName)) {
    return { match: false };
  }
  const status = message[0];
  const data1 = message[1];
  const data2 = message.length > 2 ? message[2] : 0;
  const msgChannel = status & 0x0f;
  // High nibble of status byte (after stripping channel) — values:
  //   8 = Note Off, 9 = Note On, 11 = CC, 12 = Program Change
  const msgType = (status & 0xf0) >> 4;

  // Channel filter
  if (typeof mapping.channel === "number" && mapping.channel !== -1) {
    if (mapping.channel !== msgChannel) return { match: false };
  }

  // Type filter
  if (mapping.type === "cc") {
    if (msgType !== 11) return { match: false };
    if (mapping.number !== data1) return { match: false };
    return { match: true, value: data2 };
  }
  if (mapping.type === "note") {
    if (msgType !== 9 && msgType !== 8) return { match: false };
    if (mapping.number !== data1) return { match: false };
    // Note On with velocity > 0 = trigger; velocity 0 = Note Off
    return { match: msgType === 9 && data2 > 0, value: data2 };
  }
  if (mapping.type === "program") {
    if (msgType !== 12) return { match: false };
    if (mapping.number !== data1) return { match: false };
    return { match: true, value: data1 };
  }
  return { match: false };
}

/**
 * Apply a mapping's action for a given MIDI value.
 * @param {object} mapping
 * @param {number} value 7-bit MIDI value (0–127)
 */
export function applyMapping(mapping, value) {
  const a = mapping.action;
  switch (a.type) {
    case "set-strength": {
      const target = mapMidiToRange(
        value,
        a.min !== undefined ? a.min : 0,
        a.max !== undefined ? a.max : 200
      );
      if (a.channel === "A") {
        updateSlidersA(target);
      } else if (a.channel === "B") {
        updateSlidersB(target);
      } else {
        // both
        updateSlidersA(target);
        updateSlidersB(target);
      }
      return true;
    }
    case "set-frequency": {
      const target = mapMidiToRange(
        value,
        a.min !== undefined ? a.min : 10,
        a.max !== undefined ? a.max : 240
      );
      if (a.channel === "A") setChannelFreq("A", target);
      else if (a.channel === "B") setChannelFreq("B", target);
      else {
        setChannelFreq("A", target);
        setChannelFreq("B", target);
      }
      return true;
    }
    case "set-master": {
      const pct = mapMidiToRange(value, 0, 100);
      AppState.masterScale = pct / 100;
      const slider = document.getElementById("slider-master");
      const label = document.getElementById("master-val-text");
      if (slider) slider.value = pct;
      if (label) label.textContent = pct + "%";
      return true;
    }
    case "trigger-pattern": {
      const card = document.querySelector(`.pattern-card[data-pattern="${a.patternName}"]`);
      card?.click();
      return !!card;
    }
    case "stop-pattern": {
      DOM["btn-stop-pattern"]?.click();
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Web MIDI API access
// ---------------------------------------------------------------------------

/**
 * Initialize Web MIDI access. Idempotent.
 * @returns {Promise<{ ok: boolean, error?: string, inputs?: string[] }>}
 */
export async function initMidi() {
  if (!navigator || typeof navigator.requestMIDIAccess !== "function") {
    return { ok: false, error: "Web MIDI API nicht verfügbar (Browser zu alt?)" };
  }
  if (midiAccess) return { ok: true, inputs: listInputNames() };
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    attachToInputs();
    midiAccess.onstatechange = () => attachToInputs();
    active = true;
    log(`MIDI initialisiert (${midiAccess.inputs.size} Input-Geräte).`, "success");
    return { ok: true, inputs: listInputNames() };
  } catch (err) {
    return { ok: false, error: `MIDI-Zugriff verweigert: ${err.message}` };
  }
}

/**
 * List connected MIDI input device names.
 * @returns {string[]}
 */
export function listInputNames() {
  if (!midiAccess) return [];
  const names = [];
  midiAccess.inputs.forEach((input) => names.push(input.name));
  return names;
}

/**
 * Attach the global MIDI message handler to all current inputs.
 */
function attachToInputs() {
  if (!midiAccess) return;
  midiAccess.inputs.forEach((input) => {
    if (input._stimAttached) return;
    input._stimAttached = true;
    input.onmidimessage = handleMidiMessage;
  });
}

/**
 * Global MIDI message handler. Looks up mappings and applies the first match.
 * @param {WebMidiMIDIMessageEvent} event
 */
function handleMidiMessage(event) {
  if (!active) return;
  const data = event.data;
  if (!data || data.length < 2) return;
  const inputName = event.target?.name || "";
  const mappings = loadMappings();
  for (const mapping of mappings) {
    if (mapping.enabled === false) continue;
    const result = matchMessage(data, mapping, inputName);
    if (result.match) {
      try {
        applyMapping(mapping, result.value ?? 0);
      } catch (err) {
        console.warn("MIDI mapping failed:", err);
      }
      return; // only first match fires
    }
  }
}

/**
 * Disable MIDI message processing (settings still loaded).
 */
export function disableMidi() {
  active = false;
}

/**
 * Re-enable MIDI message processing.
 */
export function enableMidi() {
  if (midiAccess) active = true;
}

/** @returns {boolean} */
export function isMidiActive() {
  return active;
}

/**
 * Add a new mapping. Validates + persists.
 * @param {object} mapping
 * @returns {{ ok: boolean, error?: string, mapping?: object }}
 */
export function addMapping(mapping) {
  const v = validateMapping(mapping);
  if (!v.ok) return v;
  const list = loadMappings();
  const final = {
    id: mapping.id || "midi_" + Date.now().toString(36),
    inputName: mapping.inputName || "",
    channel: typeof mapping.channel === "number" ? mapping.channel : -1,
    type: mapping.type,
    number: mapping.number,
    action: mapping.action,
    enabled: mapping.enabled !== false,
  };
  list.push(final);
  saveMappings(list);
  return { ok: true, mapping: final };
}

/**
 * Update a mapping by id.
 * @param {string} id
 * @param {Partial<object>} patch
 * @returns {boolean}
 */
export function updateMapping(id, patch) {
  const list = loadMappings();
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...patch };
  saveMappings(list);
  return true;
}

/**
 * Remove a mapping.
 * @param {string} id
 */
export function removeMapping(id) {
  const list = loadMappings().filter((m) => m.id !== id);
  saveMappings(list);
}

document.addEventListener("DOMContentLoaded", () => {
  // Don't auto-init — user opts in via UI to avoid surprising permission prompts.
});
