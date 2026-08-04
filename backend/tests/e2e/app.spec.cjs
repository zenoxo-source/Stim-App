// e2e/app.spec.cjs — Electron end-to-end smoke tests.
//
// Launches the packaged app entry (backend/) with Playwright's Electron
// support and verifies the core UI renders and responds. No device needed —
// all assertions are DOM-level.
//
// Run: npm run test:e2e   (builds the frontend bundle first)

const { test, expect, _electron } = require("@playwright/test");

test.setTimeout(120000);

const E2E_ENV = { ...process.env, STIM_APP_E2E: "1" };
const CWD = require("path").resolve(__dirname, "..", ".."); // backend/

async function launchApp() {
  const app = await _electron.launch({ args: [".", "--no-sandbox"], cwd: CWD, env: E2E_ENV });
  // Force rendering: with background throttling enabled, an occluded Electron
  // window stops compositing and Playwright's bounding boxes collapse to 0×0
  // (making toBeVisible unreliable). Show + unthrottle + paint the window.
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.setBackgroundThrottling(false);
        win.show();
        win.focus();
      }
    });
  } catch {
    /* optional */
  }
  const window = await app.firstWindow();
  await window.screenshot({ path: require("os").tmpdir() + "/stim-e2e-seed.png" }).catch(() => {});
  // Wait until the renderer finished initializing: some tab view is active and
  // the preload bridge is wired. The concrete tab may be the persisted one
  // (tab-persistence restores the last tab), so don't depend on a specific view.
  await window.waitForFunction(
    () => {
      return (
        document.querySelector(".tab-view.active") !== null &&
        typeof window.electronAPI === "object"
      );
    },
    null,
    { timeout: 20000 }
  );
  return { app, window };
}

test("app opens and the main deck renders", async () => {
  const { app, window } = await launchApp();
  try {
    // Title + version info.
    await expect(window.locator("#app-version-text")).toContainText(/v\d+\.\d+\.\d+/);

    // Deck: switch to the manual tab, sliders + pattern cards visible.
    await window.locator('.nav-item[data-tab="deck"]').click();
    await expect(window.locator("#view-deck")).toHaveClass(/active/);
    await expect(window.locator("#slider-intensity-a")).toBeAttached();
    await expect(window.locator(".pattern-card")).toHaveCount(16);

    // Library (Pattern Editor) tab.
    await window.locator('.nav-item[data-tab="editor"]').click();
    await expect(window.locator("#view-editor")).toHaveClass(/active/);
    await expect(window.locator(".pattern-card").first()).toBeAttached();

    // Settings hosts the Library feature cards (recorder/scheduler/funscript/program)
    // plus backup + biofeedback.
    await window.locator('.nav-item[data-tab="settings"]').click();
    await expect(window.locator("#view-settings")).toHaveClass(/active/);
    await expect(window.locator(".session-card")).toHaveCount(5);
    await expect(window.locator("#btn-program-classic")).toBeAttached();
    await expect(window.locator("#btn-funscript-import")).toBeAttached();
    await expect(window.locator("#btn-backup-export")).toBeAttached();
    await expect(window.locator("#btn-hr-connect")).toBeAttached();

    // Panic button reachable.
    await window.locator('.nav-item[data-tab="deck"]').click();
    await expect(window.locator("#btn-panic")).toBeAttached();
  } finally {
    await app.close();
  }
});

test("settings panel renders the security + biofeedback sections", async () => {
  const { app, window } = await launchApp();
  try {
    await window.locator('.nav-item[data-tab="settings"]').click();
    await expect(window.locator("#view-settings")).toHaveClass(/active/);
    await expect(window.locator("#btn-hr-connect")).toBeAttached();
    await expect(window.locator("#btn-buttplug-toggle")).toBeAttached();
    await expect(window.locator("#btn-bpc-toggle")).toBeAttached();
    await expect(window.locator("#profile-auto-load")).toBeAttached();
  } finally {
    await app.close();
  }
});

test("autodrive wizard navigates panels and exposes share-code actions", async () => {
  const { app, window } = await launchApp();
  try {
    await window.locator('.nav-item[data-tab="autodrive"]').click();
    await expect(window.locator("#view-autodrive")).toHaveClass(/active/);

    // Wizard: step 1 Setup (layout grid) → step 2 Session → step 3 Optionen → start.
    await expect(window.locator("#ad-layout-grid")).toBeAttached();
    await window.locator("#ad-wiz-next-setup").click();
    await expect(window.locator("#autodrive-template-grid")).toBeAttached();
    await window.locator("#ad-wiz-next-session").click();
    await expect(window.locator("#ad-wiz-start")).toBeAttached();

    // Share-code controls live in the final step.
    await expect(window.locator("#btn-share-copy")).toBeAttached();
    await expect(window.locator("#btn-share-paste")).toBeAttached();

    // Fullscreen scope canvas exists in the DOM (hidden until a run).
    await expect(window.locator("#ad-fs-scope")).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("master slider round-trips in the deck", async () => {
  const { app, window } = await launchApp();
  try {
    await window.locator('.nav-item[data-tab="deck"]').click();
    const master = window.locator("#slider-master");
    await expect(master).toBeAttached();
    await master.fill("57");
    await expect(window.locator("#master-val-text")).toHaveText("57%");
  } finally {
    await app.close();
  }
});
