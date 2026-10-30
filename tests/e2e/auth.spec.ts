import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end auth journey against a PRIVATE server instance booted with auth
 * enabled.
 *
 * The shared Playwright webServer (port 4173) intentionally runs without auth
 * env, so this spec spawns its own production server on port 4199 with an
 * isolated SQLite file and the console email transport — the send-code
 * response then carries `devCode`, which is how the test "receives the mail".
 *
 * The tests run in file order and share that instance's database: the
 * registration test creates the account the later tests sign in with.
 */

const AUTH_PORT = 4199;
const BASE_URL = `http://127.0.0.1:${AUTH_PORT}`;
const EMAIL = "e2e-auth@muses.local";
const PASSWORD = "correct-horse-battery";
const DASHBOARD_HEADING = "Context, belief, and reversible action";

let child: ChildProcess | null = null;
let workspace = "";
let serverOutput = "";

function startServer(): ChildProcess {
  const server = spawn(
    process.execPath,
    [resolve(process.cwd(), "dist/server/index.js")],
    {
      env: {
        ...process.env,
        // Deliberately NOT NODE_ENV=production: the backend only echoes
        // devCode in API responses when non-production + console transport,
        // which is how this test "receives the email".
        NODE_ENV: "development",
        MUSES_PORT: String(AUTH_PORT),
        MUSES_SERVE_STATIC: "true",
        MUSES_DATABASE_PATH: join(workspace, "muses.sqlite"),
        MUSES_LOG_PATH: join(workspace, "muses.log"),
        MUSES_LOG_LEVEL: "info",
        MUSES_ALLOWED_ORIGINS: `http://127.0.0.1:${AUTH_PORT}`,
        MUSES_AUTH_ENABLED: "true",
        MUSES_JWT_SECRET: "test-secret",
        EMAIL_TRANSPORT: "console",
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

async function waitUntilHealthy(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      break;
    }
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      /* server not accepting connections yet */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(
    `auth e2e server on ${BASE_URL} did not become healthy. Output:\n${serverOutput}`,
  );
}

test.beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "muses-auth-e2e-"));
  child = startServer();
  await waitUntilHealthy();
});

test.afterAll(async () => {
  if (child !== null) {
    child.kill("SIGTERM");
    await new Promise((resolveExit) => {
      child?.once("exit", resolveExit);
      setTimeout(resolveExit, 5_000);
    });
    child = null;
  }
  rmSync(workspace, { recursive: true, force: true });
});

async function registerThroughUi(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/register`);
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);

  const codePromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/send-code"),
  );
  await page.getByRole("button", { name: "Send code" }).click();
  const codeBody = (await (await codePromise).json()) as { devCode?: string };
  expect(
    codeBody.devCode,
    "console transport must surface a devCode",
  ).toBeTruthy();

  await page.getByLabel("Verification code").fill(String(codeBody.devCode));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Display name (optional)").fill("E2E Auth");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Account created")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
}

test("unauthenticated visitors are bounced to /login with a returnUrl", async ({
  page,
}) => {
  await page.goto(`${BASE_URL}/`);
  await expect(page).toHaveURL(/\/login\?returnUrl=%2F$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("registers via dev code, lands signed-in on the dashboard", async ({
  page,
}) => {
  await registerThroughUi(page);

  await expect(
    page.getByRole("heading", { name: DASHBOARD_HEADING }),
  ).toBeVisible();
  // The session strip above the dashboard shows the account email.
  await expect(page.getByText(EMAIL)).toBeVisible();
  // The dashboard itself keeps working (its own API calls carry the token).
  await expect(page.getByText("Local runtime").first()).toBeVisible();

  // Data-driven surface: the settings page must load through the auth gate
  // (its snapshot request carries the bearer token) and expose the language
  // selector — regression for "settings request failed with HTTP 401".
  await page.goto(`${BASE_URL}/settings`);
  await expect(page.getByRole("combobox", { name: "Language" })).toBeVisible();
});

test("signs out and signs back in with the registered account", async ({
  page,
}) => {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: DASHBOARD_HEADING }),
  ).toBeVisible();
  await expect(page.getByText(EMAIL)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a stale token is cleared and redirected on the next session probe", async ({
  page,
}) => {
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    const staleUser = {
      id: "u-stale",
      email: "stale@muses.local",
      displayName: "Stale",
      createdAt: "",
      subscription: "free",
      role: "user",
      emailVerified: true,
      isActive: true,
    };
    window.localStorage.setItem(
      "muses_auth",
      JSON.stringify({ token: "stale-token", user: staleUser }),
    );
  });

  await page.goto(`${BASE_URL}/settings`);
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fsettings$/);
  const stored = await page.evaluate(() =>
    window.localStorage.getItem("muses_auth"),
  );
  expect(stored).toBeNull();
});
