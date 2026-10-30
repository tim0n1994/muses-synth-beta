import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Synth fixture uses Vite only; local-beta owns its isolated auth server/SQLite.
export default defineConfig({
  testDir: ".",
  testMatch: ["audio-media.spec.ts", "local-beta.spec.ts"],
  workers: 1,
  timeout: 30000,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: fileURLToPath(
          new URL("../../test-results/audio-media.json", import.meta.url),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(
    new URL("../../test-results/audio-media-artifacts", import.meta.url),
  ),
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:18437",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "pnpm exec vite --host 127.0.0.1 --port 18437 --strictPort",
    url: "http://127.0.0.1:18437/src/web/player/__browser__/fixture.html",
    reuseExistingServer: false,
  },
});
