import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const database =
  (process.env.BINGO_QA_DATABASE_URL ||= `file:${join(mkdtempSync(join(tmpdir(), "bingo-browser-")), "app.db")}`);
const baseURL = "http://127.0.0.1:3100";
const browserName =
  process.env.BINGO_TEST_BROWSER === "webkit" ? "webkit" : "chromium";
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices[browserName === "webkit" ? "Desktop Safari" : "Desktop Chrome"],
    browserName,
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        browserName === "chromium"
          ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
          : undefined,
    },
  },
  webServer: {
    command: "node .next/standalone/server.js",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    env: {
      APP_URL: baseURL,
      PORT: "3100",
      HOSTNAME: "127.0.0.1",
      BINGO_E2E: "1",
      TURSO_DATABASE_URL: database,
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
    },
  },
});
