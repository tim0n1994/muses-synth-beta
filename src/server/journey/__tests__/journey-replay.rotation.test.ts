import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/index.js";
import {
  authedHeaders,
  createWorkspace,
  ingestSession,
  registerInWorkspace,
  seedSelfPool,
  type Opened,
} from "./wiring-workspace.js";

/**
 * Rotation seed avoidance (Round-2 batch-2 defect #3).
 *
 * R1's re-verification (v07-round1-report.md:305) measured the mechanism in
 * readings.py: the deterministic pick is seed % bucket_size and a self pool
 * bucket holds only 4 tracks, so a re-roll lands on the same track 1/4 of
 * the time. The replay planner has the same shape — hashIndex over
 * catalog[bucket] for the track and a second hash over 60 clip offsets —
 * and re-rendering today does not rotate at all: the seed is
 * `${journeyId}:${index}` on every render, so POST /replay twice returns
 * byte-identical plans.
 *
 * Contract under test (HTTP level, real runtime wiring, 4-track buckets):
 * re-rendering a journey's replay re-rolls every segment — a new plan id,
 * and for each segment index the new (trackId, clipStartSec) pick differs
 * from the previous render's pick at that index (both halves move); every
 * roll persists as a distinct row and GET serves the newest.
 */

const ROLLS = 3;

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
  readonly clipStartSec: number;
}

interface ReplayDto {
  readonly replay: {
    readonly replayId: string;
    readonly segments: readonly SegmentDto[];
  };
}

describe("replay re-render rotation (seed avoidance)", () => {
  it(
    `re-rendering ${ROLLS} times never repeats the previous pick at any segment`,
    { timeout: 120_000 },
    async () => {
      const workspace = createWorkspace();
      cleanups.push(() => workspace.destroy());
      const session = await registerInWorkspace(
        workspace,
        "rotate@example.com",
      );
      seedSelfPool(workspace.databasePath);

      const opened: Opened = await workspace.open({
        MUSES_V07: "1",
        MUSES_V07_REPLAY: "1",
        MUSES_V07_USERS: session.userId,
      });
      cleanups.push(() => opened.close());
      await ingestSession(opened.app, session.token, "rot");

      const list = await opened.app.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: authedHeaders(session.token),
      });
      expect(list.statusCode).toBe(200);
      const journeyId = list.json<{ items: readonly { journeyId: string }[] }>()
        .items[0]!.journeyId;

      const render = async (): Promise<ReplayDto["replay"]> => {
        const response = await opened.app.inject({
          method: "POST",
          url: `/api/v1/journeys/${journeyId}/replay`,
          headers: authedHeaders(session.token),
          payload: {},
        });
        expect(response.statusCode).toBe(201);
        return response.json<ReplayDto>().replay;
      };

      let previous = await render();
      expect(previous.segments.length).toBeGreaterThanOrEqual(1);
      const replayIds = new Set([previous.replayId]);

      for (let roll = 2; roll <= ROLLS; roll += 1) {
        // Keep generated_at strictly ordered (ms-resolution clock).
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        const next = await render();
        expect(next.segments.length).toBe(previous.segments.length);
        expect(replayIds.has(next.replayId)).toBe(false);
        replayIds.add(next.replayId);

        for (const [index, segment] of next.segments.entries()) {
          const prior = previous.segments[index]!;
          expect(segment.segmentId, `roll ${roll} seg ${index} id`).toBe(
            prior.segmentId,
          );
          expect(segment.bucket, `roll ${roll} seg ${index} bucket`).toBe(
            prior.bucket,
          );
          // Same-bucket re-roll: the seed rotation must exclude the previous
          // offset — same track AND same clip start is a no-op re-roll.
          expect(
            segment.trackId === prior.trackId &&
              segment.clipStartSec === prior.clipStartSec,
            `roll ${roll} seg ${index} re-rolled the exact previous pick (${prior.trackId}@${prior.clipStartSec})`,
          ).toBe(false);
          expect(
            segment.trackId,
            `roll ${roll} seg ${index} trackId repeated (${prior.trackId})`,
          ).not.toBe(prior.trackId);
          expect(
            segment.clipStartSec,
            `roll ${roll} seg ${index} clipStartSec repeated`,
          ).not.toBe(prior.clipStartSec);
        }
        previous = next;
      }

      // The rolls were over real 4-track buckets (catalog wiring in place),
      // so BOTH halves of the pick were free to move.
      expect(
        previous.segments.every((s) => s.trackId !== "unassigned"),
        "rotation must be exercised over the real self pool",
      ).toBe(true);

      // GET serves the newest roll; every roll persisted as its own row.
      const fetched = await opened.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(session.token),
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json<ReplayDto>().replay.replayId).toBe(previous.replayId);

      const db = openDatabase(workspace.databasePath);
      try {
        const rows = db.connection
          .prepare(
            "SELECT COUNT(*) AS n FROM journey_replays WHERE journey_id = ?",
          )
          .get(journeyId) as { n: number };
        console.info(
          `[replay-rotation] rolls=${ROLLS} rows=${rows.n} replayIds=${replayIds.size}`,
        );
        expect(rows.n).toBe(ROLLS);
      } finally {
        db.close();
      }
    },
  );
});
