/**
 * Tests for v4.0 nav-shell settings progressive disclosure.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/dom-mock.js";
import { reorganizeSettingsLayout } from "../../frontend/js/modules/nav-shell.js";

function card(titleText) {
  const c = document.createElement("div");
  c.className = "card";
  const t = document.createElement("div");
  t.className = "card-title";
  t.textContent = titleText;
  c.appendChild(t);
  return c;
}

beforeEach(() => {
  document.body.innerHTML = "";
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("nav-shell reorganizeSettingsLayout", () => {
  it("moves non-core cards under Erweitert", () => {
    const section = document.createElement("section");
    section.id = "view-settings";
    const layout = document.createElement("div");
    layout.className = "settings-layout";
    const grid = document.createElement("div");
    grid.className = "grid-2";
    [
      "Sicherheit",
      "Wellenform-Balance (Gerät)",
      "Gerät",
      "App",
      "Profile",
      "MIDI-Controller",
      "App-Updates",
      "Über Stim App",
    ].forEach((t) => grid.appendChild(card(t)));
    layout.appendChild(grid);
    section.appendChild(layout);
    document.body.appendChild(section);

    reorganizeSettingsLayout(layout);

    const details = [...layout.children].find((c) => c.tagName === "DETAILS");
    assert.ok(details, "advanced details exists");
    assert.equal(details.className, "settings-advanced");
    const core = [...layout.children].find((c) => String(c.className).includes("settings-core"));
    assert.ok(core);
    assert.equal(core.children.length, 4);
    const footer = [...layout.children].find((c) => String(c.className).includes("settings-footer"));
    assert.ok(footer);
    assert.equal(footer.children.length, 2);
    const footerTitles = footer.children.flatMap((c) =>
      [...(c.children || [])].map((ch) => ch.textContent || "")
    );
    assert.ok(footerTitles.some((t) => t.includes("App-Updates")));
  });

  it("is idempotent", () => {
    const layout = document.createElement("div");
    layout.className = "settings-layout";
    const grid = document.createElement("div");
    grid.className = "grid-2";
    grid.appendChild(card("Sicherheit"));
    grid.appendChild(card("App"));
    grid.appendChild(card("Profile"));
    layout.appendChild(grid);

    reorganizeSettingsLayout(layout);
    reorganizeSettingsLayout(layout);
    const details = layout.children.filter((c) => c.tagName === "DETAILS");
    assert.equal(details.length, 1);
  });
});
