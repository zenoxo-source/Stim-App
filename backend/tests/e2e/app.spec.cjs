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
  const window = await app.firstWindow();
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
    await expect(window.locator("#slider-intensity-a")).toBeVisible();
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
    await expect(window.locator("#btn-program-classic")).toBeVisible();
    await expect(window.locator("#btn-funscript-import")).toBeVisible();
    await expect(window.locator("#btn-backup-export")).toBeVisible();
    await expect(window.locator("#btn-hr-connect")).toBeVisible();

    // Panic button reachable.
    await window.locator('.nav-item[data-tab="deck"]').click();
    await expect(window.locator("#btn-panic")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("settings panel renders the security + biofeedback sections", async () => {
  const { app, window } = await launchApp();
  try {
    await window.locator('.nav-item[data-tab="settings"]').click();
    await expect(window.locator("#view-settings")).toHaveClass(/active/);
    await expect(window.locator("#btn-hr-connect")).toBeVisible();
    await expect(window.locator("#btn-buttplug-toggle")).toBeVisible();
    await expect(window.locator("#btn-bpc-toggle")).toBeVisible();
    await expect(window.locator("#profile-auto-load")).toBeVisible();
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
    await expect(window.locator("#ad-layout-grid")).toBeVisible();
    await window.locator("#ad-wiz-next-setup").click();
    await expect(window.locator("#autodrive-template-grid")).toBeVisible();
    await window.locator("#ad-wiz-next-session").click();
    await expect(window.locator("#ad-wiz-start")).toBeVisible();

    // Share-code controls live in the final step.
    await expect(window.locator("#btn-share-copy")).toBeVisible();
    await expect(window.locator("#btn-share-paste")).toBeVisible();

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
    await expect(master).toBeVisible();
    await master.fill("57");
    await expect(window.locator("#master-val-text")).toHaveText("57%");
  } finally {
    await app.close();
  }
});
