/**
 * Tests for profiles.js - create, switch, rename, delete profiles.
 *
 * AppState is a singleton; we mutate it before each test. localStorage is
 * cleared between tests so the profile store starts fresh.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/dom-mock.js";
import { AppState } from "../../frontend/js/state.js";
import {
  loadProfiles,
  saveProfiles,
  createProfile,
  switchProfile,
  deleteProfile,
  renameProfile,
  getActiveProfile,
  updateActiveProfile,
  snapshotCurrentState,
} from "../../frontend/js/modules/profiles.js";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  AppState.softLimitA = 100;
  AppState.softLimitB = 100;
  AppState.masterScale = 0.8;
  AppState.frequencyA = 45;
  AppState.frequencyB = 45;
  AppState.pulseWidthA = 100;
  AppState.pulseWidthB = 100;
  AppState.swapChannels = false;
  AppState.audioHearSound = true;
  AppState.sensitivityA = 1.2;
  AppState.sensitivityB = 1.2;
  AppState.freqBalanceA = 160;
  AppState.freqBalanceB = 160;
  AppState.waveBalanceA = 0;
  AppState.waveBalanceB = 0;
});

describe("profiles.js", () => {
  it("loadProfiles initializes with a default on first run", () => {
    const data = loadProfiles();
    assert.ok(data.active);
    assert.equal(Object.keys(data.profiles).length, 1);
    assert.equal(data.profiles[data.active].name, "Standard");
  });

  it("snapshotCurrentState captures AppState", () => {
    AppState.softLimitA = 150;
    AppState.swapChannels = true;
    const snap = snapshotCurrentState("Test");
    assert.equal(snap.softLimitA, 150);
    assert.equal(snap.swapChannels, true);
    assert.equal(snap.name, "Test");
  });

  it("createProfile adds + switches to new profile", () => {
    const before = loadProfiles();
    AppState.softLimitA = 80;
    const p = createProfile("Sanft");
    const after = loadProfiles();
    assert.equal(Object.keys(after.profiles).length, Object.keys(before.profiles).length + 1);
    assert.equal(after.active, p.id);
    assert.equal(after.profiles[p.id].name, "Sanft");
    assert.equal(after.profiles[p.id].softLimitA, 80);
  });

  it("switchProfile applies stored values to AppState", () => {
    AppState.softLimitA = 50;
    createProfile("Low");
    AppState.softLimitA = 200;
    createProfile("High");
    // Switch back to Low
    const data = loadProfiles();
    const lowId = Object.values(data.profiles).find((p) => p.name === "Low").id;
    const r = switchProfile(lowId);
    assert.equal(r.ok, true);
    assert.equal(AppState.softLimitA, 50);
  });

  it("switchProfile rejects unknown id", () => {
    const r = switchProfile("does-not-exist");
    assert.equal(r.ok, false);
  });

  it("renameProfile changes the name", () => {
    const p = createProfile("Test");
    renameProfile(p.id, "Renamed");
    const data = loadProfiles();
    assert.equal(data.profiles[p.id].name, "Renamed");
  });

  it("deleteProfile removes profile", () => {
    const p1 = createProfile("P1");
    const p2 = createProfile("P2");
    const r = deleteProfile(p1.id);
    assert.equal(r.ok, true);
    const data = loadProfiles();
    assert.equal(data.profiles[p1.id], undefined);
    assert.ok(data.profiles[p2.id]);
  });

  it("deleteProfile refuses to delete last profile", () => {
    const data = loadProfiles();
    const onlyId = Object.keys(data.profiles)[0];
    const r = deleteProfile(onlyId);
    assert.equal(r.ok, false);
    assert.match(r.error, /letzte/);
  });

  it("deleteProfile on active switches to another", () => {
    const p1 = createProfile("P1");
    const p2 = createProfile("P2");
    switchProfile(p1.id);
    const r = deleteProfile(p1.id);
    assert.equal(r.ok, true);
    const data = loadProfiles();
    // After deleting the active profile, active must point to a remaining one
    // (could be the auto-created Standard profile or p2, depending on order).
    assert.ok(data.profiles[data.active], "active must reference an existing profile");
    assert.notEqual(data.active, p1.id);
    assert.ok(data.profiles[p2.id], "p2 must still exist");
  });

  it("updateActiveProfile overwrites stored snapshot", () => {
    const p = createProfile("P1");
    AppState.softLimitA = 99;
    updateActiveProfile();
    const data = loadProfiles();
    assert.equal(data.profiles[p.id].softLimitA, 99);
  });

  it("getActiveProfile returns null when missing", () => {
    saveProfiles({ active: "ghost", profiles: {} });
    assert.equal(getActiveProfile(), null);
  });

  it("persists across reload", () => {
    createProfile("Persist");
    // loadProfiles again simulates reload
    const data = loadProfiles();
    const found = Object.values(data.profiles).find((p) => p.name === "Persist");
    assert.ok(found);
  });
});
