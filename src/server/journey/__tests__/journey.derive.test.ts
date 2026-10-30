import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ContextEventRecord } from "../../context/model.js";
import { deriveJourneySnapshots } from "../index.js";

/**
 * Journey derivation (V7): per-session derived timeline over the v0.6 event
 * store — signal sequence + key nodes (flow entered / bug valley / tests
 * green / rest started). Frozen derivation constants (implementation must
 * honor these or change the tests deliberately):
 *   - session split: >1800s event gap, or muses.session.activity idle or
 *     inactive marker; sessions need >= 3 events to exist at all
 *   - signal window 30s, coarsened x2 while the session exceeds 200 samples
 *     (keeps a snapshot in a few KB)
 *   - pace: <=2 events/window low, 3-6 medium, >=7 high
 *   - intensity (burstiness): windows with <5 events are always low;
 *     otherwise (max-min)/(max+min) over 10s sub-buckets, <0.3 low,
 *     0.3-0.6 medium, >0.6 high
 *   - flow_entered: first offset with 3 consecutive windows of >=5 events
 *   - rest_started: at the gap (evidence = last event before it) or at the
 *     idle/inactive marker event
 *   - bug_valley at each failed test run; tests_green at the first passed
 *     run after a bug_valley with no green in between
 */

const BASE = new Date("2026-10-20T09:00:00.000Z");

let sequence = 0;
const ev = (
  id: string,
  offsetSec: number,
  type = "muses.editor.activity",
  data?: Record<string, string | number | boolean | null>,
): ContextEventRecord => {
  const at = new Date(BASE.getTime() + offsetSec * 1_000);
  sequence += 1;
  return {
    specversion: "1.0",
    id,
    source: "urn:test:journey",
    type,
    subject: "workspace:test",
    extensions: {},
    contentHash: createHash("sha256").update(id).digest("hex"),
    occurredAt: at.toISOString(),
    receivedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 7 * 86_400_000).toISOString(),
    outOfOrder: false,
    serverSequence: sequence,
    ...(data === undefined ? {} : { data }),
  };
};

/** Steady editing cadence: one event every `stepSec` over `spanSec`. */
const steady = (prefix: string, stepSec: number, spanSec: number, from = 0) => {
  const events: ContextEventRecord[] = [];
  for (let t = from; t < from + spanSec; t += stepSec) {
    events.push(
      ev(`${prefix}-${t}`, t, "muses.editor.activity", { action: "edit" }),
    );
  }
  return events;
};

describe("journey derivation (V7 derived timeline)", () => {
  it("splits sessions on a long gap and marks rest_started", () => {
    const events = [
      ...steady("m1", 60, 1_800),
      ...steady("m2", 60, 1_800, 1_800 + 2_700), // 45-minute gap before this block
    ];
    const snapshots = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    expect(snapshots.length).toBe(2);
    const rest = snapshots[0]?.nodes.find((n) => n.type === "rest_started");
    expect(rest).toBeDefined();
    expect(rest?.offsetSec).toBeGreaterThanOrEqual(1_740);
    expect(rest?.offsetSec).toBeLessThanOrEqual(1_800);
    expect(rest?.evidenceEventIds.length).toBeGreaterThan(0);
    for (const id of rest?.evidenceEventIds ?? []) {
      expect(id.startsWith("m1-")).toBe(true);
    }
  });

  it("ends a session at an explicit idle marker", () => {
    const events = [
      ...steady("idle", 60, 600),
      ev("idle-marker", 660, "muses.session.activity", { status: "idle" }),
      ...steady("idle2", 60, 600, 1_200),
    ];
    const snapshots = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    expect(snapshots.length).toBe(2);
    const rest = snapshots[0]?.nodes.find((n) => n.type === "rest_started");
    expect(rest?.offsetSec).toBe(660);
    expect(rest?.evidenceEventIds).toEqual(["idle-marker"]);
  });

  it("derives flow_entered from sustained editing but not from sparse work", () => {
    const dense = deriveJourneySnapshots(steady("dense", 4, 1_200), {
      userId: "user-a",
      now: BASE,
    });
    const flow = dense[0]?.nodes.find((n) => n.type === "flow_entered");
    expect(flow).toBeDefined();
    // 3 consecutive 30s windows of >=5 events: earliest possible is 90s in.
    expect(flow?.offsetSec).toBeGreaterThanOrEqual(60);
    expect(flow?.offsetSec).toBeLessThanOrEqual(150);
    expect(flow?.evidenceEventIds.length).toBeGreaterThan(0);

    const sparse = [ev("s1", 0), ev("s2", 900), ev("s3", 1_740)];
    const sparseSnapshots = deriveJourneySnapshots(sparse, {
      userId: "user-a",
      now: BASE,
    });
    expect(
      sparseSnapshots[0]?.nodes.find((n) => n.type === "flow_entered"),
    ).toBeUndefined();
  });

  it("derives bug_valley and tests_green from test run events", () => {
    const events = [
      ...steady("bug", 30, 900),
      ev("t-fail", 600, "muses.test.run.completed", {
        status: "failed",
        total: 12,
        failed: 4,
      }),
      ...steady("bug2", 30, 300, 630),
      ev("t-pass", 900, "muses.test.run.completed", {
        status: "passed",
        total: 12,
        failed: 0,
      }),
    ];
    const snapshots = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    const nodes = snapshots[0]?.nodes ?? [];
    const bug = nodes.find((n) => n.type === "bug_valley");
    expect(bug?.offsetSec).toBe(600);
    expect(bug?.evidenceEventIds).toEqual(["t-fail"]);
    const green = nodes.find((n) => n.type === "tests_green");
    expect(green?.offsetSec).toBe(900);
    expect(green?.evidenceEventIds).toEqual(["t-pass"]);
  });

  it("does not mark tests_green without a preceding failure", () => {
    const events = [
      ...steady("ok", 30, 900),
      ev("t-pass-only", 600, "muses.test.run.completed", {
        status: "passed",
        total: 5,
        failed: 0,
      }),
    ];
    const snapshots = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    expect(
      snapshots[0]?.nodes.find((n) => n.type === "tests_green"),
    ).toBeUndefined();
  });

  it("classifies pace and intensity from the event cadence", () => {
    // Steady 4s cadence: 30s windows hold 7-8 events (pace high), 10s
    // sub-buckets are uniform (burstiness ~0 -> intensity low).
    const steadySnapshots = deriveJourneySnapshots(steady("st", 4, 600), {
      userId: "user-a",
      now: BASE,
    });
    const steadySample = steadySnapshots[0]?.samples.at(-1);
    expect(steadySample?.pace).toBe("high");
    expect(steadySample?.intensity).toBe("low");

    // 5 events bunched in the first 10s of each window, silence after:
    // count 5 (pace medium), sub-buckets 5/0/0 (burstiness 1 -> high).
    const bursty: ContextEventRecord[] = [];
    for (let w = 0; w < 20; w += 1) {
      for (let k = 0; k < 5; k += 1) {
        bursty.push(ev(`burst-${w}-${k}`, w * 30 + k * 2));
      }
    }
    const burstySnapshots = deriveJourneySnapshots(bursty, {
      userId: "user-a",
      now: BASE,
    });
    const burstySample = burstySnapshots[0]?.samples.at(-1);
    expect(burstySample?.pace).toBe("medium");
    expect(burstySample?.intensity).toBe("high");

    // One event every 45s: pace low.
    const slow: ContextEventRecord[] = [];
    for (let i = 0; i < 8; i += 1) {
      slow.push(ev(`slow-${i}`, i * 45));
    }
    const slowSnapshots = deriveJourneySnapshots(slow, {
      userId: "user-a",
      now: BASE,
    });
    expect(slowSnapshots[0]?.samples.at(-1)?.pace).toBe("low");
  });

  it("coarsens samples and keeps a session snapshot in a few KB", () => {
    // Two hours at a 20s cadence = 360 events, ~240 raw 30s windows.
    const snapshots = deriveJourneySnapshots(steady("long", 20, 7_200), {
      userId: "user-a",
      now: BASE,
    });
    const snapshot = snapshots[0];
    expect(snapshot).toBeDefined();
    expect(snapshot?.samples.length).toBeLessThanOrEqual(240);
    expect(snapshot?.samples.length).toBeGreaterThan(60);
    const serialized = JSON.stringify(snapshot);
    expect(serialized.length).toBeLessThan(16_384);
    expect(snapshot?.eventCount).toBe(360);
    expect(snapshot?.durationSec).toBeGreaterThanOrEqual(7_160);
    expect(snapshot?.retentionDays).toBe(90);
  });

  it("ignores clusters with fewer than three events", () => {
    const snapshots = deriveJourneySnapshots([ev("x1", 0), ev("x2", 30)], {
      userId: "user-a",
      now: BASE,
    });
    expect(snapshots).toHaveLength(0);
  });

  it("is deterministic: identical events derive identical ids", () => {
    const events = steady("det", 30, 900);
    const first = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    const second = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    expect(second).toEqual(first);
    expect(first[0]?.journeyId).toMatch(/^jrn_[0-9a-f]{24}$/);
    for (const node of first[0]?.nodes ?? []) {
      expect(node.nodeId).toMatch(/^node_[0-9a-f]{12}$/);
    }
  });

  it("scopes journey ids per user id", () => {
    const events = steady("scoped", 30, 900);
    const alice = deriveJourneySnapshots(events, {
      userId: "user-a",
      now: BASE,
    });
    const bob = deriveJourneySnapshots(events, {
      userId: "user-b",
      now: BASE,
    });
    expect(alice[0]?.journeyId).not.toBe(bob[0]?.journeyId);
  });
});
