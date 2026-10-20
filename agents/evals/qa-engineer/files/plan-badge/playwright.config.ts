import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3000" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["iPhone 14"] } },
  ],
  webServer: [
    { command: "node tests/support/fake-bff-server.mjs", port: 4000, reuseExistingServer: true },
    {
      command: "npm run build && npm run start",
      port: 3000,
      env: { BFF_INTERNAL_URL: "http://localhost:4000" },
    },
  ],
});
