import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Public synth beta excludes the undelivered v0.7/replay recording library.
  // The synth media spec has its own fixture server/config and CI step.
  testIgnore: ["**/audio-media.spec.ts", "**/v07-surfaces.spec.ts"],
  fullyParallel: false,
  // Every spec drives one shared local server with one shared SQLite file, so
  // belief, decision and effect state is global. Parallel workers interleave
  // those mutations and make assertions about "the current belief" flaky.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start:e2e",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4173/api/health",
  },
});
