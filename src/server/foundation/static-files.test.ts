import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";
import { createApp } from "./create-app.js";

const openApps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
  );
});

async function makeStaticApp(
  extraEnv: Record<string, string> = {},
): Promise<{ app: FastifyInstance; staticRoot: string }> {
  const staticRoot = await mkdtemp(join(tmpdir(), "muses-static-"));
  temporaryDirectories.push(staticRoot);
  await writeFile(
    join(staticRoot, "index.html"),
    "<!doctype html><head></head><title>Muses test shell</title>",
  );

  const app = await createApp({
    config: loadRuntimeConfig({
      MUSES_ALLOWED_ORIGINS: "http://127.0.0.1:4173",
      MUSES_SERVE_STATIC: "true",
      MUSES_STATIC_ROOT: staticRoot,
      NODE_ENV: "production",
      ...extraEnv,
    }),
    logger: false,
  });
  openApps.push(app);
  return { app, staticRoot };
}

describe("production static serving", () => {
  it.each(["/index.html", "/dashboard/deep-link"])(
    "rejects an untrusted Host before serving %s",
    async (url) => {
      const { app } = await makeStaticApp();
      const response = await app.inject({
        headers: { accept: "text/html", host: "rebind.example:3001" },
        method: "GET",
        url,
      });
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain("Muses test shell");
    },
  );

  it("serves the SPA shell for an HTML deep link", async () => {
    const { app } = await makeStaticApp();
    const response = await app.inject({
      headers: { accept: "text/html" },
      method: "GET",
      url: "/settings/history",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Muses test shell");
  });

  it("keeps unknown API paths as structured 404 responses", async () => {
    const { app } = await makeStaticApp();
    const response = await app.inject({
      headers: { accept: "application/json" },
      method: "GET",
      url: "/api/not-registered",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("v0.7 client-surface feature hint (review B2)", () => {
  it("flag-off serves the shell byte-identical with no injected hint", async () => {
    const { app, staticRoot } = await makeStaticApp();
    const response = await app.inject({
      headers: { accept: "text/html" },
      method: "GET",
      url: "/self-track",
    });

    expect(response.statusCode).toBe(200);
    // Exactly the file on disk — the flag-off regression guarantee for the
    // client surface: v0.6 served these bytes for this URL, and so do we.
    const onDisk = await readFile(join(staticRoot, "index.html"), "utf8");
    expect(response.body).toBe(onDisk);
    expect(response.body).not.toContain("muses-features");
    // sendFile semantics (etag present) are preserved on the untouched path.
    expect(response.headers.etag).toBeDefined();
  });

  it.each([
    {
      env: { MUSES_V07: "1" },
      hint: '{"selfTrack":true,"replay":false}',
    },
    {
      env: { MUSES_V07: "1", MUSES_V07_REPLAY: "1" },
      hint: '{"selfTrack":true,"replay":true}',
    },
    {
      // Dirty switch values fail closed: no hint is injected at all.
      env: { MUSES_V07: " 1", MUSES_V07_REPLAY: "1" },
      hint: null,
    },
  ])(
    "env %j injects hint %j only while the switches are cleanly on",
    async ({ env, hint }) => {
      const { app } = await makeStaticApp(env);
      const response = await app.inject({
        headers: { accept: "text/html" },
        method: "GET",
        url: "/self-track",
      });

      expect(response.statusCode).toBe(200);
      if (hint === null) {
        expect(response.body).not.toContain("muses-features");
        return;
      }
      expect(response.body).toContain(
        `<meta name="muses-features" content='${hint}'>`,
      );
      // The injected variant must not be cached as the plain shell.
      expect(response.headers["cache-control"]).toBe("no-cache");
    },
  );

  it("does not inject for non-HTML accepts", async () => {
    const { app } = await makeStaticApp({ MUSES_V07: "1" });
    const response = await app.inject({
      headers: { accept: "application/json" },
      method: "GET",
      url: "/self-track",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
