// i18n.test.js — annotation-driven translation (DE ↔ EN).
import "./helpers/dom-mock.js";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FakeElement } from "./helpers/dom-mock.js";
import { I18N, MAP, i18nText } from "../../frontend/js/modules/i18n.js";

/** Build an element and attach it to document.body. */
function el(tag, { text = "", attrs = {} } = {}) {
  const node = new FakeElement(tag);
  node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  document.body.appendChild(node);
  return node;
}

function reset() {
  document.body.children.length = 0;
  I18N.setLang("de");
}

describe("i18n — MAP integrity", () => {
  test("every entry has key, de and en", () => {
    for (const e of MAP) {
      assert.equal(typeof e.key, "string", `key missing: ${JSON.stringify(e)}`);
      assert.ok(e.key.length > 0);
      assert.equal(typeof e.de, "string", `de missing for ${e.key}`);
      assert.equal(typeof e.en, "string", `en missing for ${e.key}`);
    }
  });

  test("keys are unique", () => {
    const seen = new Set();
    const dupes = [];
    for (const e of MAP) {
      if (seen.has(e.key)) dupes.push(e.key);
      seen.add(e.key);
    }
    assert.deepEqual(dupes, [], `duplicate keys: ${dupes.join(", ")}`);
  });
});

describe("i18n — annotated elements", () => {
  beforeEach(reset);
  afterEach(reset);

  test("translates data-i18n text to English and back", () => {
    const node = el("button", { text: "Trennen", attrs: { "data-i18n": "btn_disconnect" } });

    I18N.setLang("en");
    assert.equal(node.textContent, "Disconnect");

    I18N.setLang("de");
    assert.equal(node.textContent, "Trennen");
  });

  test("keeps an icon prefix intact", () => {
    const node = el("button", { text: "🛑 STOPP", attrs: { "data-i18n": "btn_panic" } });
    I18N.setLang("en");
    assert.equal(node.textContent, "🛑 STOP");
    I18N.setLang("de");
    assert.equal(node.textContent, "🛑 STOPP");
  });

  test("does not grow the panic button on repeated apply in German", () => {
    // Regression: up to v4.0.3 the substring walker matched the English "STOP"
    // inside the German "STOPP" and substituted the German form, so every
    // apply() appended another P — "STOPP" → "STOPPP" → "STOPPPP".
    const node = el("button", { text: "🛑 STOPP", attrs: { "data-i18n": "btn_panic" } });
    for (let i = 0; i < 5; i++) I18N.apply();
    assert.equal(node.textContent, "🛑 STOPP");
  });

  test("applying twice is idempotent", () => {
    const node = el("button", { text: "Trennen", attrs: { "data-i18n": "btn_disconnect" } });
    I18N.setLang("en");
    I18N.apply();
    I18N.apply();
    assert.equal(node.textContent, "Disconnect");
  });

  test("an unknown key leaves the element alone", () => {
    const node = el("span", { text: "Custom", attrs: { "data-i18n": "does_not_exist" } });
    I18N.setLang("en");
    assert.equal(node.textContent, "Custom");
  });

  test("does not clobber text that JS has replaced", () => {
    // Regression guard: connection-text ships as "Getrennt" but JS sets it to
    // the live status. Switching language must not reset it to "Disconnected".
    const node = el("span", { text: "Getrennt", attrs: { "data-i18n": "conn_disconnected" } });
    node.textContent = "Verbunden · 87 %";

    I18N.setLang("en");
    assert.equal(node.textContent, "Verbunden · 87 %");
  });
});

describe("i18n — annotated attributes", () => {
  beforeEach(reset);
  afterEach(reset);

  test("translates title", () => {
    const entry = MAP.find((e) => e.key === "title_panic");
    const node = el("button", {
      text: "🛑",
      attrs: { title: entry.de, "data-i18n-title": "title_panic" },
    });
    I18N.setLang("en");
    assert.equal(node.getAttribute("title"), entry.en);
    I18N.setLang("de");
    assert.equal(node.getAttribute("title"), entry.de);
  });

  test("translates placeholder", () => {
    const entry = MAP.find((e) => e.key === "ai_placeholder");
    const node = el("input", {
      attrs: { placeholder: entry.de, "data-i18n-placeholder": "ai_placeholder" },
    });
    I18N.setLang("en");
    assert.equal(node.getAttribute("placeholder"), entry.en);
  });

  test("translates aria-label", () => {
    const entry = MAP.find((e) => e.key === "aria_panic");
    const node = el("button", {
      attrs: { "aria-label": entry.de, "data-i18n-aria-label": "aria_panic" },
    });
    I18N.setLang("en");
    assert.equal(node.getAttribute("aria-label"), entry.en);
  });
});

describe("i18n — runtime text fallback", () => {
  beforeEach(reset);
  afterEach(reset);

  test("translates an unannotated node on exact match", () => {
    const node = el("div", { text: "Verbunden" });
    const entry = MAP.find((e) => e.de === "Verbunden");
    I18N.setLang("en");
    assert.equal(node.textContent, entry.en);
  });

  test("leaves a partial match untouched", () => {
    // The old substring walker rewrote fragments inside longer sentences.
    const node = el("div", { text: "Der Status lautet: Verbunden mit Coyote" });
    I18N.setLang("en");
    assert.equal(node.textContent, "Der Status lautet: Verbunden mit Coyote");
  });
});

describe("i18n — language state", () => {
  beforeEach(reset);
  afterEach(reset);

  test("persists the choice to localStorage", () => {
    I18N.setLang("en");
    assert.equal(localStorage.getItem("stim_app_lang"), "en");
    I18N.setLang("de");
    assert.equal(localStorage.getItem("stim_app_lang"), "de");
  });

  test("ignores an unsupported language", () => {
    I18N.setLang("en");
    I18N.setLang("fr");
    assert.equal(I18N.currentLang, "en");
  });

  test("toggle flips between de and en", () => {
    assert.equal(I18N.currentLang, "de");
    I18N.toggle();
    assert.equal(I18N.currentLang, "en");
    I18N.toggle();
    assert.equal(I18N.currentLang, "de");
  });

  test("i18nText follows the active language", () => {
    I18N.setLang("de");
    assert.equal(i18nText("btn_disconnect"), "Trennen");
    I18N.setLang("en");
    assert.equal(i18nText("btn_disconnect"), "Disconnect");
  });

  test("i18nText falls back for an unknown key", () => {
    assert.equal(i18nText("nope", "Fallback"), "Fallback");
    assert.equal(i18nText("nope"), "nope");
  });
});
