// nav-shell.js — v4.0 information architecture: primary vs more nav,
// Manual/STIM control subnav, settings progressive disclosure, session header.

import { isAutodriveActive } from "./autodrive.js";
import { AppState } from "../state.js";
import { getOutputOwner } from "./output-owner.js";

const MORE_TABS = new Set(["editor", "settings"]);
const CONTROL_TABS = new Set(["deck", "stim"]);
const MORE_STORAGE = "stim_app_nav_more_open_v1";
const ADV_STORAGE = "stim_app_settings_adv_open_v1";

/** Programmatic tab switch (same as clicking a nav item). */
export function switchToTab(tabName) {
  const item = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (item) item.click();
}

function isSessionActive() {
  const owner = getOutputOwner();
  return (
    isAutodriveActive() ||
    !!AppState.isAudioPlaying ||
    (owner && owner !== "none") ||
    (AppState.strengthA || 0) > 0 ||
    (AppState.strengthB || 0) > 0
  );
}

export function updateSessionHeaderMode() {
  const active = isSessionActive() && !!AppState.isConnected;
  document.body.classList.toggle("session-active", active);
  const header = document.querySelector(".app-header");
  if (header) header.classList.toggle("header-compact", active);
}

function ensureControlSubnav() {
  let el = document.getElementById("control-subnav");
  if (el) return el;
  const main = document.querySelector(".main-content");
  const header = document.querySelector(".app-header");
  if (!main || !header) return null;
  el = document.createElement("div");
  el.id = "control-subnav";
  el.className = "control-subnav";
  el.hidden = true;
  el.innerHTML = `
    <div class="control-subnav-inner" role="tablist" aria-label="Steuerung">
      <button type="button" class="control-sub-btn" data-sub="deck" role="tab">Manual</button>
      <button type="button" class="control-sub-btn" data-sub="stim" role="tab">STIM Player</button>
    </div>
  `;
  header.insertAdjacentElement("afterend", el);
  el.querySelectorAll("[data-sub]").forEach((btn) => {
    btn.addEventListener("click", () => switchToTab(btn.getAttribute("data-sub")));
  });
  return el;
}

export function updateControlSubnav(activeTab) {
  const el = ensureControlSubnav();
  if (!el) return;
  const show = CONTROL_TABS.has(activeTab);
  el.hidden = !show;
  el.querySelectorAll("[data-sub]").forEach((btn) => {
    const on = btn.getAttribute("data-sub") === activeTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

export function markNavForTab(tabName) {
  document.querySelectorAll(".nav-item").forEach((nav) => {
    nav.classList.toggle("active", nav.getAttribute("data-tab") === tabName);
  });
  // Auto-expand "Mehr" when a secondary tab is active
  if (MORE_TABS.has(tabName)) {
    setMoreOpen(true);
  }
  updateControlSubnav(tabName);
}

function isMoreOpen() {
  try {
    return localStorage.getItem(MORE_STORAGE) !== "0";
  } catch {
    return true;
  }
}

function setMoreOpen(open) {
  const menu = document.getElementById("nav-more-menu");
  const toggle = document.getElementById("nav-more-toggle");
  if (menu) menu.hidden = !open;
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const chev = toggle.querySelector(".nav-chevron");
    if (chev) chev.textContent = open ? "▾" : "▸";
  }
  try {
    localStorage.setItem(MORE_STORAGE, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function wireMoreToggle() {
  const toggle = document.getElementById("nav-more-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  toggle.addEventListener("click", () => {
    const menu = document.getElementById("nav-more-menu");
    const open = menu ? menu.hidden : false;
    setMoreOpen(open);
  });
  setMoreOpen(isMoreOpen());
}

/**
 * Progressive disclosure: core safety cards stay open; power features under Erweitert.
 * @param {HTMLElement | null} [layoutEl] optional root (for tests / early init)
 */
export function reorganizeSettingsLayout(layoutEl = null) {
  const layout =
    layoutEl ||
    document.querySelector?.("#view-settings .settings-layout") ||
    document.getElementById?.("view-settings")?.querySelector?.(".settings-layout");
  if (!layout || layout.dataset?.v4 === "1") return;

  // Collect cards: direct grid children + loose cards under layout
  const collectCards = (root) => {
    const out = [];
    const walk = (el) => {
      if (!el) return;
      const isCard =
        el.classList?.contains?.("card") ||
        (typeof el.className === "string" && el.className.split(/\s+/).includes("card"));
      if (isCard) {
        out.push(el);
        return; // don't descend into card
      }
      for (const ch of el.children || []) walk(ch);
    };
    walk(root);
    return out;
  };

  const allCards = collectCards(layout);
  if (!allCards.length) return;
  layout.dataset.v4 = "1";

  // Group classification: explicit data-settings-group on each card, with the
  // legacy title heuristics for core/footer (kept so tests + older markup work).
  const ADV_GROUPS = [
    { id: "profil", label: "Profil & Steuerung", hint: "Profile · Tastatur-Shortcuts" },
    {
      id: "session",
      label: "Session & Library",
      hint: "Recorder · Scheduler · Abendprogramm · Funscript · Statistik",
    },
    { id: "automation", label: "Automation", hint: "Trigger-System" },
    {
      id: "hardware",
      label: "Hardware & Biofeedback",
      hint: "MIDI · PIN · Herzfrequenz · Buttplug · Shaping",
    },
    { id: "vision", label: "Vision", hint: "Webcam-Vision · LLM-Anbieter" },
    { id: "system", label: "System", hint: "Diagnose-Logs" },
  ];
  const isCoreTitle = (raw) =>
    raw.startsWith("Sicherheit") ||
    raw.startsWith("Wellenform") ||
    raw === "Gerät" ||
    raw.startsWith("Gerät\n") ||
    raw === "App";
  const isFooterTitle = (raw) => raw.startsWith("App-Updates") || raw.startsWith("Über Stim");

  const groupFor = (card, raw) => {
    const explicit = card.dataset?.settingsGroup;
    if (explicit && ADV_GROUPS.some((g) => g.id === explicit)) return explicit;
    if (isCoreTitle(raw)) return "core";
    if (isFooterTitle(raw)) return "footer";
    return "weiteres";
  };

  const byGroup = new Map();
  for (const card of allCards) {
    const titleEl =
      [...(card.children || [])].find((c) => {
        const cn = c.className || "";
        return cn === "card-title" || (typeof cn === "string" && cn.includes("card-title"));
      }) || card.querySelector?.(".card-title");
    const raw = (titleEl?.textContent || "").replace(/\s+/g, " ").trim();
    const g = groupFor(card, raw);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(card);
  }

  // Rebuild layout
  const coreGrid = document.createElement("div");
  coreGrid.className = "grid-2 settings-core";
  (byGroup.get("core") || []).forEach((c) => coreGrid.appendChild(c));

  const details = document.createElement("details");
  details.className = "settings-advanced";
  details.id = "settings-advanced";
  try {
    details.open = localStorage.getItem(ADV_STORAGE) === "1";
  } catch {
    details.open = false;
  }
  details.addEventListener("toggle", () => {
    try {
      localStorage.setItem(ADV_STORAGE, details.open ? "1" : "0");
    } catch {
      /* ignore */
    }
  });

  const summary = document.createElement("summary");
  summary.className = "settings-advanced-summary";
  summary.innerHTML = `<strong>Erweitert</strong>
    <span class="settings-advanced-hint">Profile · Recorder · Trigger · MIDI · Vision · Diagnose</span>`;
  details.appendChild(summary);

  const advGrid = document.createElement("div");
  advGrid.className = "settings-advanced-groups";
  for (const g of ADV_GROUPS) {
    const cards = byGroup.get(g.id) || [];
    if (!cards.length) continue;
    const wrap = document.createElement("div");
    wrap.className = "settings-group";
    const title = document.createElement("div");
    title.className = "settings-group-title";
    title.innerHTML = `<strong>${g.label}</strong><span class="settings-group-hint">${g.hint}</span>`;
    const grid = document.createElement("div");
    grid.className = "grid-2";
    cards.forEach((c) => grid.appendChild(c));
    wrap.appendChild(title);
    wrap.appendChild(grid);
    advGrid.appendChild(wrap);
  }
  const rest = byGroup.get("weiteres") || [];
  if (rest.length) {
    const wrap = document.createElement("div");
    wrap.className = "settings-group";
    const grid = document.createElement("div");
    grid.className = "grid-2";
    rest.forEach((c) => grid.appendChild(c));
    wrap.appendChild(grid);
    advGrid.appendChild(wrap);
  }
  details.appendChild(advGrid);

  const footerWrap = document.createElement("div");
  footerWrap.className = "grid-2 settings-footer";
  (byGroup.get("footer") || []).forEach((c) => footerWrap.appendChild(c));

  // Clear old structure (grid + loose cards)
  while (layout.firstChild) layout.removeChild(layout.firstChild);
  layout.appendChild(coreGrid);
  layout.appendChild(details);
  if (footerWrap.children.length) layout.appendChild(footerWrap);
}

export function initNavShell() {
  wireMoreToggle();
  ensureControlSubnav();
  reorganizeSettingsLayout();

  // Keep header compact while session runs
  setInterval(updateSessionHeaderMode, 500);

  // Sync subnav when any nav item clicked (in addition to control-deck handler)
  document.querySelectorAll(".nav-item[data-tab]").forEach((item) => {
    item.addEventListener("click", () => {
      const tab = item.getAttribute("data-tab");
      markNavForTab(tab);
    });
  });

  // Initial tab from active view
  const active = document.querySelector(".tab-view.active");
  const tab = active?.id?.replace(/^view-/, "") || "home";
  markNavForTab(tab);
  updateSessionHeaderMode();
}

document.addEventListener("DOMContentLoaded", () => {
  initNavShell();
});
