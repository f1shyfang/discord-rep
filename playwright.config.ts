import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:3107",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      process.env.E2E_RUNTIME === "vinext"
        ? "node_modules/.bin/vite dev --port 3107"
        : "npm run dev -- --port 3107",
    url: "http://localhost:3107",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
