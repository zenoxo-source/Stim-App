// playwright.config.js — E2E smoke tests (Electron).
// Run: npm run test:e2e  (builds the frontend bundle first)
//
// Without this config Playwright falls back to defaults: parallel workers
// launch several Electron instances at once and the 30 s default timeout is
// far below what a cold Electron start needs. Pin both down here.

module.exports = {
  testDir: "./tests/e2e",
  timeout: 120000,
  workers: 1,
  reporter: [["list"]],
  forbidOnly: !!process.env.CI,
};
