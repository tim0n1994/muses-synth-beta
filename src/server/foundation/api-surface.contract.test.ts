import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";
import { createApp } from "./create-app.js";
import { buildRuntimeModules } from "./runtime-modules.js";

/**
 * Every route the shipped browser clients call, with the method they use.
 *
 * This exists because the v0.1 settings workspace called four paths the server
 * never registered — `GET /api/settings/snapshot`, `POST /api/settings/draft/
 * validate`, `POST /api/settings/draft/preview` — and the failure only ever
 * surfaced as a 404 banner in a browser. A route table asserted against the
 * real app catches that class of drift in the gate instead.
 *
 * Sources of truth for this list:
 *   src/web/settings/api/settingsClient.ts
 *   src/web/dashboard/api.ts
 */
const CLIENT_ROUTES: ReadonlyArray<{
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  readonly caller: string;
}> = [
  { method: "GET", url: "/api/health", caller: "foundation status page" },
  { method: "GET", url: "/api/v1/bootstrap", caller: "dashboard snapshot" },
  { method: "GET", url: "/api/v1/context/events", caller: "dashboard events" },
  { method: "POST", url: "/api/v1/context/events", caller: "event ingestion" },
  { method: "GET", url: "/api/v1/belief/current", caller: "belief probes" },
  { method: "POST", url: "/api/v1/belief/replay", caller: "belief replay" },
  {
    method: "GET",
    url: "/api/v1/decisions/current",
    caller: "decision probes",
  },
  { method: "GET", url: "/api/v1/effects/current", caller: "effect probes" },
  {
    method: "POST",
    url: "/api/v1/effects/outcomes",
    caller: "audio runtime outcome reporting",
  },
  {
    method: "POST",
    url: "/api/v1/llm/narration",
    caller: "dashboard llm narration panel",
  },
  {
    method: "POST",
    url: "/api/v1/llm/summary",
    caller: "dashboard llm narration panel",
  },
  { method: "GET", url: "/api/settings", caller: "settings snapshot" },
  { method: "GET", url: "/api/settings/draft", caller: "settings draft read" },
  { method: "PUT", url: "/api/settings/draft", caller: "settings draft save" },
  { method: "POST", url: "/api/settings/preview", caller: "settings preview" },
  { method: "POST", url: "/api/settings/publish", caller: "settings publish" },
  { method: "GET", url: "/api/settings/releases", caller: "release history" },
  { method: "GET", url: "/api/settings/history", caller: "audit history" },
  {
    method: "POST",
    url: "/api/settings/releases/does-not-exist/rollback",
    caller: "settings rollback",
  },
];

let app: FastifyInstance;
let close: () => Promise<void>;
let directory: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "muses-api-contract-"));
  process.env.MUSES_DATABASE_PATH = join(directory, "muses.sqlite");
  const runtime = await buildRuntimeModules();
  close = runtime.close;
  app = await createApp({
    config: loadRuntimeConfig({
      MUSES_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MUSES_SERVE_STATIC: "false",
      NODE_ENV: "test",
    }),
    logger: false,
    modules: runtime.modules,
  });
});

afterAll(async () => {
  await app.close();
  await close();
  delete process.env.MUSES_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("local API surface", () => {
  it.each(CLIENT_ROUTES)(
    "$method $url is registered (used by $caller)",
    async ({ method, url }) => {
      const response = await app.inject({
        method,
        url,
        headers: { origin: "http://127.0.0.1:5173" },
        ...(method === "GET" ? {} : { payload: {} }),
      });

      // A registered route may legitimately reject an empty payload (400/422)
      // or a missing resource (404 on the rollback probe's fake id). What must
      // never happen is the framework 404 that means "no such route".
      expect(response.statusCode).not.toBe(405);
      if (response.statusCode === 404) {
        const body = response.json<{ error?: { code?: string } }>();
        expect(
          body.error?.code,
          `${method} ${url} returned a routing 404 — no handler is registered`,
        ).not.toBe("NOT_FOUND");
      }
    },
  );

  it("serves the bootstrap aggregate with every section the dashboard reads", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual([
      "belief",
      "decision",
      "effect",
      "generatedAt",
      "llm",
      "settings",
    ]);
    // The optional LLM layer must be inert without gateway environment:
    // unconfigured, unavailable, and still present so clients can rely on
    // the shape.
    const llm = body.llm as Record<string, unknown>;
    expect(llm).toEqual({
      available: false,
      enabled: false,
      configured: false,
      model: "auto",
      reason: "unconfigured",
    });
    // The dashboard reads settings.currentRelease.document.surface.widgets to
    // compose itself; an aggregate without it renders an empty Observatory.
    const settings = body.settings as {
      currentRelease: { document: { surface: { widgets: unknown[] } } };
    };
    expect(
      Array.isArray(settings.currentRelease.document.surface.widgets),
    ).toBe(true);
  });
});
