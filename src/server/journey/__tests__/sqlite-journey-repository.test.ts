import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  openDatabase,
  runMigrations,
  type OpenDatabaseResult,
} from "../../db/index.js";
import { SqliteJourneyRepository, type SqliteDatabasePort } from "../index.js";
import type { JourneySnapshot, ReplayPlan } from "../index.js";

/**
 * Repository-level ownership (privilege matrix group 6, row #26): every read
 * path carries the user_id predicate — the SQL mirror of v0.6's
 * sqlite-effect-repository `WHERE user_id IS ?` contract. A cross-user read
 * returns null, indistinguishable from a missing row.
 */

interface Fixture {
  readonly repository: SqliteJourneyRepository;
  readonly opened: OpenDatabaseResult;
  readonly cleanup: () => void;
}

let fixture: Fixture | undefined;
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  fixture = undefined;
});

const buildFixture = (): Fixture => {
  const directory = mkdtempSync(join(tmpdir(), "muses-journey-repo-"));
  const opened = openDatabase(join(directory, "muses.sqlite"));
  runMigrations(opened.connection, { purpose: "test" });
  // Boundary cast: same rationale as runtime-modules.ts.
  const repository = new SqliteJourneyRepository(
    opened.connection as unknown as SqliteDatabasePort,
  );
  const cleanup = () => {
    opened.close();
    rmSync(directory, { recursive: true, force: true });
  };
  cleanups.push(cleanup);
  fixture = { repository, opened, cleanup };
  return fixture;
};

const snapshot = (
  overrides: Partial<JourneySnapshot> = {},
): JourneySnapshot => ({
  journeyId: "jrn_" + "a".repeat(24),
  sessionStartedAt: "2026-10-20T09:00:00.000Z",
  sessionEndedAt: "2026-10-20T11:00:00.000Z",
  durationSec: 7_200,
  eventCount: 120,
  derivedAt: "2026-10-20T12:00:00.000Z",
  retentionDays: 90,
  samples: [
    { offsetSec: 0, pace: "low", intensity: "low", eventCount: 1 },
    { offsetSec: 30, pace: "high", intensity: "low", eventCount: 8 },
  ],
  nodes: [
    {
      nodeId: "node_" + "b".repeat(12),
      type: "flow_entered",
      offsetSec: 60,
      evidenceEventIds: ["e1", "e2", "e3"],
    },
  ],
  ...overrides,
});

const plan = (journeyId: string): ReplayPlan => ({
  replayId: "rpl_" + "c".repeat(24),
  journeyId,
  generatedAt: "2026-10-20T12:01:00.000Z",
  totalDurationSec: 2_250,
  segments: [
    {
      segmentId: "seg_0001",
      bucket: "self:high:low",
      trackId: "trk-flow-1",
      clipStartSec: 12,
      replayStartSec: 0,
      durationSec: 90,
      crossfadeSec: 4,
      journeyStartSec: 0,
      journeyEndSec: 3_600,
    },
    {
      segmentId: "seg_0002",
      bucket: "self:low:low",
      trackId: "trk-rest-1",
      clipStartSec: 0,
      replayStartSec: 86,
      durationSec: 100,
      crossfadeSec: 0,
      journeyStartSec: 3_600,
      journeyEndSec: 7_200,
    },
  ],
});

describe("sqlite journey repository", () => {
  it("round-trips a snapshot for its owner", () => {
    const { repository } = buildFixture();
    const authored = snapshot();
    repository.upsertSnapshot(authored, "user-a");
    expect(repository.getById(authored.journeyId, "user-a")).toEqual(authored);
  });

  it("returns null for a cross-user read (matrix #26)", () => {
    const { repository } = buildFixture();
    const authored = snapshot();
    repository.upsertSnapshot(authored, "user-a");
    expect(repository.getById(authored.journeyId, "user-b")).toBeNull();
    expect(repository.getById(authored.journeyId, null)).toBeNull();
  });

  it("scopes the summary list per user", () => {
    const { repository } = buildFixture();
    const alice = snapshot({
      journeyId: "jrn_" + "1".repeat(24),
      sessionStartedAt: "2026-10-20T09:00:00.000Z",
    });
    const alice2 = snapshot({
      journeyId: "jrn_" + "2".repeat(24),
      sessionStartedAt: "2026-10-21T09:00:00.000Z",
    });
    const bob = snapshot({
      journeyId: "jrn_" + "3".repeat(24),
      sessionStartedAt: "2026-10-22T09:00:00.000Z",
    });
    repository.upsertSnapshot(alice, "user-a");
    repository.upsertSnapshot(alice2, "user-a");
    repository.upsertSnapshot(bob, "user-b");

    const forAlice = repository.listSummaries("user-a");
    expect(forAlice.map((s) => s.journeyId).sort()).toEqual(
      [alice2.journeyId, alice.journeyId].sort(),
    );
    // Most recent session first.
    expect(forAlice[0]?.journeyId).toBe(alice2.journeyId);
    expect(repository.listSummaries("user-b").map((s) => s.journeyId)).toEqual([
      bob.journeyId,
    ]);
  });

  it("re-deriving the same session overwrites instead of duplicating", () => {
    const { repository } = buildFixture();
    repository.upsertSnapshot(snapshot(), "user-a");
    repository.upsertSnapshot(
      snapshot({ eventCount: 240, derivedAt: "2026-10-20T13:00:00.000Z" }),
      "user-a",
    );
    const summaries = repository.listSummaries("user-a");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.eventCount).toBe(240);
  });

  it("scopes replays per user and returns the latest render", () => {
    const { repository } = buildFixture();
    const authored = snapshot();
    repository.upsertSnapshot(authored, "user-a");
    const first = plan(authored.journeyId);
    repository.saveReplay(first, "user-a");
    const second = {
      ...first,
      replayId: "rpl_" + "d".repeat(24),
      generatedAt: "2026-10-20T12:05:00.000Z",
    };
    repository.saveReplay(second, "user-a");

    expect(repository.getLatestReplay(authored.journeyId, "user-a")).toEqual(
      second,
    );
    // Cross-user replay reads are null even though the journey id is real
    // (matrix #4/#26).
    expect(repository.getLatestReplay(authored.journeyId, "user-b")).toBeNull();
    expect(repository.getLatestReplay(authored.journeyId, null)).toBeNull();
  });

  it("defaults retention to 90 days on the stored row", () => {
    const { repository, opened } = buildFixture();
    repository.upsertSnapshot(snapshot(), "user-a");
    const row = opened.connection
      .prepare(`SELECT retention_days FROM journeys WHERE journey_id = ?`)
      .get(snapshot().journeyId) as { retention_days: number };
    expect(row.retention_days).toBe(90);
  });

  it("prunes journeys past their per-row retention window", () => {
    const { repository } = buildFixture();
    const fresh = snapshot({
      journeyId: "jrn_" + "f".repeat(24),
      sessionEndedAt: "2026-10-18T11:00:00.000Z",
    });
    const stale = snapshot({
      journeyId: "jrn_" + "s".repeat(24),
      sessionStartedAt: "2026-06-01T09:00:00.000Z",
      sessionEndedAt: "2026-06-01T11:00:00.000Z",
    });
    repository.upsertSnapshot(fresh, "user-a");
    repository.upsertSnapshot(stale, "user-a");
    const staleReplay = plan(stale.journeyId);
    repository.saveReplay(staleReplay, "user-a");

    const removed = repository.pruneExpired(
      new Date("2026-10-20T12:00:00.000Z"),
    );
    expect(removed.journeys).toBe(1);
    expect(repository.getById(stale.journeyId, "user-a")).toBeNull();
    // The stale journey's replay went with it.
    expect(repository.getLatestReplay(stale.journeyId, "user-a")).toBeNull();
    expect(repository.getById(fresh.journeyId, "user-a")).toEqual(fresh);
    // Idempotent.
    expect(
      repository.pruneExpired(new Date("2026-10-20T12:00:00.000Z")).journeys,
    ).toBe(0);
  });
});
