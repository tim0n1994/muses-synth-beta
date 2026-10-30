import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, runMigrations } from "../../db/index.js";
import { buildRuntimeModules } from "../../foundation/runtime-modules.js";
import { createApp } from "../../foundation/create-app.js";
import { loadRuntimeConfig } from "../../foundation/config.js";
import { SettingsRepository } from "../../settings/repository.js";
import type { SettingsDocument } from "../../settings/schema.js";
import { ContextEventService } from "../service.js";
import { hashCloudEvent } from "../hash.js";
import type { ContextEventStore } from "../model.js";
import {
  SqliteContextEventStore,
  type SqliteDatabasePort,
} from "../sqlite-context-event-store.js";
import { createRetentionMaintenance } from "../privacy.js";
import { enabledAuthConfig, registerViaApi } from "../../auth/test-support.js";

const BASE = Date.parse("2026-10-30T00:00:00.000Z");
interface EventResponse {
  event: { expiresAt: string };
}
interface EventPage {
  items: Array<{ id: string }>;
}
const event = (id: string, ttlSeconds?: number) => ({
  specversion: "1.0" as const,
  id,
  source: "urn:test:privacy",
  type: "muses.editor.activity",
  data: { action: "edit", private: id },
  extensions: {},
  ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
});
async function appendLegacy(store: ContextEventStore, id: string, at = BASE) {
  const input = event(id, 1);
  return store.appendEvent({
    ...input,
    contentHash: hashCloudEvent(input),
    occurredAt: new Date(at).toISOString(),
    receivedAt: new Date(at).toISOString(),
    expiresAt: new Date(at + 1000).toISOString(),
    outOfOrder: false,
  });
}
const cleanups: Array<() => void | Promise<void>> = [];
const wireEvent = (id: string) => {
  const { specversion, source, type, data } = event(id);
  return { specversion, source, type, data, id };
};
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function memory() {
  const db = openDatabase(":memory:");
  cleanups.push(() => db.close());
  const store = new SqliteContextEventStore(
    db.connection as unknown as SqliteDatabasePort,
  );
  let now = BASE;
  let hours = 24;
  let failPolicy = false;
  const service = new ContextEventService(store, {
    clock: { now: () => new Date(now) },
    getRetentionHours: () => {
      if (failPolicy) throw new Error("settings unavailable");
      return hours;
    },
  });
  const count = () =>
    (
      db.connection
        .prepare("SELECT COUNT(*) AS n FROM context_event_store")
        .get() as { n: number }
    ).n;
  return {
    db,
    store,
    service,
    count,
    setHours: (n: number) => {
      hours = n;
    },
    advance: (ms: number) => {
      now += ms;
    },
    fail: () => {
      failPolicy = true;
    },
  };
}

describe("published raw-event retention", () => {
  it("adding retention metadata to a pre-fix schema preserves every legacy deadline and payload", async () => {
    const db = openDatabase(":memory:");
    cleanups.push(() => db.close());
    db.connection.exec(`CREATE TABLE context_event_store (
      server_sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
      source TEXT NOT NULL, type TEXT NOT NULL, subject TEXT,
      occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      out_of_order INTEGER NOT NULL, content_hash TEXT NOT NULL, candidate_json TEXT NOT NULL,
      user_id TEXT, UNIQUE (source, id)) STRICT;`);
    const payload = JSON.stringify({ secret: "fixture-only" });
    db.connection
      .prepare(
        `INSERT INTO context_event_store
      (id, source, type, occurred_at, received_at, expires_at, out_of_order, content_hash, candidate_json, user_id)
      VALUES ('legacy', 's', 't', ?, ?, ?, 0, 'unchanged-hash', ?, 'alice')`,
      )
      .run(
        new Date(BASE - 2000).toISOString(),
        new Date(BASE - 2000).toISOString(),
        new Date(BASE - 1000).toISOString(),
        payload,
      );
    const before = db.connection
      .prepare("SELECT * FROM context_event_store")
      .get();
    const store = new SqliteContextEventStore(
      db.connection as unknown as SqliteDatabasePort,
    );
    expect(
      db.connection.prepare("SELECT * FROM context_event_store").get(),
    ).toEqual({ ...(before as object), retention_managed: 0 });
    expect(await store.pruneExpired(new Date(BASE).toISOString(), 500)).toBe(0);
    expect(
      db.connection
        .prepare("SELECT candidate_json FROM context_event_store")
        .get(),
    ).toEqual({ candidate_json: payload });
  });

  it("a duplicate never extends its saved deadline or promotes legacy history to cleanup eligibility", async () => {
    const h = memory();
    const first = await appendLegacy(h.store, "legacy");
    h.setHours(2160);
    h.advance(1000);
    const duplicate = await h.service.ingest(event("legacy", 1));
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.event.expiresAt).toBe(first.event.expiresAt);
    expect(await h.service.pruneExpired()).toBe(0);
    expect(h.count()).toBe(1);
  });

  it.each([1, 24, 168, 2160])(
    "persists %i-hour deadlines; emitter TTL can shorten but not extend them",
    async (hours) => {
      const h = memory();
      h.setHours(hours);
      const a = await h.service.ingest(event("default"));
      const b = await h.service.ingest(event("short", 30));
      const c = await h.service.ingest(event("long", 90 * 86400));
      expect(Date.parse(a.event.expiresAt) - BASE).toBe(hours * 3600000);
      expect(Date.parse(b.event.expiresAt) - BASE).toBe(30000);
      expect(c.event.expiresAt).toBe(a.event.expiresAt);
      expect(h.count()).toBe(3);
    },
  );

  it("zero refuses ingestion before any SQL write; never purges existing history on policy change", async () => {
    const h = memory();
    await h.service.ingest(event("before"));
    h.setHours(0);
    await expect(h.service.ingest(event("zero", 60))).rejects.toMatchObject({
      code: "CONTEXT_RETENTION_DISABLED",
      statusCode: 503,
    });
    expect(h.count()).toBe(1);
    h.setHours(1);
    expect((await h.service.ingest(event("after"))).event.expiresAt).toBe(
      new Date(BASE + 3600000).toISOString(),
    );
    expect((await h.service.list()).items[0]?.expiresAt).toBe(
      new Date(BASE + 86400000).toISOString(),
    );
  });

  it("expiry hides rows at the exact deadline without deleting; managed cleanup is bounded and protects legacy", async () => {
    const h = memory();
    await appendLegacy(h.store, "legacy");
    for (const id of ["a", "b", "c"]) await h.service.ingest(event(id, 1));
    h.advance(1000);
    expect((await h.service.list()).items).toHaveLength(0);
    expect((await h.service.list({ includeExpired: true })).items).toHaveLength(
      4,
    );
    expect(h.count()).toBe(4);
    expect(await h.service.pruneExpired(2)).toBe(2);
    expect(h.count()).toBe(2);
    expect(await h.service.pruneExpired(2)).toBe(1);
    expect(
      (await h.service.list({ includeExpired: true })).items.map(
        (row) => row.id,
      ),
    ).toEqual(["legacy"]);
  });

  it.each([-1, 0.5, 2161, Number.NaN, Number.POSITIVE_INFINITY])(
    "invalid policy %s fails closed",
    async (hours) => {
      const h = memory();
      h.setHours(hours);
      await expect(h.service.ingest(event("invalid"))).rejects.toMatchObject({
        statusCode: 503,
      });
      await expect(h.service.pruneExpired()).rejects.toMatchObject({
        statusCode: 503,
      });
      expect(h.count()).toBe(0);
    },
  );

  it("policy and SQLite failures cannot silently accept or delete data; retry recovers", async () => {
    const h = memory();
    await h.service.ingest(event("kept", 1));
    h.advance(1000);
    h.fail();
    await expect(h.service.ingest(event("blocked"))).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(h.service.pruneExpired()).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(h.count()).toBe(1);
    const valid = new ContextEventService(h.store, {
      getRetentionHours: () => 24,
      clock: { now: () => new Date(BASE + 1000) },
    });
    h.db.connection.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON context_event_store BEGIN SELECT RAISE(ABORT, 'test cleanup failure'); END;",
    );
    await expect(valid.pruneExpired()).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(h.count()).toBe(1);
    h.db.connection.exec("DROP TRIGGER fail_delete;");
    expect(await valid.pruneExpired()).toBe(1);
    h.db.connection.exec(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON context_event_store BEGIN SELECT RAISE(ABORT, 'test append failure'); END;",
    );
    await expect(valid.ingest(event("failed-write"))).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(h.count()).toBe(0);
  });

  it("isolates listing/counting and never returns another user's duplicate payload", async () => {
    const h = memory();
    await h.service.ingest(event("alice"), { userId: "a" });
    await h.service.ingest(event("bob"), { userId: "b" });
    await h.service.ingest(event("global"));
    await expect(
      h.service.ingest(event("alice"), { userId: "b" }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect((await h.service.list({}, "b")).items.map((row) => row.id)).toEqual([
      "bob",
    ]);
    expect((await h.service.list({}, null)).items.map((row) => row.id)).toEqual(
      ["global"],
    );
    expect(
      (
        await h.service.counts(
          new Date(BASE - 1).toISOString(),
          new Date(BASE + 1).toISOString(),
          "a",
        )
      ).total,
    ).toBe(1);
    expect(h.count()).toBe(3);
  });
});

describe("retention maintenance lifecycle", () => {
  it("runs one 500-row batch at startup and each minute, reports failures, retries, stops and drains", async () => {
    vi.useFakeTimers();
    const pruneExpired = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(500);
    const report = vi.fn();
    const maintenance = createRetentionMaintenance({ pruneExpired }, report);
    await maintenance.start();
    expect(report).toHaveBeenCalledTimes(1);
    expect(pruneExpired).toHaveBeenCalledTimes(1);
    expect(pruneExpired).toHaveBeenCalledWith(500);
    await vi.advanceTimersByTimeAsync(60000);
    expect(pruneExpired).toHaveBeenCalledTimes(2);
    let resolve!: (n: number) => void;
    pruneExpired.mockImplementation(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(180000);
    expect(pruneExpired).toHaveBeenCalledTimes(3);
    let stopped = false;
    const stopping = maintenance.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolve(1);
    await stopping;
    await vi.advanceTimersByTimeAsync(60000);
    expect(pruneExpired).toHaveBeenCalledTimes(3);
  });
});

async function runtimeFixture(authEnabled = false) {
  const directory = mkdtempSync(join(tmpdir(), "muses-privacy-runtime-"));
  const filename = join(directory, "isolated.sqlite");
  vi.stubEnv("MUSES_DATABASE_PATH", filename);
  vi.stubEnv("MUSES_V07", "false");
  vi.stubEnv("MUSES_V07_REPLAY", "false");
  const db = openDatabase(filename);
  runMigrations(db.connection, { purpose: "test" });
  const repository = SettingsRepository.initialize(db.connection);
  const store = new SqliteContextEventStore(
    db.connection as unknown as SqliteDatabasePort,
  );
  await appendLegacy(store, "legacy", BASE - 10000);
  const start = async () => {
    const runtime = await buildRuntimeModules({
      auth: authEnabled
        ? enabledAuthConfig({ MUSES_ADMIN_EMAILS: "admin@example.test" })
        : null,
    });
    const app = await createApp({
      config: loadRuntimeConfig({ NODE_ENV: "test" }),
      logger: false,
      modules: runtime.modules,
    });
    await app.ready();
    return {
      app,
      close: async () => {
        await app.close();
        await runtime.close();
      },
    };
  };
  let active = await start();
  cleanups.push(async () => {
    await active.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    db,
    repository,
    app: active.app,
    restart: async () => {
      await active.close();
      active = await start();
      return active.app;
    },
  };
}

const headers = { origin: "http://127.0.0.1:3001" };
function publish(repository: SettingsRepository, document: SettingsDocument) {
  const draft = repository.updateDraft({
    document,
    expectedRevision: repository.getDraft().revision,
    actor: "test",
    reason: "privacy test",
  });
  return repository.publishDraft({
    expectedDraftRevision: draft.revision,
    expectedDraftChecksum: draft.checksum,
    actor: "test",
    reason: "privacy test",
  }).release;
}

describe("runtime privacy/settings integration with dedicated SQLite", () => {
  it("auth isolates event streams and reserves global retention save/publish/rollback to admins", async () => {
    const h = await runtimeFixture(true);
    const admin = await registerViaApi(
      h.app,
      "admin@example.test",
      "Privacy-test-123!",
    );
    const alice = await registerViaApi(
      h.app,
      "alice@example.test",
      "Privacy-test-123!",
    );
    const bob = await registerViaApi(
      h.app,
      "bob@example.test",
      "Privacy-test-123!",
    );
    const authHeaders = (token: string) => ({
      ...headers,
      authorization: `Bearer ${token}`,
    });
    for (const [session, id] of [
      [alice, "alice"],
      [bob, "bob"],
    ] as const) {
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: "/api/v1/context/events",
            headers: authHeaders(session.token),
            payload: wireEvent(id),
          })
        ).statusCode,
      ).toBe(202);
    }
    const bobEvents = await h.app.inject({
      url: "/api/v1/context/events",
      headers: authHeaders(bob.token),
    });
    expect(bobEvents.json<EventPage>().items.map((row) => row.id)).toEqual([
      "bob",
    ]);
    const collision = await h.app.inject({
      method: "POST",
      url: "/api/v1/context/events",
      headers: authHeaders(bob.token),
      payload: wireEvent("alice"),
    });
    expect(collision.statusCode).toBe(503);
    expect(collision.body).not.toContain('"private":"alice"');
    expect((await h.app.inject("/api/v1/context/privacy")).statusCode).toBe(
      401,
    );
    const original = h.repository.getCurrentRelease();
    const document = structuredClone(original.document);
    document.privacy.rawEventRetentionHours = 1;
    const body = {
      document,
      expectedRevision: h.repository.getDraft().revision,
      actor: "admin",
      reason: "privacy",
    };
    const rejected = await h.app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      headers: authHeaders(alice.token),
      payload: body,
    });
    expect(rejected.statusCode).toBe(403);
    expect(h.repository.getDraft().revision).toBe(body.expectedRevision);
    const saved = await h.app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      headers: authHeaders(admin.token),
      payload: body,
    });
    expect(saved.statusCode).toBe(200);
    const draft = h.repository.getDraft();
    const publishBody = {
      expectedDraftRevision: draft.revision,
      expectedDraftChecksum: draft.checksum,
      actor: "admin",
      reason: "privacy",
    };
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/api/settings/publish",
          headers: authHeaders(bob.token),
          payload: publishBody,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/api/settings/publish",
          headers: authHeaders(admin.token),
          payload: publishBody,
        })
      ).statusCode,
    ).toBe(201);
    const rollbackBody = {
      expectedCurrentReleaseId: h.repository.getCurrentRelease().id,
      expectedDraftRevision: h.repository.getDraft().revision,
      actor: "admin",
      reason: "privacy",
    };
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: `/api/settings/releases/${original.id}/rollback`,
          headers: authHeaders(alice.token),
          payload: rollbackBody,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: `/api/settings/releases/${original.id}/rollback`,
          headers: authHeaders(admin.token),
          payload: rollbackBody,
        })
      ).statusCode,
    ).toBe(201);
  });
  it("uses published settings only; persists deadlines across restart; recovers expired managed rows but preserves legacy", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(BASE);
    const h = await runtimeFixture();
    const original = h.repository.getCurrentRelease();
    const next = structuredClone(original.document);
    next.privacy.rawEventRetentionHours = 1;
    const draft = h.repository.updateDraft({
      document: next,
      expectedRevision: h.repository.getDraft().revision,
      actor: "test",
      reason: "draft only",
    });
    const ingest = (id: string) =>
      h.app.inject({
        method: "POST",
        url: "/api/v1/context/events",
        headers,
        payload: wireEvent(id),
      });
    const a = await ingest("default");
    expect(a.statusCode).toBe(202);
    expect(a.json<EventResponse>().event.expiresAt).toBe(
      new Date(BASE + 86400000).toISOString(),
    );
    const release = await h.app.inject({
      method: "POST",
      url: "/api/settings/publish",
      headers,
      payload: {
        expectedDraftRevision: draft.revision,
        expectedDraftChecksum: draft.checksum,
        actor: "test",
        reason: "publish",
      },
    });
    expect(release.statusCode).toBe(201);
    const b = await ingest("published");
    expect(b.statusCode).toBe(202);
    expect(b.json<EventResponse>().event.expiresAt).toBe(
      new Date(BASE + 3600000).toISOString(),
    );
    const before = h.db.connection
      .prepare(
        "SELECT id, expires_at, retention_managed FROM context_event_store ORDER BY id",
      )
      .all();
    let app = await h.restart();
    expect(
      h.db.connection
        .prepare(
          "SELECT id, expires_at, retention_managed FROM context_event_store ORDER BY id",
        )
        .all(),
    ).toEqual(before);
    vi.setSystemTime(BASE + 3600000);
    expect(
      (await app.inject("/api/v1/context/events"))
        .json<EventPage>()
        .items.map((row: { id: string }) => row.id),
    ).toEqual(["default"]);
    expect(
      (
        h.db.connection
          .prepare("SELECT COUNT(*) AS n FROM context_event_store")
          .get() as { n: number }
      ).n,
    ).toBe(3);
    app = await h.restart();
    expect(
      h.db.connection
        .prepare("SELECT id FROM context_event_store ORDER BY id")
        .all(),
    ).toEqual([{ id: "default" }, { id: "legacy" }]);
    const rollback = await app.inject({
      method: "POST",
      url: `/api/settings/releases/${original.id}/rollback`,
      headers,
      payload: {
        expectedCurrentReleaseId: h.repository.getCurrentRelease().id,
        expectedDraftRevision: h.repository.getDraft().revision,
        actor: "test",
        reason: "rollback",
      },
    });
    expect(rollback.statusCode).toBe(201);
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/context/events",
      headers,
      payload: wireEvent("rollback"),
    });
    expect(c.json<EventResponse>().event.expiresAt).toBe(
      new Date(BASE + 3600000 + 86400000).toISOString(),
    );
  });

  it("zero is schema-valid, survives restart, returns 503 without inserting and reports limitations", async () => {
    const h = await runtimeFixture();
    const next = structuredClone(h.repository.getCurrentRelease().document);
    next.privacy.rawEventRetentionHours = 0;
    publish(h.repository, next);
    const app = await h.restart();
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/context/events",
      headers,
      payload: wireEvent("zero"),
    });
    expect(result.statusCode).toBe(503);
    expect(result.json<{ error: { code: string } }>().error.code).toBe(
      "CONTEXT_RETENTION_DISABLED",
    );
    expect(
      h.db.connection.prepare("SELECT id FROM context_event_store").all(),
    ).toEqual([{ id: "legacy" }]);
    const status = await app.inject("/api/v1/context/privacy");
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      rawEventRetentionHours: 0,
      unsupportedControlUpdates: "rejected",
      cleanup: { legacyHistory: "preserved", batchLimit: 500 },
      expiredRawRead: {
        includeExpired: "may-return-expired-rows-before-cleanup",
        historicalAsOf: "may-return-now-expired-rows-before-cleanup",
        defaultCurrentQuery: "hides-expired-rows",
        retentionIsAccessControl: false,
      },
    });
  });

  it("retains structured 404 and stale-update 409 without changing settings or event rows", async () => {
    const h = await runtimeFixture();
    const draft = h.repository.getDraft();
    const missing = await h.app.inject({
      method: "POST",
      url: "/api/settings/releases/missing/rollback",
      headers,
      payload: {
        expectedCurrentReleaseId: h.repository.getCurrentRelease().id,
        expectedDraftRevision: draft.revision,
        actor: "test",
        reason: "missing",
      },
    });
    expect(missing.statusCode).toBe(404);
    const document = structuredClone(draft.document);
    document.privacy.rawEventRetentionHours = 2;
    const stale = await h.app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      headers,
      payload: {
        document,
        expectedRevision: draft.revision + 1,
        actor: "test",
        reason: "stale",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(h.repository.getDraft()).toEqual(draft);
    expect(
      h.db.connection.prepare("SELECT id FROM context_event_store").all(),
    ).toEqual([{ id: "legacy" }]);
  });

  it.each([
    "signals",
    "excludedApplications",
    "captureScreenContent",
    "sessionHistoryRetentionDays",
  ])(
    "rejects unsupported %s changes before saving, publishing or rollback",
    async (field) => {
      const h = await runtimeFixture();
      const current = h.repository.getCurrentRelease();
      const next = structuredClone(current.document);
      if (field === "signals") next.signals[0]!.retainRaw = true;
      if (field === "excludedApplications")
        next.privacy.excludedApplications = ["private-app"];
      if (field === "captureScreenContent")
        next.privacy.captureScreenContent = true;
      if (field === "sessionHistoryRetentionDays")
        next.privacy.sessionHistoryRetentionDays = 7;
      const before = h.repository.getDraft();
      const update = await h.app.inject({
        method: "PUT",
        url: "/api/settings/draft",
        headers,
        payload: {
          document: next,
          expectedRevision: before.revision,
          actor: "test",
          reason: "unsupported",
        },
      });
      expect(update.statusCode).toBe(409);
      expect(h.repository.getDraft()).toEqual(before);
      const draft = h.repository.updateDraft({
        document: next,
        expectedRevision: before.revision,
        actor: "test",
        reason: "simulate preexisting draft",
      });
      const rejected = await h.app.inject({
        method: "POST",
        url: "/api/settings/publish",
        headers,
        payload: {
          expectedDraftRevision: draft.revision,
          expectedDraftChecksum: draft.checksum,
          actor: "test",
          reason: "unsupported",
        },
      });
      expect(rejected.statusCode).toBe(409);
      expect(h.repository.getCurrentRelease().id).toBe(current.id);
      const historical = publish(h.repository, next);
      publish(h.repository, current.document);
      const rollback = await h.app.inject({
        method: "POST",
        url: `/api/settings/releases/${historical.id}/rollback`,
        headers,
        payload: {
          expectedCurrentReleaseId: h.repository.getCurrentRelease().id,
          expectedDraftRevision: h.repository.getDraft().revision,
          actor: "test",
          reason: "unsupported rollback",
        },
      });
      expect(rollback.statusCode).toBe(409);
      expect(
        h.db.connection.prepare("SELECT id FROM context_event_store").all(),
      ).toEqual([{ id: "legacy" }]);
    },
  );
});
