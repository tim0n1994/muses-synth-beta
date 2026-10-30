import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ContextEventRecord } from "../../context/model.js";
import { deriveJourneySnapshots, planReplay } from "../index.js";

/**
 * Replay v0 planner (V8): the Journey segmented by state, each segment bound
 * to a 60-120s clip, crossfades between segments, the whole day compressed
 * into 30-45 minutes. Output is a playlist + timestamps only — no audio is
 * rendered or exported server-side (asserted by shape: segments reference
 * track ids and offsets, never files).
 *
 * Frozen planner constants:
 *   - total replay duration within [1800, 2700] seconds (journeys >= 45 min)
 *   - segment clip duration within [60, 120] seconds
 *   - crossfade 4s between same-bucket neighbors, 8s across a bucket change
 *     or a bug_valley boundary, capped at 40% of the shorter neighbor,
 *     0 after the last segment
 *   - no-gap scheduling: replayStart[i+1] = replayStart[i] + duration[i]
 *     - crossfade[i]
 *   - journey coverage is contiguous: journeyStart[0] = 0,
 *     journeyEnd[i] = journeyStart[i+1], journeyEnd[last] ~ durationSec
 */

const BASE = new Date("2026-10-20T09:00:00.000Z");

let sequence = 0;
const ev = (id: string, offsetSec: number): ContextEventRecord => {
  const at = new Date(BASE.getTime() + offsetSec * 1_000);
  sequence += 1;
  return {
    specversion: "1.0",
    id,
    source: "urn:test:replay",
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

const CATALOG: Readonly<Record<string, readonly string[]>> = {
  "self:low:low": ["trk-calm-1", "trk-calm-2"],
  "self:low:medium": ["trk-calm-3", "trk-calm-4"],
  "self:low:high": ["trk-calm-5", "trk-calm-6"],
  "self:medium:low": ["trk-focus-1", "trk-focus-2"],
  "self:medium:medium": ["trk-focus-3", "trk-focus-4"],
  "self:medium:high": ["trk-focus-5", "trk-focus-6"],
  "self:high:low": ["trk-flow-1", "trk-flow-2"],
  "self:high:medium": ["trk-flow-3", "trk-flow-4"],
  "self:high:high": ["trk-flow-5", "trk-flow-6"],
};

const GENERATED_AT = "2026-10-20T21:00:00.000Z";

/** A full working day: slow start, two-hour flow plateau, dip, recovery. */
const workingDay = (): ContextEventRecord[] => {
  const events: ContextEventRecord[] = [];
  // 09:00-09:30 slow warmup: one event every 25s.
  for (let t = 0; t < 1_800; t += 25) {
    events.push(ev(`warm-${t}`, t));
  }
  // 09:30-11:30 flow plateau: one event every 4s.
  for (let t = 1_800; t < 9_000; t += 4) {
    events.push(ev(`flow-${t}`, t));
  }
  // 11:30-12:10 dip while debugging: bursty, medium cadence.
  for (let t = 9_000; t < 11_400; t += 22) {
    events.push(ev(`dip-${t}`, t));
  }
  // 12:10-12:40 rest gap (no events), then a medium afternoon.
  for (let t = 13_200; t < 15_000; t += 12) {
    events.push(ev(`pm-${t}`, t));
  }
  return events;
};

describe("replay planner (V8 playlist + timestamps)", () => {
  it("compresses a full working day into 30-45 minutes", () => {
    const snapshots = deriveJourneySnapshots(workingDay(), {
      userId: "user-a",
      now: BASE,
    });
    const morning = snapshots[0];
    expect(morning).toBeDefined();
    const replay = planReplay(morning!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    expect(replay.totalDurationSec).toBeGreaterThanOrEqual(1_800);
    expect(replay.totalDurationSec).toBeLessThanOrEqual(2_700);
  });

  it("keeps every clip between 60 and 120 seconds", () => {
    const snapshots = deriveJourneySnapshots(workingDay(), {
      userId: "user-a",
      now: BASE,
    });
    const replay = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    expect(replay.segments.length).toBeGreaterThan(5);
    for (const segment of replay.segments) {
      expect(segment.durationSec).toBeGreaterThanOrEqual(60);
      expect(segment.durationSec).toBeLessThanOrEqual(120);
    }
  });

  it("crossfades only between neighbors, capped by the shorter clip", () => {
    const snapshots = deriveJourneySnapshots(workingDay(), {
      userId: "user-a",
      now: BASE,
    });
    const replay = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    for (const [index, segment] of replay.segments.entries()) {
      const next = replay.segments[index + 1];
      if (next === undefined) {
        expect(segment.crossfadeSec).toBe(0);
        continue;
      }
      expect(segment.crossfadeSec).toBeGreaterThan(0);
      expect(segment.crossfadeSec).toBeLessThanOrEqual(
        0.4 * Math.min(segment.durationSec, next.durationSec) + 1e-9,
      );
    }
  });

  it("schedules with no gaps and covers the journey contiguously", () => {
    const snapshots = deriveJourneySnapshots(workingDay(), {
      userId: "user-a",
      now: BASE,
    });
    const replay = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    const [first] = replay.segments;
    expect(first?.journeyStartSec).toBe(0);
    expect(first?.replayStartSec).toBe(0);
    for (const [index, segment] of replay.segments.entries()) {
      const next = replay.segments[index + 1];
      if (next === undefined) {
        expect(segment.replayStartSec + segment.durationSec).toBeCloseTo(
          replay.totalDurationSec,
          6,
        );
        expect(segment.journeyEndSec).toBeCloseTo(snapshots[0]!.durationSec, 0);
        continue;
      }
      expect(next.replayStartSec).toBeCloseTo(
        segment.replayStartSec + segment.durationSec - segment.crossfadeSec,
        6,
      );
      expect(next.journeyStartSec).toBeCloseTo(segment.journeyEndSec, 6);
    }
  });

  it("binds every segment to one of the nine self-track buckets", () => {
    const snapshots = deriveJourneySnapshots(workingDay(), {
      userId: "user-a",
      now: BASE,
    });
    const replay = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    const buckets = new Set(Object.keys(CATALOG));
    for (const segment of replay.segments) {
      expect(buckets.has(segment.bucket)).toBe(true);
      expect(CATALOG[segment.bucket]).toContain(segment.trackId);
      // Playlist + timestamps only: no file paths, no rendered audio.
      expect(segment.trackId).not.toMatch(/\.(|opus|mp3|ogg|wav)$/);
    }
  });

  it("is deterministic for identical inputs", () => {
    const events = workingDay();
    const snapshots = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    const first = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    const second = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    expect(second).toEqual(first);
    expect(first.replayId).toMatch(/^rpl_[0-9a-f]{24}$/);
  });

  it("uses longer crossfades around bug valleys (mood modulation, V2)", () => {
    // Build a snapshot whose only nodes are two bug_valley markers inside a
    // mixed-bucket journey, by deriving from events with failing tests.
    const events: ContextEventRecord[] = [];
    for (let t = 0; t < 10_800; t += 6) {
      events.push(ev(`mix-${t}`, t));
    }
    const failAt = (offsetSec: number): ContextEventRecord => {
      const at = new Date(BASE.getTime() + offsetSec * 1_000);
      return {
        ...ev(`fail-${offsetSec}`, offsetSec),
        type: "muses.test.run.completed",
        occurredAt: at.toISOString(),
        receivedAt: at.toISOString(),
        data: { status: "failed", total: 10, failed: 3 },
      };
    };
    events.push(failAt(4_000));
    const snapshots = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    const replay = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    const bugValleys = (snapshots[0]?.nodes ?? [])
      .filter((n) => n.type === "bug_valley")
      .map((n) => n.offsetSec);
    expect(bugValleys.length).toBeGreaterThan(0);
    // Find the segment boundary nearest a bug valley; that crossfade must be
    // the "soft" 8s one (>= 6), not the plain 4s one.
    let sawSoft = false;
    for (const valley of bugValleys) {
      for (const [index, segment] of replay.segments.entries()) {
        const next = replay.segments[index + 1];
        if (next === undefined) {
          continue;
        }
        const boundary = next.journeyStartSec;
        if (Math.abs(boundary - valley) <= 60) {
          expect(segment.crossfadeSec).toBeGreaterThanOrEqual(6);
          sawSoft = true;
        }
      }
    }
    expect(sawSoft).toBe(true);
  });

  it("degrades gracefully for a short session", () => {
    const events = [ev("s1", 0), ev("s2", 60), ev("s3", 120), ev("s4", 180)];
    const snapshots = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    expect(snapshots).toHaveLength(1);
    const replay = planReplay(snapshots[0]!, {
      catalog: CATALOG,
      generatedAt: GENERATED_AT,
    });
    expect(replay.segments.length).toBeGreaterThanOrEqual(1);
    expect(replay.totalDurationSec).toBeLessThanOrEqual(1_800);
    for (const segment of replay.segments) {
      expect(segment.durationSec).toBeGreaterThan(0);
    }
  });
});
