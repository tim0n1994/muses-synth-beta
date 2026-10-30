import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, runMigrations } from "../db/index.js";
import { createApp } from "../foundation/create-app.js";
import { loadRuntimeConfig } from "../foundation/config.js";
import { buildRuntimeModules } from "../foundation/runtime-modules.js";
import { createAuthModule } from "./module.js";
import { enabledAuthConfig, registerViaApi } from "./test-support.js";

interface GateApp {
  readonly app: FastifyInstance;
  readonly cleanup: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) {
      await cleanup();
    }
  }
});

/**
 * Sibling routes are registered BEFORE the auth module on purpose: the gate
 * hook attaches at app scope (skip-override), so it must cover routes that
 * were registered earlier — exactly how foundation modules relate to the
 * auth module in the real wiring.
 */
async function createGateApp(): Promise<GateApp> {
  const directory = mkdtempSync(join(tmpdir(), "muses-auth-gate-test-"));
  const opened = openDatabase(join(directory, "muses.sqlite"));
  runMigrations(opened.connection, { purpose: "test" });
  const app = Fastify({ logger: false });
  app.get("/api/v1/protected", (request) => ({
    userId: request.user?.id ?? null,
  }));
  app.get("/api/health", () => ({ status: "ok" }));
  app.get("/", () => "static index");
  app.get("/assets/app.js", () => "asset");
  await app.register(
    createAuthModule({
      config: enabledAuthConfig(),
      database: opened.connection,
    }),
  );
  return {
    app,
    cleanup: async () => {
      await app.close();
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe("bearer gate", () => {
  it("rejects anonymous API requests with the AUTH_REQUIRED envelope", async () => {
    const { app } = await createGateApp();
    cleanups.push(() => app.close());
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/protected",
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{
      error: { code: string; message: string; requestId: string };
    }>();
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it("injects request.user for valid tokens on sibling routes", async () => {
    const { app, cleanup } = await createGateApp();
    cleanups.push(cleanup);
    const session = await registerViaApi(app, "gate@example.com", "secret1");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/protected",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ userId: string | null }>().userId).toBe(
      session.user.id,
    );
  });

  it("rejects tampered tokens with AUTH_INVALID", async () => {
    const { app, cleanup } = await createGateApp();
    cleanups.push(cleanup);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/protected",
      headers: { authorization: "Bearer x.y.z" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "AUTH_INVALID",
    );
  });

  it("lets CORS preflights and non-API (static) paths through", async () => {
    const { app, cleanup } = await createGateApp();
    cleanups.push(cleanup);

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/protected",
      headers: { origin: "http://localhost:5173" },
    });
    expect(preflight.statusCode).not.toBe(401);

    const index = await app.inject({ method: "GET", url: "/" });
    expect(index.statusCode).toBe(200);
    expect(index.body).toBe("static index");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
  });

  it("keeps health and the four anonymous auth endpoints public", async () => {
    const { app, cleanup } = await createGateApp();
    cleanups.push(cleanup);

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);

    const sendCode = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "anon@example.com", purpose: "register" },
    });
    expect(sendCode.statusCode).toBe(200);

    // A stale/invalid Authorization on an anonymous endpoint must not break
    // re-login flows.
    const withStaleToken = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      headers: { authorization: "Bearer stale-token" },
      payload: { email: "anon2@example.com", purpose: "register" },
    });
    expect(withStaleToken.statusCode).toBe(200);
  });

  it("leaves everything public when the auth module is absent (disabled)", async () => {
    const app = Fastify({ logger: false });
    app.get("/api/v1/protected", () => ({ userId: null }));
    cleanups.push(() => app.close());
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/protected",
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("full assembly (createApp + buildRuntimeModules)", () => {
  // Two full buildRuntimeModules assemblies plus registrations land close to
  // the 5s default when the suite runs in parallel; give it headroom rather
  // than flaking under load (noted with the v0.6 personal-space tests).
  it(
    "gates sibling foundation modules when enabled and leaves them open when disabled",
    { timeout: 30_000 },
    async () => {
      const databaseDirectory = mkdtempSync(
        join(tmpdir(), "muses-auth-full-test-"),
      );
      const previousDatabasePath = process.env.MUSES_DATABASE_PATH;
      process.env.MUSES_DATABASE_PATH = join(databaseDirectory, "muses.sqlite");

      try {
        const enabledRuntime = await buildRuntimeModules({
          auth: enabledAuthConfig(),
        });
        const enabledApp = await createApp({
          config: loadRuntimeConfig({ NODE_ENV: "test" }),
          logger: false,
          modules: enabledRuntime.modules,
        });

        const anonymous = await enabledApp.inject({
          method: "GET",
          url: "/api/v1/belief/current",
        });
        expect(anonymous.statusCode).toBe(401);
        expect(anonymous.json<{ error: { code: string } }>().error.code).toBe(
          "AUTH_REQUIRED",
        );

        const health = await enabledApp.inject({
          method: "GET",
          url: "/api/health",
        });
        expect(health.statusCode).toBe(200);

        // With a session, the sibling module is reachable again.
        const session = await registerViaApi(
          enabledApp,
          "full@example.com",
          "secret1",
        );
        const authorized = await enabledApp.inject({
          method: "GET",
          url: "/api/v1/belief/current",
          headers: { authorization: `Bearer ${session.token}` },
        });
        expect(authorized.statusCode).not.toBe(401);

        await enabledApp.close();
        await enabledRuntime.close();

        // Disabled: byte-for-byte the previous behavior — no gate anywhere.
        const disabledRuntime = await buildRuntimeModules({
          auth: null,
        });
        const disabledApp = await createApp({
          config: loadRuntimeConfig({ NODE_ENV: "test" }),
          logger: false,
          modules: disabledRuntime.modules,
        });
        const open = await disabledApp.inject({
          method: "GET",
          url: "/api/v1/belief/current",
        });
        expect(open.statusCode).not.toBe(401);
        await disabledApp.close();
        await disabledRuntime.close();
      } finally {
        if (previousDatabasePath === undefined) {
          delete process.env.MUSES_DATABASE_PATH;
        } else {
          process.env.MUSES_DATABASE_PATH = previousDatabasePath;
        }
        rmSync(databaseDirectory, { recursive: true, force: true });
      }
    },
  );
});
