// theme.js - Theme manager (dark / light / auto).
//
// Applies theme via `data-theme` attribute on <html>. CSS overrides per theme
// live in style.css. Persists choice in localStorage. "auto" follows
// prefers-color-scheme via matchMedia.
//
// Cross-platform: pure DOM/CSS, no platform-specific code.

import { log } from "../state.js";

const THEME_KEY = "stim_app_theme";
const VALID_THEMES = ["dark", "light", "auto"];

let mediaQueryListener = null;

/**
 * Get the user's saved theme (or "dark" as default).
 * @returns {"dark"|"light"|"auto"}
 */
export function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t && VALID_THEMES.includes(t)) return t;
  } catch {
    /* localStorage unavailable */
  }
  return "dark";
}

/**
 * Resolve "auto" → concrete theme based on prefers-color-scheme.
 * @param {"dark"|"light"|"auto"} theme
 * @returns {"dark"|"light"}
 */
export function resolveTheme(theme) {
  if (theme !== "auto") return theme;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {
    /* matchMedia unavailable */
  }
  return "dark";
}

/**
 * Apply the given theme to the document.
 * @param {"dark"|"light"|"auto"} theme
 */
export function applyTheme(theme) {
  if (!VALID_THEMES.includes(theme)) {
    log(`Unbekanntes Theme "${theme}" — ignoriert.`, "warning");
    return;
  }
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute("data-theme", resolved);
  // Update toggle button label
  const btn = document.getElementById("btn-theme-toggle");
  if (btn) {
    const icon = theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🖥️";
    btn.textContent = icon;
    btn.title = `Theme: ${theme} (klicken zum Wechseln)`;
    btn.setAttribute("aria-label", `Theme: ${theme}`);
  }
  // Subscribe to system theme changes when in auto mode
  if (theme === "auto") {
    armAutoThemeWatcher();
  } else {
    disarmAutoThemeWatcher();
  }
}

/**
 * Persist + apply.
 * @param {"dark"|"light"|"auto"} theme
 */
export function setTheme(theme) {
  if (!VALID_THEMES.includes(theme)) return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
  log(`Theme: ${theme}`, "info");
}

/**
 * Cycle dark → light → auto → dark. Wired to the header button.
 */
export function cycleTheme() {
  const cur = getStoredTheme();
  const next = cur === "dark" ? "light" : cur === "light" ? "auto" : "dark";
  setTheme(next);
}

/** Subscribe to system prefers-color-scheme changes when in auto mode. */
function armAutoThemeWatcher() {
  if (mediaQueryListener) return;
  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mediaQueryListener = (ev) => {
      // Only re-apply if still in auto mode
      if (getStoredTheme() === "auto") {
        document.documentElement.setAttribute("data-theme", ev.matches ? "light" : "dark");
      }
    };
    if (mq.addEventListener) {
      mq.addEventListener("change", mediaQueryListener);
    } else if (mq.addListener) {
      mq.addListener(mediaQueryListener);
    }
  } catch {
    /* matchMedia unavailable */
  }
}

function disarmAutoThemeWatcher() {
  if (!mediaQueryListener) return;
  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    if (mq.removeEventListener) {
      mq.removeEventListener("change", mediaQueryListener);
    } else if (mq.removeListener) {
      mq.removeListener(mediaQueryListener);
    }
  } catch {
    /* ignore */
  }
  mediaQueryListener = null;
}

document.addEventListener("DOMContentLoaded", () => {
  // Apply stored theme as early as possible
  applyTheme(getStoredTheme());

  const btn = document.getElementById("btn-theme-toggle");
  btn?.addEventListener("click", cycleTheme);
});
