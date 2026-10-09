import { defineConfig, devices } from "@playwright/test";

const PORT = 3300;
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } };

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright",
  fullyParallel: false, // tests share one server and its config files
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    colorScheme: "dark",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    // Signed in as admin (editor, users, history).
    {
      name: "admin",
      testMatch: /(visual|flows|detail|finance|monitoring|settings|palette|updates|apps|appearance)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...desktop, storageState: "test-results/.auth/admin.json" },
    },
    // Starts signed out; logs in through the UI.
    { name: "anonymous", testMatch: /(auth|security)\.spec\.ts/, dependencies: ["admin"], use: desktop },
  ],
  webServer: [
    { command: "node scripts/mock-server.mjs", port: 4010, reuseExistingServer: !process.env.CI },
    { command: "node scripts/e2e-app.mjs", port: PORT, reuseExistingServer: false, timeout: 120_000 },
  ],
});
