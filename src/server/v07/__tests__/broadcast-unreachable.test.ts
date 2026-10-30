import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { spawn, execFile } from "node:child_process";

import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";

import { loadRuntimeConfig } from "../../foundation/config.js";
import { createApp } from "../../foundation/create-app.js";
import { buildRuntimeModules } from "../../foundation/runtime-modules.js";
import { openDatabase } from "../../db/index.js";
import type { MigrationDefinition } from "../../db/migrations.js";
import { migration001Initial } from "../../db/migrations/001_initial.js";
import { migration002IntegrityTriggers } from "../../db/migrations/002_integrity_triggers.js";
import { migration003Auth } from "../../db/migrations/003_auth.js";
import { migration004UserAttribution } from "../../db/migrations/004_user_attribution.js";
import { isJourneyReplayEnabled } from "../../journey/module.js";
import { isVibeSignalEnabled } from "../../vibe-signal/module.js";
import {
  enabledAuthConfig,
  registerViaApi,
  type RegisteredSession,
} from "../../auth/test-support.js";
import type { AuthConfig } from "../../auth/config.js";

/**
 * Broadcast paths are unreachable by default (V10) and MUSES_V07-off means
 * v0.6-identical production behavior (V11) — the two acceptance sentences in
 * v07-design.md §四. Test design follows the audit draft
 * ("broadcastUnreachableTests"), groups T1–T7:
 *
 *  T1  route-table static assertion — handlers never registered
 *  T2  HTTP status matrix (auth off/on × anonymous/forged/valid)
 *  T3  encoded paths cannot conjure routes (fail-closed)
 *  T4  module graph + process + DB-layer unreachability
 *  T5  flag-off (unset and dirty values) = byte-identical v0.6 responses
 *  T6  switch parsing: illegal values fail closed to off, never throw
 *  T7  flag-on control arm (guards T1 against rename false-negatives)
 *
 * Two deviations from the audit draft, documented per its own
 * "sync with the landed registry" instruction:
 *
 *  - T2: the auth gate is /api-scoped by design (src/server/auth/module.ts
 *    isApiPath), so the non-API broadcast exits (/rss, /feed, /stream,
 *    /listen/*) answer the routing 404 to EVERY identity, including
 *    anonymous — the 401-before-404 ordering only holds for /api paths.
 *  - T4.4: the draft assumed a flag-off boot creates no v0.7 tables. The
 *    landed migration design (005/006/007 headers, V11 "reversible additive
 *    migrations") always applies the additive CREATE TABLE IF NOT EXISTS
 *    set — validateDefinitions requires contiguous versions, so skipping
 *    per-flag is impossible. The tested guarantee is therefore: the schema
 *    delta is EXACTLY the four declared v0.7 tables and they stay EMPTY
 *    while the switch is off.
 */

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  fork: vi.fn(),
}));

/**
 * Broadcast surface inventory (audit draft §1): start/stop/status, the
 * channel page + now-playing (PRD §1.5), RSS time-shift, and the Icecast
 * exits (PRD lines 151/210/223). No route in this list may ever be
 * registered by this codebase — broadcast ships offline-only (V4).
 */
const BROADCAST_ROUTES: readonly {
  method: "GET" | "POST";
  url: string;
  gated: boolean;
}[] = [
  { method: "POST", url: "/api/v1/broadcast/start", gated: true },
  { method: "POST", url: "/api/v1/broadcast/stop", gated: true },
  { method: "GET", url: "/api/v1/broadcast/status", gated: true },
  { method: "GET", url: "/api/v1/channels", gated: true },
  { method: "GET", url: "/api/v1/channels/muses/now-playing", gated: true },
  { method: "GET", url: "/rss", gated: false },
  { method: "GET", url: "/feed", gated: false },
  { method: "GET", url: "/stream", gated: false },
  { method: "GET", url: "/listen/muses", gated: false },
];

const BROADCAST_PREFIX_PROBES: readonly string[] = [
  "/api/v1/broadcast",
  "/api/v1/channels",
  "/rss",
  "/feed",
  "/stream",
  "/listen",
];

const ALL_METHODS: readonly ("GET" | "POST" | "PUT" | "DELETE")[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
];

const ORIGIN = "http://127.0.0.1:5173";

const V07_TABLES = [
  "journey_replays",
  "journeys",
  "library_tracks",
  "pulse_readings",
] as const;

interface TestApp {
  readonly app: FastifyInstance;
  readonly modules: readonly { readonly name: string }[];
  readonly directory: string;
  readonly cleanup: () => Promise<void>;
}

const FLAG_KEYS = ["MUSES_V07", "MUSES_V07_REPLAY"] as const;

interface BuildAppOptions {
  readonly auth?: AuthConfig | null;
  readonly flags?: Partial<Record<(typeof FLAG_KEYS)[number], string>>;
  /** Register cleanup on the file-level stack (default) or manage manually. */
  readonly autoClean?: boolean;
}

const cleanups: (() => Promise<void>)[] = [];

const buildTestApp = async (
  options: BuildAppOptions = {},
): Promise<TestApp> => {
  const directory = mkdtempSync(join(tmpdir(), "muses-broadcast-test-"));
  const saved: Record<string, string | undefined> = {
    MUSES_DATABASE_PATH: process.env.MUSES_DATABASE_PATH,
  };
  for (const key of FLAG_KEYS) {
    saved[key] = process.env[key];
  }
  process.env.MUSES_DATABASE_PATH = join(directory, "muses.sqlite");
  for (const key of FLAG_KEYS) {
    const value = options.flags?.[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const runtime = await buildRuntimeModules({
    ...(options.auth === undefined ? {} : { auth: options.auth }),
  });
  const app = await createApp({
    config: loadRuntimeConfig({
      MUSES_ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:3001`,
      MUSES_SERVE_STATIC: "false",
      NODE_ENV: "test",
    }),
    logger: false,
    modules: runtime.modules,
  });
  const testApp: TestApp = {
    app,
    modules: runtime.modules,
    directory,
    cleanup: async () => {
      await app.close();
      await runtime.close();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
  if (options.autoClean !== false) {
    cleanups.push(testApp.cleanup);
  }
  return testApp;
};

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) {
      await cleanup();
    }
  }
});

beforeEach(() => {
  // Default-off semantics are the premise of this whole file: a dirty host
  // environment must not leak a flag into the "off" builds.
  delete process.env.MUSES_V07;
  delete process.env.MUSES_V07_REPLAY;
});

const authedHeaders = (token: string): Record<string, string> => ({
  origin: ORIGIN,
  authorization: `Bearer ${token}`,
});

const anonHeaders = (): Record<string, string> => ({ origin: ORIGIN });

// ---------------------------------------------------------------------------
// T6 — switch parsing (fail-closed, never throw)
// ---------------------------------------------------------------------------

describe("T6: feature-switch parsing fails closed", () => {
  it.each([undefined, "0", "false", "", "garbage", "TRUE ", " true", "yes"])(
    "MUSES_V07=%j disables the pulse",
    (raw) => {
      expect(isVibeSignalEnabled({ MUSES_V07: raw })).toBe(false);
    },
  );

  it.each(["1", "true", "TRUE"])("MUSES_V07=%j enables the pulse", (raw) => {
    expect(isVibeSignalEnabled({ MUSES_V07: raw })).toBe(true);
  });

  it("journey/replay needs BOTH switches", () => {
    expect(
      isJourneyReplayEnabled({ MUSES_V07: "1", MUSES_V07_REPLAY: "1" }),
    ).toBe(true);
    expect(isJourneyReplayEnabled({ MUSES_V07: "1" })).toBe(false);
    expect(isJourneyReplayEnabled({ MUSES_V07_REPLAY: "1" })).toBe(false);
    expect(
      isJourneyReplayEnabled({ MUSES_V07: "garbage", MUSES_V07_REPLAY: "1" }),
    ).toBe(false);
  });

  // The split quadrant (Round-1 review B1): whitespace-padded MUSES_V07 used
  // to disable batch 1 while batch 2's trimming parser enabled it — batch 2
  // bypassed batch 1. Both batches now share one fail-closed parser, and
  // these cases pin the unified semantics for EACH batch.
  it.each([" 1", "1 ", " true", "TRUE ", "\t1", " 1 "])(
    "MUSES_V07=%j with MUSES_V07_REPLAY=1 disables BOTH batches (no split quadrant)",
    (raw) => {
      expect(isVibeSignalEnabled({ MUSES_V07: raw })).toBe(false);
      expect(
        isJourneyReplayEnabled({ MUSES_V07: raw, MUSES_V07_REPLAY: "1" }),
      ).toBe(false);
    },
  );

  it.each([" 1", "1 ", " true", "TRUE ", "\t1"])(
    "MUSES_V07=1 with MUSES_V07_REPLAY=%j keeps batch 2 off",
    (raw) => {
      expect(
        isJourneyReplayEnabled({ MUSES_V07: "1", MUSES_V07_REPLAY: raw }),
      ).toBe(false);
    },
  );

  // Layering invariant as a property over a corpus: batch 2 is reachable
  // only through batch 1 — whenever the pulse switch evaluates off, the
  // journey switch must evaluate off too, whatever MUSES_V07_REPLAY says.
  it("batch 2 never bypasses batch 1 (layering property)", () => {
    const corpus: readonly (string | undefined)[] = [
      undefined,
      "1",
      "true",
      "TRUE",
      "0",
      "false",
      "",
      "garbage",
      "yes",
      " 1",
      "1 ",
      " true",
      "TRUE ",
      "\t1",
      " 1 ",
      "on",
    ];
    for (const raw of corpus) {
      const batch1 = isVibeSignalEnabled({ MUSES_V07: raw });
      for (const replay of ["1", "true", " 1", "garbage", undefined]) {
        const batch2 = isJourneyReplayEnabled({
          MUSES_V07: raw,
          MUSES_V07_REPLAY: replay,
        });
        if (batch1 === false) {
          expect(
            batch2,
            `MUSES_V07=${String(raw)} MUSES_V07_REPLAY=${String(replay)}`,
          ).toBe(false);
        }
        if (batch2 === true) {
          expect(batch1, `MUSES_V07=${String(raw)}`).toBe(true);
        }
      }
    }
  });

  // The app-level wiring must not reintroduce the split: a padded
  // MUSES_V07 with a clean MUSES_V07_REPLAY freezes the whole module graph
  // at the v0.6 list (runtime-modules reuses its batch-1 boolean instead of
  // re-parsing the environment).
  it("MUSES_V07=' 1' + MUSES_V07_REPLAY='1' builds the frozen v0.6 module graph", async () => {
    const app = await buildTestApp({
      auth: enabledAuthConfig(),
      flags: { MUSES_V07: " 1", MUSES_V07_REPLAY: "1" },
    });
    expect(app.modules.map((module) => module.name)).toEqual([
      "context",
      "belief",
      "effects",
      "policy",
      "settings",
      "llm",
      "bootstrap",
      "auth",
    ]);
    await app.app.ready();
    expect(
      app.app.hasRoute({ method: "GET", url: "/api/v1/belief/pulse/current" }),
    ).toBe(false);
    expect(
      app.app.hasRoute({ method: "GET", url: "/api/v1/self-track/plan" }),
    ).toBe(false);
    expect(app.app.hasRoute({ method: "GET", url: "/api/v1/journeys" })).toBe(
      false,
    );
  }, 30_000);
});

// ---------------------------------------------------------------------------
// T1 + T2 + T3 — route-table and HTTP-level unreachability
// ---------------------------------------------------------------------------

describe("T1/T2/T3: broadcast routes are not registered (flag off)", () => {
  let authOff: TestApp;
  let authOn: TestApp;
  let session: RegisteredSession;

  beforeAll(async () => {
    authOff = await buildTestApp({ auth: null, autoClean: false });
    authOn = await buildTestApp({
      auth: enabledAuthConfig(),
      autoClean: false,
    });
    session = await registerViaApi(
      authOn.app,
      "broadcast-probe@example.net",
      "plausible-test-password-1",
    );
  }, 90_000);

  afterAll(async () => {
    await authOn.cleanup();
    await authOff.cleanup();
  });

  it("T1: hasRoute is false for every broadcast route x method", async () => {
    await authOff.app.ready();
    for (const route of BROADCAST_ROUTES) {
      for (const method of ALL_METHODS) {
        expect(
          authOff.app.hasRoute({ method, url: route.url }),
          `${method} ${route.url}`,
        ).toBe(false);
      }
    }
  });

  it("T1: the registered route table contains no broadcast-ish naming drift", async () => {
    await authOff.app.ready();
    expect(authOff.app.printRoutes()).not.toMatch(
      /broadcast|channels?|\/rss|\/feed|\/stream|\/listen/i,
    );
  });

  it.each(BROADCAST_ROUTES)(
    "T2: $method $url answers 404 NOT_FOUND when auth is off",
    async ({ method, url }) => {
      const response = await authOff.app.inject({
        method,
        url,
        headers: anonHeaders(),
        ...(method === "GET" ? {} : { payload: {} }),
      });
      expect(response.statusCode).toBe(404);
      const body = response.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("NOT_FOUND");
    },
  );

  it.each(BROADCAST_ROUTES.filter((route) => route.gated))(
    "T2: $method $url gates anonymous callers before the 404 (auth on)",
    async ({ method, url }) => {
      const response = await authOn.app.inject({
        method,
        url,
        headers: anonHeaders(),
        ...(method === "GET" ? {} : { payload: {} }),
      });
      // Production-verified ordering (audit draft §0): the app-level gate
      // runs before routing, so unauthenticated probes cannot even learn
      // whether a /api route exists.
      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "AUTH_REQUIRED",
      );
    },
  );

  it.each(BROADCAST_ROUTES.filter((route) => !route.gated))(
    "T2: $method $url is outside the /api gate: routing 404 for anyone",
    async ({ method, url }) => {
      for (const headers of [
        anonHeaders(),
        authedHeaders("forged.token.value"),
        authedHeaders(session.token),
      ]) {
        const response = await authOn.app.inject({
          method,
          url,
          headers,
          ...(method === "GET" ? {} : { payload: {} }),
        });
        expect(response.statusCode, `${url} ${JSON.stringify(headers)}`).toBe(
          404,
        );
        expect(response.json<{ error: { code: string } }>().error.code).toBe(
          "NOT_FOUND",
        );
      }
    },
  );

  it.each(BROADCAST_ROUTES.filter((route) => route.gated))(
    "T2: $method $url rejects forged tokens with AUTH_INVALID (auth on)",
    async ({ method, url }) => {
      const response = await authOn.app.inject({
        method,
        url,
        headers: authedHeaders("forged.token.value"),
        ...(method === "GET" ? {} : { payload: {} }),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "AUTH_INVALID",
      );
    },
  );

  it.each(BROADCAST_ROUTES.filter((route) => route.gated))(
    "T2: $method $url answers the routing-404 envelope for valid tokens",
    async ({ method, url }) => {
      const response = await authOn.app.inject({
        method,
        url,
        headers: authedHeaders(session.token),
        ...(method === "GET" ? {} : { payload: {} }),
      });
      expect(response.statusCode).toBe(404);
      const body = response.json<{
        error: { code: string; message: string; requestId: string };
      }>();
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe("Route not found");
      expect(body.error.requestId).toBeTruthy();
    },
  );

  it.each([
    "/%61pi/v1/broadcast/status",
    "/%61%70%69/v1/channels",
    "/a%70i/v1/broadcast/start",
    "/%61pi/v1/listen/muses",
  ])(
    "T3: encoded path %s cannot conjure a broadcast route (404 NOT_FOUND)",
    async (url) => {
      const response = await authOn.app.inject({
        method: "GET",
        url,
        headers: authedHeaders(session.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "NOT_FOUND",
      );
    },
  );

  it.each(["/%zz-broadcast/x", "/stream%zz", "/%zz"])(
    "T3: malformed encoding %s fails closed (400 or 401, never routed)",
    async (url) => {
      const response = await authOn.app.inject({
        method: "GET",
        url,
        headers: authedHeaders(session.token),
      });
      expect([400, 401]).toContain(response.statusCode);
    },
  );
});

// ---------------------------------------------------------------------------
// T4 — module graph, process and DB-layer unreachability
// ---------------------------------------------------------------------------

describe("T4: flag-off means nothing v0.7 is constructed, spawned or written", () => {
  const V06_MODULES_AUTH_OFF = [
    "context",
    "belief",
    "effects",
    "policy",
    "settings",
    "llm",
    "bootstrap",
  ] as const;
  const V06_MODULES_AUTH_ON = [...V06_MODULES_AUTH_OFF, "auth"] as const;

  it("the module graph is exactly the frozen v0.6 list (auth off)", async () => {
    const app = await buildTestApp({ auth: null });
    expect(app.modules.map((module) => module.name)).toEqual([
      ...V06_MODULES_AUTH_OFF,
    ]);
  });

  it("the module graph is exactly the frozen v0.6 list + auth (auth on)", async () => {
    const app = await buildTestApp({ auth: enabledAuthConfig() });
    expect(app.modules.map((module) => module.name)).toEqual([
      ...V06_MODULES_AUTH_ON,
    ]);
  });

  it("no child process is spawned across the whole app lifecycle", async () => {
    const app = await buildTestApp({ auth: enabledAuthConfig() });
    await app.app.ready();
    for (const url of BROADCAST_PREFIX_PROBES) {
      await app.app.inject({ method: "GET", url, headers: anonHeaders() });
    }
    await app.app.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: anonHeaders(),
    });
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
  }, 30_000);

  it("the schema delta is exactly the four declared v0.7 tables, all empty", async () => {
    const app = await buildTestApp({ auth: null, autoClean: false });
    await app.app.ready();
    // A short request scan, then inspect the database read-only.
    for (const url of ["/api/health", "/api/v1/bootstrap", "/api/settings"]) {
      await app.app.inject({ method: "GET", url, headers: anonHeaders() });
    }
    const baseline = v06BaselineTableNames();
    // The v0.6 repository constructors (context/effect stores) also CREATE
    // TABLE IF NOT EXISTS their shards beside the migration chain - same
    // behavior on main@573d711, so they belong to the v0.6 baseline.
    const v06ConstructorTables = [
      "context_event_store",
      "effect_outcomes",
      "effect_requests",
      "policy_decisions",
    ] as const;
    const actual = tableNamesOf(join(app.directory, "muses.sqlite"));
    expect([...actual].sort()).toEqual(
      [...baseline, ...v06ConstructorTables, ...V07_TABLES].sort(),
    );
    const database = new Database(join(app.directory, "muses.sqlite"), {
      readonly: true,
    });
    try {
      for (const table of V07_TABLES) {
        const count = (
          database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n;
        expect(count, `${table} must stay empty while the flag is off`).toBe(0);
      }
    } finally {
      database.close();
    }
    await app.cleanup();
  }, 30_000);
});

const tableNamesOf = (path: string): readonly string[] => {
  const opened = openDatabase(path);
  try {
    return (
      opened.connection
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as readonly { name: string }[]
    ).map((row) => row.name);
  } finally {
    opened.connection.close();
  }
};

const v06BaselineTableNames = (): readonly string[] => {
  const directory = mkdtempSync(join(tmpdir(), "muses-v06-baseline-"));
  const opened = openDatabase(join(directory, "baseline.sqlite"));
  try {
    const v06Migrations: readonly MigrationDefinition[] = [
      migration001Initial,
      migration002IntegrityTriggers,
      migration003Auth,
      migration004UserAttribution,
    ];
    for (const migration of v06Migrations) {
      migration.prepare?.(opened.connection);
      opened.connection.exec(migration.sql);
    }
    opened.connection.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY
       ) STRICT;`,
    );
    return (
      opened.connection
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as readonly { name: string }[]
    ).map((row) => row.name);
  } finally {
    opened.connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// T5 — flag-off (unset and dirty values) answers byte-identical v0.6
// ---------------------------------------------------------------------------

/**
 * v0.6 client surface corpus — the CLIENT_ROUTES table from
 * src/server/foundation/api-surface.contract.test.ts (that file owns the
 * list; duplicated here because importing a test module would re-register
 * its suites).
 */
const CLIENT_ROUTES: readonly {
  method: "GET" | "POST" | "PUT";
  url: string;
}[] = [
  { method: "GET", url: "/api/health" },
  { method: "GET", url: "/api/v1/bootstrap" },
  { method: "GET", url: "/api/v1/context/events" },
  { method: "POST", url: "/api/v1/context/events" },
  { method: "GET", url: "/api/v1/belief/current" },
  { method: "POST", url: "/api/v1/belief/replay" },
  { method: "GET", url: "/api/v1/decisions/current" },
  { method: "GET", url: "/api/v1/effects/current" },
  { method: "POST", url: "/api/v1/effects/outcomes" },
  { method: "POST", url: "/api/v1/llm/narration" },
  { method: "POST", url: "/api/v1/llm/summary" },
  { method: "GET", url: "/api/settings" },
  { method: "GET", url: "/api/settings/draft" },
  { method: "PUT", url: "/api/settings/draft" },
  { method: "POST", url: "/api/settings/preview" },
  { method: "POST", url: "/api/settings/publish" },
  { method: "GET", url: "/api/settings/releases" },
  { method: "GET", url: "/api/settings/history" },
  { method: "POST", url: "/api/settings/releases/does-not-exist/rollback" },
];

/**
 * Normalization rules (fixed; the UUID rule is a documented addition to the
 * audit draft's two): request ids, incidental UUIDs, ISO timestamps and
 * the /api/health process uptime and the belief inputDigest (a per-boot
 * value even on two empty v0.6 databases) differ per request/app by
 * construction; everything else must match byte — JSON deep-equality is explicitly NOT enough.
 */
const normalizeBody = (body: string): string =>
  body
    .replace(/"uptimeSeconds":\d+/g, '"uptimeSeconds":N')
    .replace(/req_[0-9a-f-]{36}/g, "req_X")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "UUID",
    )
    .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, "TS")
    .replace(/"inputDigest":"[0-9a-f]{64}"/g, '"inputDigest":"DIGEST"');

const comparableHeaders = (
  headers: Record<string, unknown>,
): Record<string, string> => {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === "date" ||
      lower.includes("request-id") ||
      // content-length mirrors the RAW body length, which still contains
      // the variable-length tokens the normalization rules replace.
      lower === "content-length" ||
      lower === "set-cookie" ||
      value === undefined
    ) {
      continue;
    }
    copy[key] = Array.isArray(value)
      ? value.join(",")
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  }
  return copy;
};

interface CorpusRequest {
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  readonly token?: string;
}

const corpusFor = (token: string | undefined): readonly CorpusRequest[] => [
  ...CLIENT_ROUTES.map((route) => ({
    ...route,
    ...(token === undefined ? {} : { token }),
  })),
  ...BROADCAST_PREFIX_PROBES.map((url) => ({
    method: "GET" as const,
    url,
    ...(token === undefined ? {} : { token }),
  })),
  {
    method: "GET" as const,
    url: "/",
    ...(token === undefined ? {} : { token }),
  },
];

interface CorpusResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const runCorpus = async (
  app: FastifyInstance,
  token: string | undefined,
): Promise<readonly CorpusResult[]> => {
  const results: CorpusResult[] = [];
  for (const request of corpusFor(token)) {
    const response = await app.inject({
      method: request.method,
      url: request.url,
      headers:
        request.token === undefined
          ? anonHeaders()
          : authedHeaders(request.token),
      ...(request.method === "GET" ? {} : { payload: {} }),
    });
    results.push({
      status: response.statusCode,
      headers: comparableHeaders(response.headers),
      body: normalizeBody(response.body),
    });
  }
  return results;
};

describe("T5: MUSES_V07 off (unset or dirty) is byte-identical v0.6", () => {
  it.each(["unset", "0", "false", "", "garbage"])(
    "MUSES_V07=%j produces the same responses as the unset baseline",
    async (flagValue) => {
      const baselineApp = await buildTestApp({ auth: enabledAuthConfig() });
      const baselineSession = await registerViaApi(
        baselineApp.app,
        "t5-probe@example.net",
        "plausible-test-password-1",
      );
      const baselineAnon = await runCorpus(baselineApp.app, undefined);
      const baselineAuthed = await runCorpus(
        baselineApp.app,
        baselineSession.token,
      );

      const dirtyApp = await buildTestApp({
        auth: enabledAuthConfig(),
        ...(flagValue === "unset" ? {} : { flags: { MUSES_V07: flagValue } }),
      });
      const dirtySession = await registerViaApi(
        dirtyApp.app,
        "t5-probe@example.net",
        "plausible-test-password-1",
      );
      const dirtyAnon = await runCorpus(dirtyApp.app, undefined);
      const dirtyAuthed = await runCorpus(dirtyApp.app, dirtySession.token);

      expect(dirtyAnon.length).toBe(baselineAnon.length);
      expect(dirtyAuthed.length).toBe(baselineAuthed.length);
      for (const [index, baseline] of baselineAnon.entries()) {
        expect(dirtyAnon[index]).toEqual(baseline);
      }
      for (const [index, baseline] of baselineAuthed.entries()) {
        expect(dirtyAuthed[index]).toEqual(baseline);
      }
    },
    90_000,
  );
});

// ---------------------------------------------------------------------------
// T7 — flag-on control arm (anti-vacuous)
// ---------------------------------------------------------------------------

describe("T7: flag-on registers the v0.7 surfaces (control arm)", () => {
  it("MUSES_V07=1 registers pulse + self-track plan but no broadcast exit", async () => {
    const app = await buildTestApp({
      auth: enabledAuthConfig(),
      flags: { MUSES_V07: "1" },
    });
    await app.app.ready();
    expect(
      app.app.hasRoute({ method: "GET", url: "/api/v1/belief/pulse/current" }),
    ).toBe(true);
    expect(
      app.app.hasRoute({ method: "GET", url: "/api/v1/self-track/plan" }),
    ).toBe(true);
    // Batch 2 stays off without the second switch…
    expect(app.app.hasRoute({ method: "GET", url: "/api/v1/journeys" })).toBe(
      false,
    );
    // …and the public broadcast exits stay unregistered even flag-on (V4).
    for (const route of BROADCAST_ROUTES) {
      for (const method of ALL_METHODS) {
        expect(
          app.app.hasRoute({ method, url: route.url }),
          `${method} ${route.url}`,
        ).toBe(false);
      }
    }
  }, 30_000);

  it("MUSES_V07=1 + MUSES_V07_REPLAY=1 additionally registers journeys", async () => {
    const app = await buildTestApp({
      auth: enabledAuthConfig(),
      flags: { MUSES_V07: "1", MUSES_V07_REPLAY: "1" },
    });
    await app.app.ready();
    expect(app.app.hasRoute({ method: "GET", url: "/api/v1/journeys" })).toBe(
      true,
    );
    for (const route of BROADCAST_ROUTES) {
      expect(
        app.app.hasRoute({ method: route.method, url: route.url }),
        `${route.method} ${route.url}`,
      ).toBe(false);
    }
  }, 30_000);
});
