import { createConnection } from "node:net";

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";
import { createApp } from "./create-app.js";

const openApps: FastifyInstance[] = [];

const mutationPlugin: FastifyPluginAsync = async (app) => {
  app.post("/api/test-mutation", async (request) => ({
    body: request.body,
    ok: true,
  }));
  app.get("/api/test-error", async () => {
    throw new Error("sensitive-stack-marker");
  });
};

async function makeApp(
  mode: "production" | "test" = "test",
): Promise<FastifyInstance> {
  const app = await createApp({
    config: loadRuntimeConfig({
      MUSES_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MUSES_SERVE_STATIC: "false",
      NODE_ENV: mode,
    }),
    logger: false,
    modules: [{ name: "foundation-test", plugin: mutationPlugin }],
  });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("createApp", () => {
  it("exposes the health endpoint", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "muses",
      status: "ok",
      version: "0.3.2",
    });
  });

  it.each([
    "localhost",
    "LOCALHOST:3001",
    "127.0.0.1:65535",
    "[::1]",
    "[0:0:0:0:0:0:0:1]:3001",
  ])("accepts a local Host %s", async (host) => {
    const app = await makeApp();
    const response = await app.inject({
      headers: { host },
      method: "GET",
      url: "/api/health",
    });
    expect(response.statusCode).toBe(200);
  });

  it.each([
    "rebind.example:3001",
    "localhost.evil:3001",
    "localhost@rebind.example:3001",
    "localhost:abc",
    "localhost:65536",
    "localhost:",
    "localhost,127.0.0.1",
    "localhost/evil",
    "[::ffff:127.0.0.1]:3001",
    "[fe80::1%25lo0]:3001",
  ])("rejects an untrusted Host %s before serving the API", async (host) => {
    const app = await makeApp();
    const response = await app.inject({
      headers: { host, origin: "http://127.0.0.1:5173" },
      method: "GET",
      url: "/api/health",
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "HOST_NOT_ALLOWED" },
    });
  });

  it("checks Host before preflight and rejects forwarded-host spoofing", async () => {
    const app = await makeApp();
    const response = await app.inject({
      headers: {
        host: "rebind.example:3001",
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST",
        "x-forwarded-host": "127.0.0.1:3001",
      },
      method: "OPTIONS",
      url: "/api/test-mutation",
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "HOST_NOT_ALLOWED" },
    });
  });

  it("enforces Host on a real local socket with a dynamically assigned port", async () => {
    const app = await makeApp();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("No TCP address");
    }
    const query = (hostHeaders: string): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: address.port,
        });
        let received = "";
        socket.setTimeout(5_000, () =>
          socket.destroy(new Error("socket timeout")),
        );
        socket.on("connect", () => {
          socket.write(
            `GET /api/health HTTP/1.1\r\n${hostHeaders}Connection: close\r\n\r\n`,
          );
        });
        socket.on("data", (chunk: Buffer) => (received += chunk.toString()));
        socket.on("end", () => resolve(received));
        socket.on("error", reject);
      });
    const valid = await query(`Host: 127.0.0.1:${address.port}\r\n`);
    expect(valid).toMatch(/^HTTP\/1\.1 200 /);
    const malicious = await query(`Host: rebind.example:${address.port}\r\n`);
    expect(malicious).toMatch(/^HTTP\/1\.1 403 /);
    const duplicated = await query(
      "Host: localhost\r\nHost: rebind.example\r\n",
    );
    expect(duplicated).toMatch(/^HTTP\/1\.1 (400|403) /);
    const missing = await query("");
    expect(missing).toMatch(/^HTTP\/1\.1 (400|403) /);
    expect(malicious + duplicated + missing).not.toContain('"status":"ok"');
  });

  it("rejects mutations without an allowed Origin", async () => {
    const app = await makeApp();
    const response = await app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: {},
      url: "/api/test-mutation",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "ORIGIN_NOT_ALLOWED" },
    });
  });

  it("rejects non-JSON mutation content", async () => {
    const app = await makeApp();
    const response = await app.inject({
      headers: { origin: "http://127.0.0.1:5173" },
      method: "POST",
      payload: "not-json",
      url: "/api/test-mutation",
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });
  });

  it("accepts an allow-listed JSON mutation", async () => {
    const app = await makeApp();
    const response = await app.inject({
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
      },
      method: "POST",
      payload: { value: 1 },
      url: "/api/test-mutation",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ body: { value: 1 }, ok: true });
  });

  it("does not leak internal error details in production", async () => {
    const app = await makeApp("production");
    const response = await app.inject({
      method: "GET",
      url: "/api/test-error",
    });
    const body = response.json<{ error: { message: string } }>();

    expect(response.statusCode).toBe(500);
    expect(body.error.message).toBe("An unexpected error occurred");
    expect(response.body).not.toContain("sensitive-stack-marker");
  });

  it("returns a structured 404 response", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/api/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
});
