import { defineConfig, devices } from "@playwright/test";
const browserName =
  process.env.BINGO_TEST_BROWSER === "webkit" ? "webkit" : "chromium";
export default defineConfig({
  testDir: "./test/demo",
  outputDir: "test-results/demo",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: "list",
  use: {
    ...devices[browserName === "webkit" ? "Desktop Safari" : "Desktop Chrome"],
    browserName,
    baseURL: "http://127.0.0.1:4173",
    launchOptions: {
      executablePath:
        browserName === "chromium"
          ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          : undefined,
    },
  },
  webServer: {
    command:
      "python3 -m http.server 4173 --bind 127.0.0.1 --directory demo/dist",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "ignore",
  },
});
