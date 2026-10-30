import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import {
  installSynthProbe,
  readSynthProbe,
} from "../../src/web/player/__browser__/synth-probe.js";

interface StoredEvent {
  type: string;
  occurredAt: string;
  data: { path?: string };
}

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const address = listener.address();
  if (address === null || typeof address === "string")
    throw new Error("No port");
  await new Promise<void>((done, fail) =>
    listener.close((error) => (error ? fail(error) : done())),
  );
  return address.port;
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGTERM");
  await exited;
}

test("authenticated local beta: filesystem to real audio and persisted receipt", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const root = mkdtempSync(join(tmpdir(), "muses-local-beta-e2e-"));
  const errors: string[] = [];
  const forbiddenRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const workspace = join(root, "watched-project");
  mkdirSync(workspace);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(MUSES_|LLM_|EMAIL_TRANSPORT|NODE_TEST_CONTEXT)/u.test(key),
    ),
  );
  const server = spawn(process.execPath, [resolve("dist/server/index.js")], {
    env: {
      ...cleanEnv,
      NODE_ENV: "development", // Console test codes are returned only in development.
      MUSES_PORT: String(port),
      MUSES_HOST: "127.0.0.1",
      MUSES_SERVE_STATIC: "true",
      MUSES_DATABASE_PATH: join(root, "fixture.sqlite"),
      MUSES_LOG_PATH: join(root, "fixture.log"),
      MUSES_ALLOWED_ORIGINS: base,
      MUSES_AUTH_ENABLED: "true",
      MUSES_JWT_SECRET: "local-beta-e2e-only-secret",
      EMAIL_TRANSPORT: "console",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Consume output without exposing the fixture's verification code or JWT.
  server.stdout?.resume();
  server.stderr?.resume();
  let watcher: ChildProcess | undefined;

  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${base}/api/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(200);
    expect((await fetch(`${base}/api/v1/context/events?limit=1`)).status).toBe(
      401,
    );

    await page.addInitScript(installSynthProbe);
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin !== base ||
        /^\/(audio|library)(\/|$)/u.test(url.pathname)
      ) {
        forbiddenRequests.push(url.origin + url.pathname);
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(`${base}/register`);
    await page
      .getByLabel("Email", { exact: true })
      .fill("local-beta@example.test");
    const codeResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/send-code"),
    );
    await page.getByRole("button", { name: "Send code" }).click();
    const code = ((await (await codeResponse).json()) as { devCode?: string })
      .devCode;
    expect(code).toBeTruthy();
    await page.getByLabel("Verification code").fill(String(code));
    await page
      .getByLabel("Password", { exact: true })
      .fill("fixture-only-password");
    await page.getByLabel("Display name (optional)").fill("Local Beta");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Account created")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Context, belief, and reversible action",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "User guide" }),
    ).toHaveAttribute("href", "/guide-beta.html");
    const guide = await page.context().newPage();
    await guide.goto(`${base}/guide-beta.html`);
    await guide.getByRole("button", { name: "中文" }).click();
    await expect(
      guide.getByRole("heading", { name: "Muses 本地 Beta 指南" }),
    ).toBeVisible();
    await guide.getByRole("button", { name: "EN", exact: true }).click();
    await expect(
      guide.getByRole("heading", { name: "Muses Local Beta Guide" }),
    ).toBeVisible();
    await guide.close();
    const transport = page.locator(".muses-audio-controls").getByRole("switch");
    await expect(transport).toBeDisabled();
    const token = await page.evaluate(() => {
      const session = JSON.parse(
        window.localStorage.getItem("muses_auth") ?? "{}",
      );
      return String(session.token ?? "");
    });
    expect(token.length).toBeGreaterThan(0);
    const headers = { authorization: `Bearer ${token}` };
    const events = async (): Promise<StoredEvent[]> => {
      const response = await page.request.get(
        `${base}/api/v1/context/events?source=${encodeURIComponent("urn:muses:watch")}&limit=50`,
        { headers },
      );
      expect(response.status()).toBe(200);
      return ((await response.json()) as { items: StoredEvent[] }).items;
    };
    const editorCount = async () =>
      (await events()).filter((event) => event.type === "muses.editor.activity")
        .length;

    watcher = spawn(
      process.execPath,
      [
        resolve("dist/server/cli/main.js"),
        "watch",
        "--dir",
        workspace,
        "--server",
        base,
        "--debounce",
        "100",
        "--token-stdin",
      ],
      { env: cleanEnv, stdio: ["pipe", "pipe", "pipe"] },
    );
    let watcherOutput = "";
    watcher.stdout?.on(
      "data",
      (chunk: Buffer) => (watcherOutput += chunk.toString()),
    );
    watcher.stderr?.on(
      "data",
      (chunk: Buffer) => (watcherOutput += chunk.toString()),
    );
    watcher.stdin?.end(`${token}\n`);
    await expect
      .poll(() => watcherOutput.includes("Watching "), { timeout: 15_000 })
      .toBe(true);
    expect(watcherOutput).not.toContain(token);

    // The production belief rule needs three saves spanning at least 90s.
    writeFileSync(join(workspace, "one.ts"), "export const one = 1;\n");
    await expect
      .poll(editorCount, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
    writeFileSync(join(workspace, "two.ts"), "export const two = 2;\n");
    await expect
      .poll(editorCount, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(46_000);
    await page.waitForTimeout(45_000);
    writeFileSync(join(workspace, "three.ts"), "export const three = 3;\n");
    await expect
      .poll(editorCount, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);
    const recorded = await events();
    const edits = recorded.filter(
      (event) => event.type === "muses.editor.activity",
    );
    const times = edits.map((event) => Date.parse(event.occurredAt));
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThanOrEqual(
      90_000,
    );
    expect(recorded.every((event) => event.data.path === undefined)).toBe(true);

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/api/v1/belief/current`,
            { headers },
          );
          return ((await response.json()) as { state: string }).state;
        },
        { timeout: 20_000 },
      )
      .toBe("BUILD");
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/api/v1/effects/current`,
            { headers },
          );
          const body = (await response.json()) as {
            effect: { request: { actionId: string } } | null;
          };
          return body.effect?.request.actionId;
        },
        { timeout: 20_000 },
      )
      .toBe("audio.adjust");

    // Use a real browser gesture. No fake media URLs or direct receipt posts.
    await expect(transport).toBeEnabled({ timeout: 30_000 });
    const prompt = page.getByRole("region", {
      name: "Pending audio intervention",
    });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    expect((await page.evaluate(readSynthProbe)).outputs).toHaveLength(0);
    await prompt.getByRole("button", { name: "开启本次会话声音" }).click();
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/api/v1/effects/current`,
            { headers },
          );
          const body = (await response.json()) as {
            effect: {
              latestOutcome: { status: string; reason: string } | null;
            } | null;
          };
          return body.effect?.latestOutcome;
        },
        { timeout: 30_000 },
      )
      .toMatchObject({ status: "applied", reason: "MANUAL_START" });

    const mediaSample = () => page.evaluate(readSynthProbe);
    await expect
      .poll(
        async () =>
          (await mediaSample()).outputs.some(
            (voice) =>
              voice.state === "running" &&
              voice.gain > 0 &&
              voice.rms > 0.00001,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
    const before = await mediaSample();
    await expect
      .poll(
        async () => {
          const after = await mediaSample();
          return after.outputs.some(
            (voice, index) =>
              voice.time - (before.outputs[index]?.time ?? 0) > 0.2,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const observedMedia = await mediaSample();
    expect(observedMedia.mediaSources).toBe(0);
    expect(observedMedia.mediaElements).toBe(0);
    expect(observedMedia.oscillators.length).toBeGreaterThan(0);
    await test.info().attach("local-beta-media-observation", {
      body: JSON.stringify(observedMedia),
      contentType: "application/json",
    });

    await expect(transport).toBeChecked({ timeout: 20_000 });
    await transport.click();
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/api/v1/effects/current`,
            { headers },
          );
          const body = (await response.json()) as {
            effect: {
              latestOutcome: { status: string; reason: string } | null;
            } | null;
          };
          return body.effect?.latestOutcome;
        },
        { timeout: 20_000 },
      )
      .toMatchObject({ status: "skipped", reason: "MANUAL_PAUSE" });
    await expect(transport).not.toBeChecked();
    await expect
      .poll(async () =>
        (await mediaSample()).outputs.every(
          (voice) => voice.state === "suspended" && voice.gain === 0,
        ),
      )
      .toBe(true);
    writeFileSync(join(workspace, "four.ts"), "export const four = 4;\n");
    await expect
      .poll(editorCount, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(4);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/api/v1/decisions/current`,
            { headers },
          );
          const body = (await response.json()) as {
            decision: { kind: string; reason: string } | null;
          };
          return body.decision;
        },
        { timeout: 15_000 },
      )
      .toMatchObject({ kind: "NO_ACTION", reason: "MANUAL_COOLDOWN" });
    // Verify durable storage directly, not only the API's current in-memory view.
    const database = new Database(join(root, "fixture.sqlite"), {
      readonly: true,
    });
    let durableReceipts: unknown[];
    try {
      durableReceipts = database
        .prepare(
          "SELECT status, json_extract(outcome_json, '$.reason') AS reason FROM effect_outcomes WHERE json_extract(outcome_json, '$.reason') IN ('MANUAL_START', 'MANUAL_PAUSE') AND user_id IS NOT NULL ORDER BY observed_at",
        )
        .all();
      expect(durableReceipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "applied",
            reason: "MANUAL_START",
          }),
          expect.objectContaining({
            status: "skipped",
            reason: "MANUAL_PAUSE",
          }),
        ]),
      );
    } finally {
      database.close();
    }
    const paused = await mediaSample();
    await page.waitForTimeout(400);
    expect((await mediaSample()).outputs.map((voice) => voice.time)).toEqual(
      paused.outputs.map((voice) => voice.time),
    );
    // Exercise actual route ownership while sounding, without a document reload.
    await transport.click();
    await expect(transport).toBeChecked({ timeout: 20_000 });
    await expect
      .poll(async () =>
        (await mediaSample()).outputs.some(
          (voice) => voice.state === "running" && voice.rms > 0.00001,
        ),
      )
      .toBe(true);
    const leaveDashboard = () =>
      page.locator('.auth-sessionbar__link[href="/settings"]').click();
    await leaveDashboard();
    await expect
      .poll(async () =>
        (await mediaSample()).outputs.every(
          (voice) => voice.state === "closed",
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await mediaSample()).sources.every((voice) => voice.stopRequested),
      )
      .toBe(true);
    await page.goBack();
    await expect(transport).toBeEnabled({ timeout: 20_000 });
    // A historical receipt cannot stand in for this route's new audio graph.
    await expect(transport).not.toBeChecked();
    const waitForStartReceipt = (target: Page) =>
      target.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/effects/outcomes") &&
          response.request().method() === "POST" &&
          (response.request().postDataJSON() as { reason?: string }).reason ===
            "MANUAL_START",
      );
    const resumedReceipt = waitForStartReceipt(page);
    await transport.click();
    await expect(transport).toBeChecked({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const value = await mediaSample();
        return (
          value.outputs.length === 2 &&
          value.outputs[0]?.state === "closed" &&
          value.outputs[1]?.state === "running" &&
          value.outputs[1].rms > 0.00001
        );
      })
      .toBe(true);
    const receiptResponse = await resumedReceipt;
    expect(receiptResponse.status()).toBe(200);
    const restartLedger = (await receiptResponse.json()) as {
      effect: {
        latestOutcome: { outcomeId: string; status: string; reason: string };
      };
    };
    expect(restartLedger).toMatchObject({
      effect: { latestOutcome: { status: "applied", reason: "MANUAL_START" } },
    });
    const persistedRestart = new Database(join(root, "fixture.sqlite"), {
      readonly: true,
    });
    try {
      const row = persistedRestart
        .prepare(
          "SELECT outcome_json FROM effect_outcomes WHERE outcome_id = ? AND user_id IS NOT NULL",
        )
        .get(restartLedger.effect.latestOutcome.outcomeId) as
        { outcome_json: string } | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row!.outcome_json)).toMatchObject(
        restartLedger.effect.latestOutcome,
      );
    } finally {
      persistedRestart.close();
    }
    await leaveDashboard();
    await expect
      .poll(async () =>
        (await mediaSample()).outputs.every(
          (voice) => voice.state === "closed",
        ),
      )
      .toBe(true);
    const routeLifecycle = await mediaSample();

    // Same account, independent native runtimes. Shared receipts must not make
    // a silent tab look active, or make a sounding tab inherit another's pause.
    await page.goBack();
    await expect(transport).toBeEnabled({ timeout: 20_000 });
    await expect(transport).not.toBeChecked();
    const mainStart = waitForStartReceipt(page);
    await transport.click();
    expect((await mainStart).status()).toBe(200);
    const peer = await page.context().newPage();
    let peerObservation: unknown;
    try {
      await peer.addInitScript(installSynthProbe);
      peer.on("pageerror", (error) => errors.push(error.message));
      await peer.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (
          url.origin !== base ||
          /^\/(audio|library)(\/|$)/u.test(url.pathname)
        ) {
          forbiddenRequests.push(url.origin + url.pathname);
          return route.abort();
        }
        return route.continue();
      });
      await peer.goto(base);
      const peerTransport = peer
        .locator(".muses-audio-controls")
        .getByRole("switch");
      await expect(peerTransport).toBeEnabled({ timeout: 20_000 });
      await expect(peerTransport).not.toBeChecked();
      expect((await peer.evaluate(readSynthProbe)).outputs).toHaveLength(0);
      const peerStart = waitForStartReceipt(peer);
      await peerTransport.click();
      expect((await peerStart).status()).toBe(200);
      await expect(peerTransport).toBeChecked();
      await expect
        .poll(async () =>
          (await peer.evaluate(readSynthProbe)).outputs.some(
            (voice) => voice.state === "running" && voice.rms > 0.00001,
          ),
        )
        .toBe(true);

      const mainPause = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/effects/outcomes") &&
          response.request().method() === "POST" &&
          (response.request().postDataJSON() as { reason?: string }).reason ===
            "MANUAL_PAUSE",
      );
      await transport.click();
      expect((await mainPause).status()).toBe(200);
      await expect(transport).not.toBeChecked();
      const peerRefresh = peer.waitForResponse(
        (response) => response.url().endsWith("/api/v1/bootstrap"),
        { timeout: 15_000 },
      );
      await peer
        .getByRole("button", { name: "Refresh now", exact: true })
        .click();
      expect(await (await peerRefresh).json()).toMatchObject({
        effect: {
          latestOutcome: { reason: "MANUAL_PAUSE", status: "skipped" },
        },
      });
      await expect(peerTransport).toBeChecked();
      await expect
        .poll(
          async () =>
            (await peer.evaluate(readSynthProbe)).outputs[0]?.rms ?? 0,
        )
        .toBeGreaterThan(0.00001);

      // A newer playing receipt from the peer must not re-check the paused tab.
      const peerPause = peer.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/effects/outcomes") &&
          response.request().method() === "POST" &&
          (response.request().postDataJSON() as { reason?: string }).reason ===
            "MANUAL_PAUSE",
      );
      await peerTransport.click();
      expect((await peerPause).status()).toBe(200);
      await (await peerPause).finished();
      await expect(peerTransport).not.toBeChecked();
      const peerRestart = waitForStartReceipt(peer);
      await peerTransport.click();
      expect((await peerRestart).status()).toBe(200);
      const mainRefresh = page.waitForResponse(
        (response) => response.url().endsWith("/api/v1/bootstrap"),
        { timeout: 15_000 },
      );
      await page
        .getByRole("button", { name: "Refresh now", exact: true })
        .click();
      expect(await (await mainRefresh).json()).toMatchObject({
        effect: {
          latestOutcome: { reason: "MANUAL_START", status: "applied" },
        },
      });
      await expect(transport).not.toBeChecked();

      // A document reload also starts with a fresh runtime despite the ledger.
      await page.reload();
      await expect(transport).toBeEnabled({ timeout: 20_000 });
      await expect(transport).not.toBeChecked();
      expect((await mediaSample()).outputs).toHaveLength(0);
      const reloadStart = waitForStartReceipt(page);
      await transport.click();
      expect((await reloadStart).status()).toBe(200);
      await expect(transport).toBeChecked();
      await expect
        .poll(async () =>
          (await mediaSample()).outputs.some(
            (voice) => voice.state === "running" && voice.rms > 0.00001,
          ),
        )
        .toBe(true);
      peerObservation = await peer.evaluate(readSynthProbe);
      await peer.locator('.auth-sessionbar__link[href="/settings"]').click();
      await expect
        .poll(async () =>
          (await peer.evaluate(readSynthProbe)).outputs.every(
            (voice) => voice.state === "closed",
          ),
        )
        .toBe(true);
    } finally {
      await peer.close();
    }
    await leaveDashboard();
    await expect
      .poll(async () =>
        (await mediaSample()).outputs.every(
          (voice) => voice.state === "closed",
        ),
      )
      .toBe(true);
    expect(forbiddenRequests).toEqual([]);
    expect(errors).toEqual([]);
    writeFileSync(
      test.info().outputPath("local-beta-observation.json"),
      `${JSON.stringify(
        {
          scenario: "isolated-authenticated-local-beta",
          editorEvents: edits.length,
          editorSpanMs: Math.max(...times) - Math.min(...times),
          media: observedMedia,
          listeningAcceptance: "NOT_EVALUATED",
          durableReceipts,
          routeLifecycle,
          restartReceipt: restartLedger.effect.latestOutcome,
          peerObservation,
          receipt: { status: "applied", reason: "MANUAL_START" },
          pause: { status: "skipped", reason: "MANUAL_PAUSE" },
          nextDecision: { kind: "NO_ACTION", reason: "MANUAL_COOLDOWN" },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await stop(watcher);
    await stop(server);
    // Preserve only this test-created fixture for diagnosis; never remove user files.
    await test.info().attach("isolated-fixture-location", {
      body: JSON.stringify({ root }),
      contentType: "application/json",
    });
  }
});
