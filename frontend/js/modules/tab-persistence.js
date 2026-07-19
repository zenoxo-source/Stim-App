// tab-persistence.js - Remember the last-opened tab across sessions.
//
// Cross-platform: localStorage + DOM event hook. No platform-specific code.

const TAB_KEY = "stim_app_last_tab";

/**
 * Save the currently-active tab name (e.g. "deck", "stim", "settings").
 * @param {string} tabName
 */
export function saveActiveTab(tabName) {
  if (!tabName || typeof tabName !== "string") return;
  try {
    localStorage.setItem(TAB_KEY, tabName);
  } catch {
    /* ignore */
  }
}

/**
 * Get the last-saved tab name (or null if never saved).
 * @returns {string|null}
 */
export function getSavedActiveTab() {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear the saved tab.
 */
export function clearSavedActiveTab() {
  try {
    localStorage.removeItem(TAB_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Restore the saved tab on app start. Returns the tab name that was restored,
 * or null. The caller is responsible for actually clicking the nav-item — we
 * don't want a hard dependency on a specific selector here.
 *
 * @returns {string|null}
 */
export function restoreActiveTab() {
  const saved = getSavedActiveTab();
  if (!saved) return null;
  const navItem = document.querySelector(`.nav-item[data-tab="${saved}"]`);
  if (!navItem) return null;
  navItem.click();
  return saved;
}

document.addEventListener("DOMContentLoaded", () => {
  // Defer slightly so other DOMContentLoaded handlers can register first.
  setTimeout(() => {
    try {
      restoreActiveTab();
    } catch (err) {
      console.warn("Failed to restore tab:", err);
    }
  }, 200);
});
