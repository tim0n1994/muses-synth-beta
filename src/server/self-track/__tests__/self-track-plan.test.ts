import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openDatabase, runMigrations } from "../../db/index.js";
import type { SqliteDatabase } from "../../db/types.js";
import type { PulseSnapshot } from "../../vibe-signal/model.js";
import {
  buildPlaybackPlan,
  crossfadeMsOf,
  DEFAULT_CROSSFADE_MS,
  DEFAULT_PLAN_BUCKET,
  planSeedFor,
  resolveTargetBucket,
  type LibraryTrackRow,
} from "../plan.js";
import {
  SelfTrackLibraryEmptyError,
  SelfTrackPlanService,
} from "../plan-service.js";
import { selfTrackRoutes } from "../routes.js";

const row = (
  id: string,
  bucket: string = "self_mid_mid",
  durationSeconds = 180,
): LibraryTrackRow => ({
  id,
  bucket,
  title: `Track ${id}`,
  author: "Pilot Author",
  license: "CC-BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  audioPath: `self/${bucket}/${id}.opus`,
  durationSeconds,
});

const snapshot = (
  rhythm: PulseSnapshot["rhythm"]["value"],
  intensity: PulseSnapshot["intensity"]["value"],
  modulation: PulseSnapshot["emotion"]["transitionModulation"],
): PulseSnapshot => ({
  asOf: "2026-10-20T10:00:00.000Z",
  windowStartedAt: "2026-10-20T09:59:00.000Z",
  windowEndedAt: "2026-10-20T10:00:00.000Z",
  rhythm: { value: rhythm, score: 0.5, evidence: [] },
  intensity: { value: intensity, score: 0.5, evidence: [] },
  emotion: {
    value: 0,
    tone: "NEUTRAL",
    transitionModulation: modulation,
    evidence: [],
  },
  evidence: [],
  unknownReasons: [],
  explanation: [],
  rulesetVersion: "test",
  inputDigest: "digest-1",
});

describe("resolveTargetBucket (V2 mapping)", () => {
  it("maps every known rhythm x intensity pair", () => {
    expect(resolveTargetBucket("SLOW", "CALM")).toBe("self_slow_low");
    expect(resolveTargetBucket("SLOW", "STEADY")).toBe("self_slow_mid");
    expect(resolveTargetBucket("SLOW", "INTENSE")).toBe("self_slow_high");
    expect(resolveTargetBucket("STEADY", "CALM")).toBe("self_mid_low");
    expect(resolveTargetBucket("STEADY", "STEADY")).toBe("self_mid_mid");
    expect(resolveTargetBucket("STEADY", "INTENSE")).toBe("self_mid_high");
    expect(resolveTargetBucket("FAST", "CALM")).toBe("self_fast_low");
    expect(resolveTargetBucket("FAST", "STEADY")).toBe("self_fast_mid");
    expect(resolveTargetBucket("FAST", "INTENSE")).toBe("self_fast_high");
  });

  it("falls back to the V9 signature default on UNKNOWN pulse levels", () => {
    expect(resolveTargetBucket("UNKNOWN", "UNKNOWN")).toBe(DEFAULT_PLAN_BUCKET);
  });

  it("applies emotion energy bias clamped at the grid edges", () => {
    expect(resolveTargetBucket("STEADY", "STEADY", -1)).toBe("self_mid_low");
    expect(resolveTargetBucket("STEADY", "CALM", -1)).toBe("self_mid_low");
    expect(resolveTargetBucket("STEADY", "STEADY", 1)).toBe("self_mid_high");
    expect(resolveTargetBucket("FAST", "INTENSE", 1)).toBe("self_fast_high");
  });
});

describe("plan seed and rotation", () => {
  it("is deterministic for the same user and snapshot", () => {
    const snap = snapshot("STEADY", "STEADY", {
      crossfadeMs: 6000,
      energyBias: 0,
      hardCut: false,
    });
    expect(planSeedFor("user-1", snap)).toBe(planSeedFor("user-1", snap));
    expect(planSeedFor("user-1", snap)).not.toBe(planSeedFor("user-2", snap));
  });

  it("wraps the bucket without adjacent repeats", () => {
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const plan = buildPlaybackPlan(rows, 3, 4, 6000);
    expect(plan.steps.map((step) => step.track.trackId)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
    for (let index = 1; index < plan.steps.length; index += 1) {
      expect(plan.steps[index]!.track.trackId).not.toBe(
        plan.steps[index - 1]!.track.trackId,
      );
    }
  });

  it("emits /library/ URLs from the stored audio path", () => {
    const plan = buildPlaybackPlan([row("a", "self_mid_mid")], 0, 1, 6000);
    expect(plan.steps[0]!.track.url).toBe("/library/self/self_mid_mid/a.opus");
    expect(plan.steps[0]!.track.durationMs).toBe(180_000);
  });

  it("opens on the next track when told to avoid the one the seed lands on", () => {
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const plain = buildPlaybackPlan(rows, 3, 3, 6000);
    expect(plain.steps.map((step) => step.track.trackId)).toEqual([
      "d",
      "a",
      "b",
    ]);
    expect(
      buildPlaybackPlan(rows, 3, 3, 6000, "d").steps.map(
        (step) => step.track.trackId,
      ),
    ).toEqual(["a", "b", "c"]);
    // A track the seed does not land on changes nothing.
    expect(buildPlaybackPlan(rows, 3, 3, 6000, "b")).toEqual(plain);
    // A single-track bucket has nothing else to play.
    expect(
      buildPlaybackPlan([row("a")], 0, 2, 6000, "a").steps.map(
        (step) => step.track.trackId,
      ),
    ).toEqual(["a", "a"]);
  });

  it("clamps crossfade into [0, MAX_CROSSFADE_MS]", () => {
    expect(
      buildPlaybackPlan([row("a")], 0, 1, 99_999).steps[0]!.crossfadeMs,
    ).toBe(12_000);
    expect(buildPlaybackPlan([row("a")], 0, 1, -5).steps[0]!.crossfadeMs).toBe(
      0,
    );
  });
});

describe("crossfadeMsOf (emotion modulates transitions, never buckets)", () => {
  it("defaults to 6s without a pulse", () => {
    expect(crossfadeMsOf(null)).toBe(DEFAULT_CROSSFADE_MS);
  });

  it("honors hard cuts", () => {
    expect(
      crossfadeMsOf(
        snapshot("FAST", "INTENSE", {
          crossfadeMs: 6000,
          energyBias: 0,
          hardCut: true,
        }),
      ),
    ).toBe(0);
  });
});

describe("SelfTrackPlanService over a migrated database", () => {
  let database: SqliteDatabase;
  let directory: string;

  const insertTrack = (id: string, bucket: string): void => {
    database
      .prepare(
        `INSERT INTO library_tracks (
           id, track_pool, bucket, title, author, source, source_url,
           audio_url, audio_path, license, license_url, license_evidence_url,
           snapshot_path, snapshot_sha256, content_sha256, duration_seconds,
           size_bytes, bitrate_kbps, mime_type, features_json,
           bucket_rule_version, pro_registered, ingested_at
         ) VALUES (
           ?, 'self', ?, ?, ?, 'fma', ?, ?, ?, 'CC-BY 4.0',
           'https://creativecommons.org/licenses/by/4.0/',
           'https://example.org/evidence', ?, ?, ?, 180, 1000, 96,
           'audio/ogg', '{}', 'pilot-v1', 0, '2026-10-20T00:00:00.000Z'
         )`,
      )
      .run(
        id,
        bucket,
        `Title ${id}`,
        `Author ${id}`,
        `https://example.org/${id}`,
        `https://example.org/audio/${id}`,
        `self/${bucket}/${id}.opus`,
        `snapshots/${id}.json`,
        "a".repeat(64),
        "b".repeat(64),
      );
  };

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "muses-self-track-test-"));
    const opened = openDatabase(join(directory, "muses.sqlite"));
    database = opened.connection;
    runMigrations(database, { purpose: "test" });
  });

  afterAll(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("plans from the pulse bucket with deterministic rotation", async () => {
    for (const id of ["t1", "t2", "t3", "t4"]) {
      insertTrack(id, "self_fast_high");
    }
    insertTrack("m1", "self_mid_mid");
    const service = new SelfTrackPlanService({
      database,
      pulseFor: () => ({
        current: async () =>
          snapshot("FAST", "INTENSE", {
            crossfadeMs: 4500,
            energyBias: 0,
            hardCut: false,
          }),
      }),
    });
    const plan = await service.planFor("user-1");
    expect(plan.steps).toHaveLength(3);
    for (const step of plan.steps) {
      expect(step.track.url).toMatch(/^\/library\/self\/self_fast_high\//);
      expect(step.crossfadeMs).toBe(4500);
    }
    const again = await service.planFor("user-1");
    expect(again).toEqual(plan);
  });

  it("falls back to the default bucket, then to any self track", async () => {
    const service = new SelfTrackPlanService({ database });
    // No pulse -> DEFAULT_PLAN_BUCKET (self_mid_mid) holds m1.
    const plan = await service.planFor(null);
    expect(plan.steps[0]!.track.trackId).toBe("m1");
  });

  it("opens a moved pulse on a different track even when the re-rolled seed lands on the playing one (R2 B3)", async () => {
    const base = snapshot("FAST", "INTENSE", {
      crossfadeMs: 4500,
      energyBias: 0,
      hardCut: false,
    });
    const first: PulseSnapshot = { ...base, asOf: "2026-10-20T10:00:00.000Z" };
    // The bucket self_fast_high holds t1..t4; find a moved snapshot whose seed
    // lands on the same offset as the first one — the collision the review
    // caught holding the plan for 62.94s.
    const offsetOf = (snap: PulseSnapshot): number =>
      planSeedFor("user-2", snap) % 4;
    let second: PulseSnapshot = first;
    for (let seconds = 1; seconds <= 1_000; seconds += 1) {
      const candidate: PulseSnapshot = {
        ...base,
        asOf: new Date(Date.parse(first.asOf) + seconds * 1_000).toISOString(),
      };
      if (offsetOf(candidate) === offsetOf(first)) {
        second = candidate;
        break;
      }
    }
    expect(second).not.toBe(first);
    expect(planSeedFor("user-2", second)).not.toBe(
      planSeedFor("user-2", first),
    );

    let current = first;
    const service = new SelfTrackPlanService({
      database,
      pulseFor: () => ({ current: async () => current }),
    });
    const sorted = ["t1", "t2", "t3", "t4"];
    const planA = await service.planFor("user-2");
    expect(planA.steps[0]!.track.trackId).toBe(sorted[offsetOf(first)]);
    // Repeatable while the pulse holds.
    expect(await service.planFor("user-2")).toEqual(planA);

    current = second;
    const planB = await service.planFor("user-2");
    // The bare roll would have opened on the same track; avoidance moves it
    // to the next one in rotation.
    expect(planB.steps[0]!.track.trackId).toBe(
      sorted[(offsetOf(first) + 1) % 4],
    );
    expect(planB.steps[0]!.track.trackId).not.toBe(
      planA.steps[0]!.track.trackId,
    );
    // Still repeatable for the moved pulse (the avoidance is sticky per seed).
    expect(await service.planFor("user-2")).toEqual(planB);
    // Another user is planned independently.
    expect((await service.planFor("user-3")).steps[0]!.track.trackId).toBe(
      sorted[planSeedFor("user-3", second) % 4],
    );
  });

  it("rejects with SelfTrackLibraryEmptyError on an un-ingested pool", async () => {
    const fresh = mkdtempSync(join(tmpdir(), "muses-self-track-empty-"));
    const opened = openDatabase(join(fresh, "muses.sqlite"));
    try {
      runMigrations(opened.connection, { purpose: "test" });
      const service = new SelfTrackPlanService({
        database: opened.connection,
      });
      await expect(service.planFor(null)).rejects.toBeInstanceOf(
        SelfTrackLibraryEmptyError,
      );
    } finally {
      opened.connection.close();
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe("self-track plan routes (bare app)", () => {
  it("answers 200 with the plan envelope and 503 when the library is empty", async () => {
    const populated = mkdtempSync(join(tmpdir(), "muses-self-track-route-"));
    const empty = mkdtempSync(join(tmpdir(), "muses-self-track-route-empty-"));
    const openedPopulated = openDatabase(join(populated, "muses.sqlite"));
    const openedEmpty = openDatabase(join(empty, "muses.sqlite"));
    try {
      runMigrations(openedPopulated.connection, { purpose: "test" });
      runMigrations(openedEmpty.connection, { purpose: "test" });
      openedPopulated.connection
        .prepare(
          `INSERT INTO library_tracks (
             id, track_pool, bucket, title, author, source, source_url,
             audio_url, audio_path, license, license_url,
             license_evidence_url, snapshot_path, snapshot_sha256,
             content_sha256, duration_seconds, size_bytes, bitrate_kbps,
             mime_type, features_json, bucket_rule_version, pro_registered,
             ingested_at
           ) VALUES (
             'r1', 'self', 'self_mid_mid', 'Title', 'Author', 'fma',
             'https://example.org/r1', 'https://example.org/audio/r1',
             'self/self_mid_mid/r1.opus', 'CC-BY 4.0',
             'https://creativecommons.org/licenses/by/4.0/',
             'https://example.org/evidence', 'snapshots/r1.json',
             '${"a".repeat(64)}', '${"b".repeat(64)}', 200.5, 1000, 96,
             'audio/ogg', '{}', 'pilot-v1', 0, '2026-10-20T00:00:00.000Z'
           )`,
        )
        .run();

      const app = Fastify({ logger: false });
      await app.register(selfTrackRoutes, {
        service: new SelfTrackPlanService({
          database: openedPopulated.connection,
        }),
      });
      await app.ready();

      const ok = await app.inject({
        method: "GET",
        url: "/api/v1/self-track/plan",
      });
      expect(ok.statusCode).toBe(200);
      const body = ok.json<{ steps: { track: { url: string } }[] }>();
      expect(body.steps[0]!.track.url).toBe(
        "/library/self/self_mid_mid/r1.opus",
      );
      await app.close();

      const emptyApp = Fastify({ logger: false });
      await emptyApp.register(selfTrackRoutes, {
        service: new SelfTrackPlanService({
          database: openedEmpty.connection,
        }),
      });
      await emptyApp.ready();
      const unavailable = await emptyApp.inject({
        method: "GET",
        url: "/api/v1/self-track/plan",
      });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json<{ error: { code: string } }>().error.code).toBe(
        "SELF_TRACK_LIBRARY_EMPTY",
      );
      await emptyApp.close();
    } finally {
      openedPopulated.connection.close();
      openedEmpty.connection.close();
      rmSync(populated, { recursive: true, force: true });
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
