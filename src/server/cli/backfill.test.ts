import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ContextEventCandidate, JsonValue } from "../context/model.js";
import { SqliteContextEventStore } from "../context/sqlite-context-event-store.js";
import type { EffectRequest } from "../effects/contracts.js";
import { SqliteEffectRepository } from "../effects/sqlite-effect-repository.js";
import { openDatabase, runMigrations } from "../db/index.js";
import type { Decision } from "../policy/contracts.js";
import { SqliteDecisionRepository } from "../policy/sqlite-decision-repository.js";
import { ArgumentError } from "./args.js";
import {
  executeBackfill,
  parseBackfillArgs,
  runBackfillCommand,
} from "./backfill.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const OWNER_EMAIL = "owner@muses.local";
const OWNER_ID = "owner-1";
const NOW_ISO = "2026-10-20T12:00:00.000Z";

const editingEvent = (id: string): ContextEventCandidate => ({
  specversion: "1.0",
  id,
  source: "urn:muses:test",
  type: "muses.editor.activity",
  subject: "workspace:legacy",
  time: NOW_ISO,
  datacontenttype: "application/json",
  data: { action: "edit" } satisfies JsonValue,
  extensions: {},
  contentHash: `hash-${id}`,
  occurredAt: NOW_ISO,
  receivedAt: NOW_ISO,
  expiresAt: "2026-11-20T12:00:00.000Z",
  outOfOrder: false,
});

const legacyDecision: Decision = {
  decisionId: "decision_legacy_1",
  beliefId: "belief_legacy_seq1",
  beliefObservedAt: NOW_ISO,
  createdAt: NOW_ISO,
  confidence: 0.5,
  explanation: { summary: "legacy row", factors: [] },
  kind: "NO_ACTION",
  reason: "AUTOMATION_DISABLED",
  effect: null,
};

const legacyEffectRequest: EffectRequest = {
  effectId: "effect_legacy_1",
  decisionId: "decision_legacy_1",
  actionId: "audio.adjust",
  adjustment: {
    actionId: "audio.adjust",
    profile: "flow",
    targetGain: 0.3,
    rampMs: 1_000,
  },
  issuedAt: NOW_ISO,
  status: "issued",
};

/**
 * A database in the exact shape an auth-enabled v0.5 deployment leaves
 * behind: migrations ledgered, all attributed tables present, legacy rows in
 * the NULL stream, and a registered owner account. The connection is closed
 * before returning — every assertion re-opens the file so it observes what
 * a later process (the server, or the next backfill run) would see.
 */
const makeLegacyDatabase = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "muses-backfill-test-"));
  directories.push(directory);
  const databasePath = join(directory, "muses.sqlite");

  const opened = openDatabase(databasePath);
  const database = opened.connection;
  runMigrations(database, { purpose: "test" });

  database
    .prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(OWNER_ID, OWNER_EMAIL, "x", NOW_ISO);

  const contextStore = new SqliteContextEventStore(
    database as unknown as ConstructorParameters<
      typeof SqliteContextEventStore
    >[0],
  );
  void contextStore.appendEvent(editingEvent("legacy-1"));
  void contextStore.appendEvent(editingEvent("legacy-2"));

  const decisions = new SqliteDecisionRepository(
    database as unknown as ConstructorParameters<
      typeof SqliteDecisionRepository
    >[0],
  );
  decisions.save(legacyDecision);

  const effects = new SqliteEffectRepository(
    database as unknown as ConstructorParameters<
      typeof SqliteEffectRepository
    >[0],
  );
  effects.recordIssued(legacyEffectRequest);

  opened.close();
  return databasePath;
};

const countNullRowsOnFile = (databasePath: string, table: string): number => {
  const opened = openDatabase(databasePath, { fileMustExist: true });
  try {
    const row = opened.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id IS NULL`)
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  } finally {
    opened.close();
  }
};

describe("parseBackfillArgs", () => {
  it("requires --db and --to-user", () => {
    expect(() => parseBackfillArgs([])).toThrow(ArgumentError);
    expect(() => parseBackfillArgs(["--db", "/tmp/x.sqlite"])).toThrow(
      ArgumentError,
    );
    expect(() => parseBackfillArgs(["--to-user", OWNER_EMAIL])).toThrow(
      ArgumentError,
    );
  });

  it("rejects unknown options and valueless flags", () => {
    expect(() => parseBackfillArgs(["--db"])).toThrow(ArgumentError);
    expect(() =>
      parseBackfillArgs(["--db", "/tmp/x.sqlite", "--to-user", "a", "--wat"]),
    ).toThrow(ArgumentError);
  });

  it("parses the full invocation", () => {
    expect(
      parseBackfillArgs([
        "--db",
        "/tmp/x.sqlite",
        "--to-user",
        OWNER_EMAIL,
        "--dry-run",
        "--yes",
      ]),
    ).toEqual({
      databasePath: "/tmp/x.sqlite",
      userRef: OWNER_EMAIL,
      dryRun: true,
      confirmed: true,
    });
  });
});

describe("executeBackfill", () => {
  it("fails closed on an unregistered user", () => {
    const databasePath = makeLegacyDatabase();
    const outcome = executeBackfill({
      databasePath,
      userRef: "nobody@example.com",
      dryRun: false,
      confirmed: true,
    });
    expect(outcome).toEqual({
      status: "unknown-user",
      userRef: "nobody@example.com",
    });
  });

  it("plans without writing when --yes is missing, and dry-run matches", () => {
    const databasePath = makeLegacyDatabase();

    const plan = executeBackfill({
      databasePath,
      userRef: OWNER_EMAIL,
      dryRun: false,
      confirmed: false,
    });
    expect(plan.status).toBe("needs-confirmation");
    if (plan.status === "unknown-user") {
      throw new Error("unreachable");
    }
    expect(plan.user).toMatchObject({ id: OWNER_ID, email: OWNER_EMAIL });
    const byTable = new Map(plan.tables.map((r) => [r.table, r]));
    expect(byTable.get("context_event_store")?.matched).toBe(2);
    expect(byTable.get("policy_decisions")?.matched).toBe(1);
    expect(byTable.get("effect_requests")?.matched).toBe(1);
    expect([...byTable.values()].every((r) => r.updated === 0)).toBe(true);

    // Nothing moved: the legacy rows are still NULL-stream.
    expect(countNullRowsOnFile(databasePath, "context_event_store")).toBe(2);
    expect(countNullRowsOnFile(databasePath, "policy_decisions")).toBe(1);
    expect(countNullRowsOnFile(databasePath, "effect_requests")).toBe(1);

    const dry = executeBackfill({
      databasePath,
      userRef: OWNER_ID,
      dryRun: true,
      confirmed: false,
    });
    expect(dry.status).toBe("dry-run");
    expect(countNullRowsOnFile(databasePath, "context_event_store")).toBe(2);
  });

  it("attributes every legacy row to the user and is idempotent", async () => {
    const databasePath = makeLegacyDatabase();

    const applied = executeBackfill({
      databasePath,
      userRef: OWNER_EMAIL.toUpperCase(),
      dryRun: false,
      confirmed: true,
    });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") {
      throw new Error("unreachable");
    }
    const byTable = new Map(applied.tables.map((r) => [r.table, r]));
    expect(byTable.get("context_event_store")).toEqual({
      table: "context_event_store",
      matched: 2,
      updated: 2,
    });
    expect(byTable.get("policy_decisions")).toEqual({
      table: "policy_decisions",
      matched: 1,
      updated: 1,
    });
    expect(byTable.get("effect_requests")).toEqual({
      table: "effect_requests",
      matched: 1,
      updated: 1,
    });

    // The re-opened database serves the history as the owner's stream, and
    // the NULL stream is empty — the "frozen hidden data" failure mode is
    // gone.
    expect(countNullRowsOnFile(databasePath, "context_event_store")).toBe(0);
    expect(countNullRowsOnFile(databasePath, "policy_decisions")).toBe(0);
    expect(countNullRowsOnFile(databasePath, "effect_requests")).toBe(0);

    const opened = openDatabase(databasePath, { fileMustExist: true });
    try {
      const store = new SqliteContextEventStore(
        opened.connection as unknown as ConstructorParameters<
          typeof SqliteContextEventStore
        >[0],
      );
      const ownerEvents = await store.listEvents({
        afterSequence: 0,
        asOf: "2026-11-01T00:00:00.000Z",
        limit: 100,
        includeExpired: true,
        userId: OWNER_ID,
      });
      expect(ownerEvents.map((event) => event.id)).toEqual([
        "legacy-1",
        "legacy-2",
      ]);
    } finally {
      opened.close();
    }

    // Re-running matches nothing: the tool is safe to repeat.
    const again = executeBackfill({
      databasePath,
      userRef: OWNER_EMAIL,
      dryRun: false,
      confirmed: true,
    });
    expect(again.status).toBe("applied");
    if (again.status === "applied") {
      expect(again.tables.reduce((sum, r) => sum + r.matched, 0)).toBe(0);
    }
  });
});

describe("runBackfillCommand exit codes", () => {
  it("returns 2 for a plan without --yes, 0 for dry-run and apply", () => {
    const databasePath = makeLegacyDatabase();
    const lines: string[] = [];
    const log = (message: string): void => {
      lines.push(message);
    };

    expect(
      runBackfillCommand(["--db", databasePath, "--to-user", OWNER_EMAIL], log),
    ).toBe(2);
    expect(lines.some((line) => line.includes("--yes"))).toBe(true);

    lines.length = 0;
    expect(
      runBackfillCommand(
        ["--db", databasePath, "--to-user", OWNER_EMAIL, "--dry-run"],
        log,
      ),
    ).toBe(0);
    expect(lines.some((line) => line.includes("Dry run"))).toBe(true);

    lines.length = 0;
    expect(
      runBackfillCommand(
        ["--db", databasePath, "--to-user", OWNER_EMAIL, "--yes"],
        log,
      ),
    ).toBe(0);
    expect(lines.some((line) => line.includes("Applied: 4 row(s)"))).toBe(true);
  });

  it("returns 1 for an unknown user and for bad usage", () => {
    const databasePath = makeLegacyDatabase();
    const silent = (): void => {};
    expect(
      runBackfillCommand(
        ["--db", databasePath, "--to-user", "ghost@example.com", "--yes"],
        silent,
      ),
    ).toBe(1);
    expect(runBackfillCommand(["--to-user", OWNER_EMAIL], silent)).toBe(1);
  });
});
