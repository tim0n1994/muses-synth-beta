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
      version: "0.3.2-beta.1",
    });
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
