import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { enabledAuthConfig, registerViaApi } from "../auth/test-support.js";
import { openDatabase } from "../db/index.js";
import { loadRuntimeConfig } from "./config.js";
import { createApp } from "./create-app.js";
import { buildRuntimeModules } from "./runtime-modules.js";

/**
 * v0.7 per-user release gate (CTO Round-2 repair order, root cause #1: the
 * switch was global — anonymous HTML carried the v0.7 feature hint and any
 * signed-in account could call the v0.7 APIs).
 *
 * Contract under test, with MUSES_V07 (and MUSES_V07_REPLAY) ON and auth ON:
 *   - MUSES_V07_USERS is a comma-separated allowlist of user ids.
 *   - A caller that is not on the list — anonymous, a bad token, or any
 *     signed-in account outside the list — gets 404 NOT_FOUND from EVERY
 *     v0.7 API (never 403, never 401: the surface must look nonexistent)
 *     and the untouched SPA shell (no <meta name="muses-features"> hint).
 *   - A listed caller gets the real answers and the hint.
 *   - Unset/empty list = nobody (fail-closed). Batch-2 layering unchanged.
 *   - v0.6 surfaces are untouched for everyone.
 *
 * Four identities x two faces (API | HTML), every cell asserted.
 */

const ORIGIN = "http://127.0.0.1:3001";
const HINT_MARKER = '<meta name="muses-features"';

const V07_GET_APIS = [
  "/api/v1/self-track/plan",
  "/api/v1/belief/pulse/current",
  "/api/v1/journeys",
  "/api/v1/features",
] as const;

const FLAG_KEYS = [
  "MUSES_V07",
  "MUSES_V07_REPLAY",
  "MUSES_V07_USERS",
  "MUSES_DATABASE_PATH",
] as const;
type FlagKey = (typeof FLAG_KEYS)[number];
type Flags = Partial<Record<Exclude<FlagKey, "MUSES_DATABASE_PATH">, string>>;

interface Opened {
  readonly app: FastifyInstance;
  readonly close: () => Promise<void>;
}

interface Session {
  readonly token: string;
  readonly userId: string;
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
 * One temp workspace (SQLite file + static root) that survives across
 * open() calls: user ids are minted by the register API, so the allowlist
 * can only be known AFTER a first process created the accounts — exactly
 * the production sequence (register, then set MUSES_V07_USERS, restart).
 */
function createWorkspace(): {
  readonly databasePath: string;
  open(flags: Flags, auth: "on" | "off"): Promise<Opened>;
} {
  const directory = mkdtempSync(join(tmpdir(), "muses-v07-allowlist-"));
  const staticRoot = join(directory, "static");
  const databasePath = join(directory, "muses.sqlite");
  // A minimal shell with a </head> so the hint injection point exists.
  mkdirSync(staticRoot, { recursive: true });
  writeFileSync(
    join(staticRoot, "index.html"),
    "<!doctype html><html><head></head><body>Muses v07 allowlist shell</body></html>",
  );
  cleanups.push(async () => {
    rmSync(directory, { recursive: true, force: true });
  });

  return {
    databasePath,
    async open(flags, auth) {
      const saved: Partial<Record<FlagKey, string | undefined>> = {};
      for (const key of FLAG_KEYS) {
        saved[key] = process.env[key];
      }
      process.env.MUSES_DATABASE_PATH = databasePath;
      for (const key of [
        "MUSES_V07",
        "MUSES_V07_REPLAY",
        "MUSES_V07_USERS",
      ] as const) {
        const value = flags[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      const runtime = await buildRuntimeModules({
        auth:
          auth === "on"
            ? enabledAuthConfig({ MUSES_ADMIN_EMAILS: "root@example.com" })
            : null,
      });
      const app = await createApp({
        config: loadRuntimeConfig({
          MUSES_ALLOWED_ORIGINS: ORIGIN,
          MUSES_SERVE_STATIC: "true",
          MUSES_STATIC_ROOT: staticRoot,
          NODE_ENV: "production",
          ...(flags.MUSES_V07 === undefined
            ? {}
            : { MUSES_V07: flags.MUSES_V07 }),
          ...(flags.MUSES_V07_REPLAY === undefined
            ? {}
            : { MUSES_V07_REPLAY: flags.MUSES_V07_REPLAY }),
          ...(flags.MUSES_V07_USERS === undefined
            ? {}
            : { MUSES_V07_USERS: flags.MUSES_V07_USERS }),
        }),
        logger: false,
        modules: runtime.modules,
        v07Access: runtime.v07Access,
      });
      const close = async (): Promise<void> => {
        await app.close();
        await runtime.close();
        for (const key of FLAG_KEYS) {
          const value = saved[key];
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      };
      cleanups.push(close);
      return { app, close };
    },
  };
}

async function registerUser(
  app: FastifyInstance,
  email: string,
): Promise<Session> {
  const session = await registerViaApi(app, email, "secret1");
  return { token: session.token, userId: session.user.id };
}

/** Three self-track rows so the plan API has a library to answer from. */
function seedSelfTracks(databasePath: string): void {
  const opened = openDatabase(databasePath);
  const hex = "a".repeat(64);
  const insert = opened.connection.prepare(`
    INSERT INTO library_tracks (
      id, track_pool, bucket, title, author, source, source_url, audio_url,
      audio_path, license, license_url, license_evidence_url, snapshot_path,
      snapshot_sha256, content_sha256, duration_seconds, size_bytes,
      bitrate_kbps, mime_type, features_json, bucket_rule_version,
      pro_registered, ingested_at
    ) VALUES (
      ?, 'self', 'self_mid_mid', ?, 'Pilot Author', 'fma', ?, ?,
      ?, 'CC-BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
      'https://example.org/license', ?, ?, ?, 180, 1000, 96, 'audio/ogg',
      '{}', 'v1', 0, '2026-10-20T00:00:00.000Z'
    )
  `);
  for (const id of ["seed-1", "seed-2", "seed-3"]) {
    insert.run(
      id,
      `Track ${id}`,
      `https://example.org/${id}`,
      `/library/self/self_mid_mid/${id}.opus`,
      `self/self_mid_mid/${id}.opus`,
      `snapshots/${id}.json`,
      hex,
      hex,
    );
  }
  opened.close();
}

const apiHeaders = (token: string | null): Record<string, string> => ({
  origin: ORIGIN,
  accept: "application/json",
  ...(token === null ? {} : { authorization: `Bearer ${token}` }),
});

const htmlHeaders = (token: string | null): Record<string, string> => ({
  accept: "text/html",
  ...(token === null ? {} : { authorization: `Bearer ${token}` }),
});

async function getApi(
  app: FastifyInstance,
  token: string | null,
  url: string,
): Promise<{ status: number; body: string }> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: apiHeaders(token),
  });
  return { status: response.statusCode, body: response.body };
}

async function getShell(
  app: FastifyInstance,
  token: string | null,
): Promise<{ status: number; body: string }> {
  const response = await app.inject({
    method: "GET",
    url: "/self-track",
    headers: htmlHeaders(token),
  });
  return { status: response.statusCode, body: response.body };
}

/** The concealment envelope must be indistinguishable from a routing 404. */
function expectConcealed(
  result: { status: number; body: string },
  label: string,
): void {
  expect(result.status, `${label}: status`).toBe(404);
  expect(JSON.parse(result.body), `${label}: envelope`).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
}

describe("v0.7 per-user allowlist (MUSES_V07_USERS) — four identities x two faces", () => {
  it("anonymous, a bad token, user A and user B are concealed (API 404 + unmarked shell); only the listed user W is admitted (API 200 + hint)", async () => {
    const workspace = createWorkspace();

    // Phase 1: mint the three accounts (the allowlist needs W's id).
    const boot = await workspace.open({}, "on");
    const a = await registerUser(boot.app, "a@example.com");
    const b = await registerUser(boot.app, "b@example.com");
    const w = await registerUser(boot.app, "w@example.com");
    await boot.close();
    cleanups.splice(cleanups.indexOf(boot.close), 1);
    seedSelfTracks(workspace.databasePath);

    // Phase 2: switches on, allowlist = W only.
    const { app } = await workspace.open(
      { MUSES_V07: "1", MUSES_V07_REPLAY: "1", MUSES_V07_USERS: w.userId },
      "on",
    );

    const concealedIdentities: ReadonlyArray<[string, string | null]> = [
      ["anonymous", null],
      ["bad token", "not-a-real-token"],
      ["user A", a.token],
      ["user B", b.token],
    ];

    // Face 1 — API: every v0.7 route answers 404 NOT_FOUND to the outsiders.
    for (const [label, token] of concealedIdentities) {
      for (const url of V07_GET_APIS) {
        expectConcealed(await getApi(app, token, url), `${label} GET ${url}`);
      }
    }

    // Face 2 — HTML: the outsiders receive the untouched shell, no hint.
    for (const [label, token] of concealedIdentities) {
      const shell = await getShell(app, token);
      expect(shell.status, `${label}: shell status`).toBe(200);
      expect(shell.body, `${label}: shell must carry no hint`).not.toContain(
        HINT_MARKER,
      );
    }

    // The listed user: real answers on both faces.
    const plan = await getApi(app, w.token, "/api/v1/self-track/plan");
    expect(plan.status, "W plan").toBe(200);
    const pulse = await getApi(app, w.token, "/api/v1/belief/pulse/current");
    expect(pulse.status, "W pulse").toBe(200);
    const journeys = await getApi(app, w.token, "/api/v1/journeys");
    expect(journeys.status, "W journeys").toBe(200);
    expect(JSON.parse(journeys.body)).toMatchObject({ items: [] });
    const features = await getApi(app, w.token, "/api/v1/features");
    expect(features.status, "W features").toBe(200);
    expect(JSON.parse(features.body)).toEqual({
      selfTrack: true,
      replay: true,
    });

    const wShell = await getShell(app, w.token);
    expect(wShell.status).toBe(200);
    expect(wShell.body).toContain(
      `<meta name="muses-features" content='{"selfTrack":true,"replay":true}'>`,
    );
    expect(wShell.body).toContain("Muses v07 allowlist shell");

    // v0.6 surfaces are untouched for A and B (the gate does not over-reach).
    for (const [label, token] of [
      ["user A", a.token],
      ["user B", b.token],
    ] as const) {
      const bootstrap = await getApi(app, token, "/api/v1/bootstrap");
      expect(bootstrap.status, `${label} v0.6 bootstrap`).toBe(200);
      const me = await getApi(app, token, "/api/auth/me");
      expect(me.status, `${label} v0.6 auth/me`).toBe(200);
    }
    // And anonymous still meets the v0.6 bearer gate on v0.6 routes (401,
    // not 404): concealment is scoped to the v0.7 surface only.
    const anonymousBootstrap = await getApi(app, null, "/api/v1/bootstrap");
    expect(anonymousBootstrap.status).toBe(401);
  });

  it("an unset allowlist admits nobody while auth is on (fail-closed), and a padded entry still names its user", async () => {
    const workspace = createWorkspace();
    const boot = await workspace.open({}, "on");
    const w = await registerUser(boot.app, "w@example.com");
    await boot.close();
    cleanups.splice(cleanups.indexOf(boot.close), 1);

    const dark = await workspace.open(
      { MUSES_V07: "1", MUSES_V07_REPLAY: "1" },
      "on",
    );
    for (const url of V07_GET_APIS) {
      expectConcealed(
        await getApi(dark.app, w.token, url),
        `unset list ${url}`,
      );
    }
    expect((await getShell(dark.app, w.token)).body).not.toContain(HINT_MARKER);
    await dark.close();
    cleanups.splice(cleanups.indexOf(dark.close), 1);

    const padded = await workspace.open(
      {
        MUSES_V07: "1",
        MUSES_V07_REPLAY: "1",
        MUSES_V07_USERS: ` other-id , ${w.userId} ,`,
      },
      "on",
    );
    expect((await getApi(padded.app, w.token, "/api/v1/features")).status).toBe(
      200,
    );
    expect((await getShell(padded.app, w.token)).body).toContain(HINT_MARKER);
  });

  it("keeps the batch-2 layering: MUSES_V07_REPLAY off hides journeys from the listed user too and the hint says replay:false", async () => {
    const workspace = createWorkspace();
    const boot = await workspace.open({}, "on");
    const w = await registerUser(boot.app, "w@example.com");
    await boot.close();
    cleanups.splice(cleanups.indexOf(boot.close), 1);

    const { app } = await workspace.open(
      { MUSES_V07: "1", MUSES_V07_USERS: w.userId },
      "on",
    );
    expect(
      (await getApi(app, w.token, "/api/v1/belief/pulse/current")).status,
    ).toBe(200);
    expectConcealed(
      await getApi(app, w.token, "/api/v1/journeys"),
      "replay off journeys",
    );
    const features = await getApi(app, w.token, "/api/v1/features");
    expect(features.status).toBe(200);
    expect(JSON.parse(features.body)).toEqual({
      selfTrack: true,
      replay: false,
    });
    expect((await getShell(app, w.token)).body).toContain(
      `<meta name="muses-features" content='{"selfTrack":true,"replay":false}'>`,
    );
  });

  it("MUSES_V07 off: the allowlist changes nothing — no v0.7 route exists and the shell is untouched even for a listed user", async () => {
    const workspace = createWorkspace();
    const boot = await workspace.open({}, "on");
    const w = await registerUser(boot.app, "w@example.com");
    await boot.close();
    cleanups.splice(cleanups.indexOf(boot.close), 1);

    const { app } = await workspace.open({ MUSES_V07_USERS: w.userId }, "on");
    for (const url of V07_GET_APIS) {
      const result = await getApi(app, w.token, url);
      expect(result.status, `flag-off ${url}`).toBe(404);
    }
    expect((await getShell(app, w.token)).body).not.toContain(HINT_MARKER);
  });

  it("local single-user mode (auth off) keeps v0.7 reachable without an allowlist — there is no account to list", async () => {
    const workspace = createWorkspace();
    const { app } = await workspace.open(
      { MUSES_V07: "1", MUSES_V07_REPLAY: "1" },
      "off",
    );
    seedSelfTracks(workspace.databasePath);
    expect((await getApi(app, null, "/api/v1/self-track/plan")).status).toBe(
      200,
    );
    expect((await getApi(app, null, "/api/v1/journeys")).status).toBe(200);
    const features = await getApi(app, null, "/api/v1/features");
    expect(features.status).toBe(200);
    expect(JSON.parse(features.body)).toEqual({
      selfTrack: true,
      replay: true,
    });
    expect((await getShell(app, null)).body).toContain(HINT_MARKER);
  });
});
