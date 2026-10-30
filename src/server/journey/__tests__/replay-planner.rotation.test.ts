import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ContextEventRecord } from "../../context/model.js";
import { deriveJourneySnapshots, selfTrackBucket } from "../index.js";
import { planReplay } from "../replay-planner.js";

/**
 * Deterministic rotation spec (Round-2 batch-2 defect #3, planner unit):
 * re-rendering a replay passes an incrementing `rotation`; the seed for the
 * track pick and the clip offset both rotate, and each roll explicitly
 * excludes the previous roll's pick — same bucket, N consecutive track
 * changes, the offset never equals the previous one (the R1 report:305
 * collision class: seed % bucket_size with 4 tracks per bucket collides 1/4
 * of the time when unexcluded).
 *
 * Frozen-contract guard: rotation 0 (and the omitted option) must stay
 * byte-identical to the v0 output — existing stored plans and planner tests
 * must not move.
 */

const BASE = new Date("2026-10-20T09:00:00.000Z");

let sequence = 0;
const ev = (id: string, offsetSec: number): ContextEventRecord => {
  const at = new Date(BASE.getTime() + offsetSec * 1_000);
  sequence += 1;
  return {
    specversion: "1.0",
    id,
    source: "urn:test:rotation",
    type: "muses.editor.activity",
    subject: "workspace:test",
    extensions: {},
    contentHash: createHash("sha256").update(id).digest("hex"),
    occurredAt: at.toISOString(),
    receivedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 7 * 86_400_000).toISOString(),
    outOfOrder: false,
    serverSequence: sequence,
    data: { action: "edit" },
  };
};

const workingDay = (): ContextEventRecord[] => {
  const events: ContextEventRecord[] = [];
  for (let t = 0; t < 1_800; t += 25) {
    events.push(ev(`warm-${t}`, t));
  }
  for (let t = 1_800; t < 9_000; t += 4) {
    events.push(ev(`flow-${t}`, t));
  }
  for (let t = 9_000; t < 11_400; t += 22) {
    events.push(ev(`dip-${t}`, t));
  }
  for (let t = 13_200; t < 15_000; t += 12) {
    events.push(ev(`pm-${t}`, t));
  }
  return events;
};

const snapshot = deriveJourneySnapshots(workingDay(), {
  userId: "user-rotation",
  now: BASE,
})[0]!;
if (snapshot === undefined) {
  throw new Error("rotation spec: the working day derived no snapshot");
}

const CATALOG: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  (["low", "medium", "high"] as const).flatMap((pace) =>
    (["low", "medium", "high"] as const).map((intensity) => [
      selfTrackBucket(pace, intensity),
      ["trk-a1", "trk-a2", "trk-a3", "trk-a4"],
    ]),
  ),
);

const GENERATED_AT = "2026-10-20T21:00:00.000Z";
const ROLLS = 12;

describe("replay planner rotation (same-bucket seed avoidance)", () => {
  it("rotation 0 and the omitted option stay byte-identical to v0", () => {
    const legacy = planReplay(snapshot, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    const zero = planReplay(snapshot, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
      rotation: 0,
    });
    expect(JSON.stringify(zero)).toBe(JSON.stringify(legacy));
    // Every rotation-0 pick still resolves to a real catalog id.
    for (const segment of legacy.segments) {
      expect(CATALOG[segment.bucket]).toContain(segment.trackId);
    }
  });

  it("same-bucket re-rolls never repeat the previous offset (N consecutive rotations)", () => {
    let previous = planReplay(snapshot, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
      rotation: 0,
    });
    for (let rotation = 1; rotation <= ROLLS; rotation += 1) {
      const next = planReplay(snapshot, {
        catalog: CATALOG,
        generatedAt: GENERATED_AT,
        rotation,
      });
      // Segment structure (ids, buckets, schedule) is rotation-invariant;
      // only the audible picks move.
      expect(next.replayId).not.toBe(previous.replayId);
      expect(next.totalDurationSec).toBe(previous.totalDurationSec);
      for (const [index, segment] of next.segments.entries()) {
        const prior = previous.segments[index]!;
        expect(segment.segmentId).toBe(prior.segmentId);
        expect(segment.bucket).toBe(prior.bucket);
        expect(segment.replayStartSec).toBe(prior.replayStartSec);
        expect(segment.durationSec).toBe(prior.durationSec);
        // 4 tracks per bucket: both halves of the pick must move.
        expect(segment.trackId, `rotation ${rotation} seg ${index}`).not.toBe(
          prior.trackId,
        );
        expect(
          segment.clipStartSec,
          `rotation ${rotation} seg ${index}`,
        ).not.toBe(prior.clipStartSec);
        expect(CATALOG[segment.bucket]).toContain(segment.trackId);
        expect(segment.clipStartSec).toBeLessThan(60);
      }
      previous = next;
    }
  });

  it("rotation is deterministic for identical inputs", () => {
    const run = (rotation: number) =>
      planReplay(snapshot, {
        catalog: CATALOG,
        generatedAt: GENERATED_AT,
        rotation,
      });
    expect(JSON.stringify(run(5))).toBe(JSON.stringify(run(5)));
    expect(JSON.stringify(run(7))).not.toBe(JSON.stringify(run(8)));
  });

  it("single-track buckets keep their only track but still move the clip", () => {
    const single: Readonly<Record<string, readonly string[]>> = {
      "self:low:low": ["only-track"],
    };
    const first = planReplay(snapshot, {
      catalog: single,
      generatedAt: GENERATED_AT,
      rotation: 0,
    });
    const second = planReplay(snapshot, {
      catalog: single,
      generatedAt: GENERATED_AT,
      rotation: 1,
    });
    const firstCalm = first.segments.filter((s) => s.bucket === "self:low:low");
    const secondCalm = second.segments.filter(
      (s) => s.bucket === "self:low:low",
    );
    expect(firstCalm.length).toBeGreaterThanOrEqual(1);
    for (const [index, segment] of secondCalm.entries()) {
      expect(segment.trackId).toBe("only-track");
      expect(segment.clipStartSec).not.toBe(firstCalm[index]!.clipStartSec);
    }
  });
});
