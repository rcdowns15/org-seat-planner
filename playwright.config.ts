import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  use: { baseURL: "http://localhost:3000" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI runs the production build; locally we use the dev server.
    command: isCI ? "pnpm build && pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
