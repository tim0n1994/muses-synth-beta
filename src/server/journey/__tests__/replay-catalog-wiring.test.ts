import { afterEach, describe, expect, it } from "vitest";

import { SELF_TRACK_BUCKETS } from "../../library/license-gate.js";
import {
  authedHeaders,
  createWorkspace,
  ingestSession,
  registerInWorkspace,
  seedSelfPool,
  type Opened,
} from "./wiring-workspace.js";

/**
 * Wiring-level catalog test (Round-2 batch-2 defect #1).
 *
 * The planner keys its catalog by the journey vocabulary
 * ("self:<pace>:<intensity>", pace/intensity in low|medium|high) while the
 * library stores V2 buckets as "self_<slow|mid|fast>_<low|mid|high>". The
 * production replay rpl_18e90d2e4fd49ec22999582c (read-only SQL, 2026-10-21)
 * has 32/32 segments at trackId "unassigned" because the stage-3 injection
 * (runtime-modules.ts, catalog -> planner) hands the library keys over
 * verbatim and no key ever matches.
 *
 * This test goes through the REAL production graph — buildRuntimeModules
 * with MUSES_V07 / MUSES_V07_REPLAY on and the caller on MUSES_V07_USERS —
 * so the exact injection line is what is under test, not a fixture mirror
 * of it. Contract: with the self pool ingested (9 buckets x 4 tracks, the
 * production shape), every rendered segment resolves to a real track id
 * that belongs to the library bucket its journey bucket maps to, and the
 * "unassigned" count is exactly 0.
 */

const TRACKS_PER_BUCKET = 4;

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

interface SegmentDto {
  readonly segmentId: string;
  readonly bucket: string;
  readonly trackId: string;
}

interface ReplayDto {
  readonly replay: {
    readonly replayId: string;
    readonly segments: readonly SegmentDto[];
  };
}

const PACE_TO_LIBRARY: Readonly<Record<string, string>> = {
  low: "slow",
  medium: "mid",
  high: "fast",
};
const INTENSITY_TO_LIBRARY: Readonly<Record<string, string>> = {
  low: "low",
  medium: "mid",
  high: "high",
};

/**
 * Independent re-derivation of the bucket correspondence (deliberately NOT
 * imported from production code): journey pace low|medium|high is library
 * slow|mid|fast, journey intensity low|medium|high is library low|mid|high.
 */
const libraryBucketOf = (journeyBucket: string): string => {
  const match = /^self:(low|medium|high):(low|medium|high)$/.exec(
    journeyBucket,
  );
  if (match === null) {
    throw new Error(`unexpected journey bucket ${journeyBucket}`);
  }
  return `self_${PACE_TO_LIBRARY[match[1]!]}_${INTENSITY_TO_LIBRARY[match[2]!]}`;
};

describe("replay catalog wiring (library buckets -> planner buckets)", () => {
  it(
    "renders every segment on a real self-pool track: unassigned count is 0",
    { timeout: 120_000 },
    async () => {
      const workspace = createWorkspace();
      cleanups.push(() => workspace.destroy());
      const session = await registerInWorkspace(
        workspace,
        "wiring@example.com",
      );

      // Ingest the pilot self pool while no process holds the file.
      const seeded = seedSelfPool(workspace.databasePath);
      const allSeededIds = new Set(Object.values(seeded).flat());
      expect(allSeededIds.size).toBe(
        SELF_TRACK_BUCKETS.length * TRACKS_PER_BUCKET,
      );

      // The production switches, caller on the allowlist.
      const opened: Opened = await workspace.open({
        MUSES_V07: "1",
        MUSES_V07_REPLAY: "1",
        MUSES_V07_USERS: session.userId,
      });
      cleanups.push(() => opened.close());
      await ingestSession(opened.app, session.token, "wire");

      const list = await opened.app.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: authedHeaders(session.token),
      });
      expect(list.statusCode).toBe(200);
      const items = list.json<{ items: readonly { journeyId: string }[] }>()
        .items;
      expect(items.length).toBeGreaterThanOrEqual(1);
      const journeyId = items[0]!.journeyId;

      const rendered = await opened.app.inject({
        method: "POST",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(session.token),
        payload: {},
      });
      expect(rendered.statusCode).toBe(201);
      const segments = rendered.json<ReplayDto>().replay.segments;
      expect(segments.length).toBeGreaterThanOrEqual(1);

      const buckets = [...new Set(segments.map((segment) => segment.bucket))];
      expect(buckets.length).toBeGreaterThanOrEqual(2);

      const unassigned = segments.filter(
        (segment) => segment.trackId === "unassigned",
      ).length;
      console.info(
        `[replay-catalog-wiring] segments=${segments.length} unassigned=${unassigned} buckets=${buckets.join(",")}`,
      );
      expect(unassigned, "segments left at trackId=unassigned").toBe(0);

      // Every track id is a real seeded id AND belongs to the library bucket
      // its journey bucket corresponds to (no cross-bucket leakage).
      for (const segment of segments) {
        expect(allSeededIds.has(segment.trackId)).toBe(true);
        expect(seeded[libraryBucketOf(segment.bucket)]).toContain(
          segment.trackId,
        );
      }

      // The stored plan serves back identically (GET after POST).
      const fetched = await opened.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(session.token),
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json<ReplayDto>().replay.segments).toEqual(segments);
    },
  );
});
