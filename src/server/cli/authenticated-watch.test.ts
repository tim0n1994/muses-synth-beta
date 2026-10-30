// @vitest-environment node
import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AuthService } from "../auth/auth-service.js";
import { createAuthModule } from "../auth/module.js";
import { enabledAuthConfig, SILENT_EMAILER } from "../auth/test-support.js";
import { contextRoutes } from "../context/routes.js";
import { ContextEventService } from "../context/service.js";
import {
  SqliteContextEventStore,
  type SqliteDatabasePort,
} from "../context/sqlite-context-event-store.js";
import { openDatabase, runMigrations } from "../db/index.js";
import { loadRuntimeConfig } from "../foundation/config.js";
import { createApp, type FoundationModule } from "../foundation/create-app.js";

// Each run owns its own isolated fixture tree; never write project evidence or
// touch an existing user database when the test suite runs.
const evidence = mkdtempSync(join(tmpdir(), "muses-auth-collector-tests-"));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => rmSync(evidence, { recursive: true, force: true }));

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 12000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for isolated watcher scenario");
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

async function fixture(auth: boolean) {
  const root = mkdtempSync(join(evidence, "fixture-"));
  const workspace = join(root, "explicit project");
  const outside = join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  const db = openDatabase(":memory:");
  runMigrations(db.connection, { purpose: "test" });
  const authConfig = enabledAuthConfig();
  const service = new AuthService({
    database: db.connection,
    config: authConfig,
    emailer: SILENT_EMAILER,
  });
  const password = "fixture-password-only";
  const code = await service.createAndSendCode(
    "collector@example.test",
    "register",
  );
  const session = service.registerUserVerified(
    "collector@example.test",
    code,
    password,
  );
  const modules: FoundationModule[] = [];
  if (auth)
    modules.push({
      name: "auth",
      plugin: createAuthModule({ config: authConfig, database: db.connection }),
    });
  modules.push({
    name: "context",
    plugin: async (app) => {
      await app.register(contextRoutes, {
        service: new ContextEventService(
          new SqliteContextEventStore(
            db.connection as unknown as SqliteDatabasePort,
          ),
        ),
      });
    },
  });
  const serverLog = join(root, "server.log");
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address();
  if (address === null || typeof address === "string")
    throw new Error("No test port");
  const base = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  const app = await createApp({
    config: loadRuntimeConfig({
      NODE_ENV: "test",
      MUSES_LOG_PATH: serverLog,
      MUSES_LOG_LEVEL: "info",
      MUSES_ALLOWED_ORIGINS: base,
    }),
    modules,
  });
  await app.listen({ host: "127.0.0.1", port: address.port });
  let postCount = 0;
  // Observe transport without saving headers or bodies in evidence.
  app.server.on("request", (request) => {
    if (request.method === "POST") postCount += 1;
  });
  cleanups.push(async () => {
    await app.close();
    db.close();
  });
  const events = () =>
    db.connection
      .prepare(
        "SELECT id AS event_id, user_id, type AS event_type, json_extract(candidate_json, '$.data') AS data_json, subject FROM context_event_store",
      )
      .all() as Array<{
      event_id: string;
      user_id: string | null;
      event_type: string;
      data_json: string;
      subject: string;
    }>;

  function launch(extra: string[], token?: string, cwd = root) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("src/server/cli/main.ts"),
        "watch",
        "--server",
        base,
        "--debounce",
        "50",
        ...extra,
      ],
      {
        cwd,
        env: { ...process.env, NODE_OPTIONS: "", TSX_DISABLE_CACHE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stdin.end(token);
    const exited = new Promise<number | null>((done) =>
      child.once("exit", done),
    );
    cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      await exited;
    });
    return { child, exited, output: () => output };
  }

  function record(
    name: string,
    child: { child: ChildProcess; output: () => string },
    observations: Record<string, unknown>,
  ) {
    const logs = child.output() + readFileSync(serverLog, "utf8");
    const secretFree =
      !logs.includes(session.token) && !logs.includes(password);
    const argvSecretFree = !child.child.spawnargs
      .join(" ")
      .includes(session.token);
    const files = readdirSync(root, {
      recursive: true,
      withFileTypes: true,
    }).filter((entry) => entry.isFile());
    const diskSecretFree = files.every((entry) => {
      const contents = readFileSync(join(entry.parentPath, entry.name), "utf8");
      return !contents.includes(session.token) && !contents.includes(password);
    });
    expect(secretFree).toBe(true);
    expect(argvSecretFree).toBe(true);
    expect(diskSecretFree).toBe(true);
    writeFileSync(join(evidence, `${name}.log`), child.output());
    writeFileSync(
      join(evidence, `${name}.json`),
      JSON.stringify(
        { ...observations, secretFree, argvSecretFree, diskSecretFree },
        null,
        2,
      ),
    );
  }
  return {
    root,
    workspace,
    outside,
    session,
    db,
    launch,
    events,
    record,
    posts: () => postCount,
  };
}

describe("real CLI -> filesystem -> HTTP auth gate -> SQLite", () => {
  it("auth-on ingests real edits only from the explicit directory, with user attribution and secret-free output", async () => {
    const f = await fixture(true);
    const child = f.launch(
      ["--dir", f.workspace, "--token-stdin"],
      f.session.token + "\n",
    );
    await until(() => child.output().includes("Watching "));
    const argv = execFileSync(
      "ps",
      ["-p", String(child.child.pid), "-o", "command="],
      { encoding: "utf8" },
    );
    expect(argv).not.toContain(f.session.token);
    writeFileSync(join(f.outside, "outside.ts"), "outside fixture");
    await new Promise((r) => setTimeout(r, 800));
    expect(f.events()).toHaveLength(0);
    writeFileSync(join(f.workspace, "edit.ts"), "fixture edit");
    await until(() =>
      f.events().some((row) => row.event_type === "muses.editor.activity"),
    );
    const rows = f.events();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((r) => r.event_id)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.user_id).toBe(f.session.user.id);
      expect(row.subject).toBe("workspace:explicit project");
      expect(JSON.parse(row.data_json)).not.toHaveProperty("path");
    }
    child.child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    f.record("auth-on", child, {
      ingested: rows.length,
      attributed: true,
      outsideIgnored: true,
      uniqueIds: true,
      liveArgvSecretFree: true,
      exitCode: 0,
    });
  }, 20000);

  it.each(["missing", "invalid"])(
    "auth-on fails closed with %s credentials before watching or posting",
    async (kind) => {
      const f = await fixture(true);
      const child = f.launch(
        [
          "--dir",
          f.workspace,
          ...(kind === "invalid" ? ["--token-stdin"] : []),
        ],
        kind === "invalid" ? "invalid.session.token" : undefined,
      );
      expect(await child.exited).toBe(1);
      expect(child.output()).toContain("requires a valid session token");
      expect(child.output()).not.toContain("Watching ");
      expect(child.output()).not.toContain("invalid.session.token");
      expect(f.posts()).toBe(0);
      expect(f.events()).toHaveLength(0);
      f.record(kind, child, {
        exitCode: 1,
        posts: 0,
        ingested: 0,
        watcherStarted: false,
      });
    },
  );

  it("revocation returns 401, stops the watcher and exits nonzero without re-login", async () => {
    const f = await fixture(true);
    const child = f.launch(
      ["--dir", f.workspace, "--token-stdin"],
      f.session.token,
    );
    await until(() => child.output().includes("Watching "));
    f.db.connection
      .prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .run(f.session.user.id);
    writeFileSync(join(f.workspace, "edit.ts"), "fixture");
    expect(await child.exited).toBe(1);
    expect(child.output()).toContain("HTTP 401; not retrying");
    expect(f.posts()).toBe(1);
    expect(f.events()).toHaveLength(0);
    f.record("revoked-401", child, {
      exitCode: 1,
      posts: 1,
      ingested: 0,
      stopped: true,
    });
  }, 20000);

  it("auth-off keeps anonymous local mode and defaults to the current directory", async () => {
    const f = await fixture(false);
    const child = f.launch([], undefined, f.workspace);
    await until(() => child.output().includes("Watching "));
    writeFileSync(join(f.workspace, "edit.ts"), "fixture");
    await until(() =>
      f.events().some((r) => r.event_type === "muses.editor.activity"),
    );
    expect(f.events().every((r) => r.user_id === null)).toBe(true);
    child.child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    f.record("auth-off", child, {
      exitCode: 0,
      ingested: f.events().length,
      anonymous: true,
      defaultDirectory: true,
    });
  }, 20000);

  it("retired shell entry refuses all arguments and creates no config or processes", () => {
    const root = mkdtempSync(join(evidence, "shell-"));
    const result = spawnSync(
      "/bin/sh",
      [
        resolve("public/signal.sh"),
        "--password",
        "fixture-do-not-echo",
        "--dir",
        "~/Proj",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("fixture-do-not-echo");
    expect(result.stderr).toContain("retired");
    expect(readdirSync(root)).toEqual([]);
    writeFileSync(join(evidence, "shell-retired.log"), result.stderr);
    writeFileSync(
      join(evidence, "shell-retired.json"),
      JSON.stringify({
        exitCode: result.status,
        createdFiles: 0,
        noCredentialEcho: true,
      }),
    );
  });
});
