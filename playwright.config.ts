import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  outputDir: ".build/browser-results",
  workers: 2,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4870",
    actionTimeout: 10000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve.ts",
    url: "http://127.0.0.1:4870",
    reuseExistingServer: false,
  },
});
