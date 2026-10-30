import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * v0.7 client-surface gating + the 60s event→track-change budget, against
 * REAL production builds:
 *
 *  Arm 1 (shared 4173 server, flags off): /self-track serves the SPA shell
 *  byte-identical to dist/web/index.html (no injected hint) and the browser
 *  shows the foundation catch-all — the exact v0.6 answer, not an error page
 *  (Round-1 review B2).
 *
 *  Arm 2 (private 4217 server, MUSES_V07=1, pilot library DB): the shell
 *  carries window.__MUSES_FEATURES__, /self-track mounts the player, and a
 *  burst of real-collector-shaped events (muses.editor.activity, the same
 *  wire format production uses) moves the pulse to the slow bucket; the
 *  playing deck must change tracks within 60s of the first event.
 */

const V07_PORT = 4217;
const V07_BASE_URL = `http://127.0.0.1:${V07_PORT}`;
const PILOT_DB = resolve(
  process.cwd(),
  "artifacts/v07-library-pilot/library.sqlite",
);

// The private arm boots a second production server against the 60-track pilot
// database; keep the hook timeout explicit instead of inheriting Playwright's
// 30-second default while migrations and static assets initialize.
test.describe.configure({ timeout: 120_000 });

let child: ChildProcess | null = null;
let workspace = "";
let serverOutput = "";

function startV07Server(): ChildProcess {
  const server = spawn(
    process.execPath,
    [resolve(process.cwd(), "dist/server/index.js")],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        MUSES_PORT: String(V07_PORT),
        MUSES_SERVE_STATIC: "true",
        MUSES_DATABASE_PATH: join(workspace, "muses.sqlite"),
        MUSES_LOG_PATH: join(workspace, "muses.log"),
        MUSES_LOG_LEVEL: "info",
        MUSES_ALLOWED_ORIGINS: `http://127.0.0.1:${V07_PORT}`,
        MUSES_V07: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout?.on("data", (chunk: Buffer) => {
    serverOutput += chunk.toString("utf8");
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    serverOutput += chunk.toString("utf8");
  });
  return server;
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  workspace = mkdtempSync(join(tmpdir(), "muses-e2e-v07-"));
  // The 60-track pilot library (same artifact the plan-API benchmark uses):
  // real bucket rows + real Opus files under dist/web/library (copied from
  // public/ by the vite build the shared webServer already ran).
  copyFileSync(PILOT_DB, join(workspace, "muses.sqlite"));
  child = startV07Server();
  await waitForHealth();
}, 120_000);

test.afterAll(async () => {
  if (child !== null) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child?.on("exit", () => resolve());
      setTimeout(resolve, 5_000);
    });
  }
  if (workspace !== "") {
    rmSync(workspace, { recursive: true, force: true });
  }
});

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${V07_BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `v0.7 e2e server did not become healthy. Server output:\n${serverOutput}`,
  );
}

test.describe("flag-off client surface is v0.6 (shared server)", () => {
  test("/self-track serves the untouched shell and the v0.6 catch-all page", async ({
    page,
    baseURL,
  }) => {
    // API arm: the served HTML is byte-identical to the built artifact —
    // exactly what v0.6 serves for this URL.
    const shellResponse = await page.request.get(`${baseURL}/self-track`, {
      headers: { accept: "text/html" },
    });
    expect(shellResponse.status()).toBe(200);
    const onDisk = readFileSync(
      resolve(process.cwd(), "dist/web/index.html"),
      "utf8",
    );
    expect(await shellResponse.text()).toBe(onDisk);

    // Browser arm: the router mounts the v0.6 table only — the foundation
    // status page answers, not a half-registered error page.
    await page.goto(`${baseURL}/self-track`);
    await expect(page.locator("#foundation-title")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("#self-track-heading")).toHaveCount(0);
  });
});

test.describe("flag-on surfaces (private MUSES_V07=1 server)", () => {
  test("the shell carries the injected feature hint and the player mounts", async ({
    page,
  }) => {
    const shellResponse = await page.request.get(`${V07_BASE_URL}/self-track`, {
      headers: { accept: "text/html" },
    });
    expect(shellResponse.status()).toBe(200);
    expect(await shellResponse.text()).toContain(
      `<meta name="muses-features" content='{"selfTrack":true,"replay":false}'>`,
    );

    await page.goto(`${V07_BASE_URL}/self-track`);
    await expect(page.locator("#self-track-heading")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("events change the playing track within the 60s budget", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(`${V07_BASE_URL}/self-track`);
    await page.getByRole("button", { name: /start/i }).click();

    const title = page.getByTestId("now-playing-title");
    await expect(title).toBeVisible({ timeout: 20_000 });
    const initialTitle = await title.textContent();
    expect(initialTitle).toBeTruthy();

    // Same wire format as the production collector; six edit events inside
    // a minute push the weighted rhythm rate into the SLOW band (≤6/60s),
    // moving the signature bucket off the default self_mid_mid.
    const postEvent = (index: number): Promise<Response> =>
      page.request.post(`${V07_BASE_URL}/api/v1/context/events`, {
        // Mutations require an allowed Origin (v0.6 hardening); the bare
        // page.request context sends none and would 403.
        headers: { origin: V07_BASE_URL },
        data: {
          specversion: "1.0",
          id: `e2e-v07-slow-${index}`,
          source: "urn:muses:e2e:v07",
          type: "muses.editor.activity",
          subject: "workspace:e2e",
          time: new Date().toISOString(),
          datacontenttype: "application/json",
          data: { action: "edit" },
        },
      });

    const startedAt = Date.now();
    for (let index = 0; index < 6; index += 1) {
      const response = await postEvent(index);
      expect(response.status()).toBeLessThan(400);
    }

    // Event → (5s debounce + plan refresh ≤20s) → restart with the new
    // bucket's first track. The budget is 60s end to end.
    await expect
      .poll(async () => (await title.textContent()) ?? "", {
        timeout: 60_000,
        interval: 1_000,
      })
      .not.toBe(initialTitle ?? "");
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs, `event→track-change took ${elapsedMs}ms`).toBeLessThan(
      60_000,
    );
  });
});
