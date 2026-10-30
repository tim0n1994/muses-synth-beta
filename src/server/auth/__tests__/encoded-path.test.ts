import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, runMigrations } from "../../db/index.js";
import { createAuthModule } from "../module.js";
import { enabledAuthConfig, registerViaApi } from "../test-support.js";
import { clientRateKey } from "../ratelimit.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) {
      await cleanup();
    }
  }
});

async function createApp(): Promise<FastifyInstance> {
  const directory = mkdtempSync(join(tmpdir(), "muses-encoded-test-"));
  const opened = openDatabase(join(directory, "muses.sqlite"));
  runMigrations(opened.connection, { purpose: "test" });
  const app = Fastify({ logger: false });
  app.get("/api/v1/protected", (request) => ({
    userId: request.user?.id ?? null,
  }));
  app.post("/api/v1/mutate", () => ({ ok: true }));
  await app.register(
    createAuthModule({
      config: enabledAuthConfig(),
      database: opened.connection,
    }),
  );
  cleanups.push(async () => {
    await app.close();
    opened.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await app.ready();
  return app;
}

/**
 * Percent-encoded "/api" prefixes must not bypass the bearer gate or the
 * origin hook: find-my-way decodes path segments before matching, so both
 * hooks must judge the decoded form. Regression for the gate bypass found
 * in review ("/%61pi/settings" reached handlers unauthenticated).
 */
describe("encoded-path gate coverage", () => {
  it.each([
    "/%61pi/v1/protected",
    "/%61%70%69/v1/protected",
    "/a%70i/v1/protected",
  ])("rejects unauthenticated %s", async (url) => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "AUTH_REQUIRED",
    );
  });

  it("admits a valid token through an encoded path", async () => {
    const app = await createApp();
    const { token } = await registerViaApi(
      app,
      "encoded@example.com",
      "password-123",
    );
    const response = await app.inject({
      method: "GET",
      url: "/%61pi/v1/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("fails closed on malformed percent-encoding", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/%zz-api/thing" });
    // find-my-way rejects the malformed URL itself (400) before hooks run;
    // either way the handler is unreachable — fail closed.
    expect([400, 401]).toContain(response.statusCode);
  });
});

describe("clientRateKey trusts only edge-set identity", () => {
  it("ignores visitor-supplied X-Forwarded-For", () => {
    const app = Fastify();
    app.get("/probe", (request, reply) => {
      reply.send({ key: clientRateKey(request) });
    });
    cleanups.push(() => app.close());
    return app
      .inject({
        method: "GET",
        url: "/probe",
        headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      })
      .then((response) => {
        expect(response.json<{ key: string }>().key).not.toBe("ip:1.2.3.4");
      });
  });

  it("prefers CF-Connecting-IP when the edge set it", () => {
    const app = Fastify();
    app.get("/probe", (request, reply) => {
      reply.send({ key: clientRateKey(request) });
    });
    cleanups.push(() => app.close());
    return app
      .inject({
        method: "GET",
        url: "/probe",
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": "1.2.3.4",
        },
      })
      .then((response) => {
        expect(response.json<{ key: string }>().key).toBe("ip:203.0.113.9");
      });
  });
});
