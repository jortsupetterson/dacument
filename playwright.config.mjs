import { defineConfig, devices } from "playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./test/playwright",
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node test/playwright/server.mjs",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "firefox",
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      use: { browserName: "webkit" },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"], browserName: "chromium" },
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
