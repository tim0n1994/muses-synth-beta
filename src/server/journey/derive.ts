import { createHash } from "node:crypto";

import type { ContextEventRecord } from "../context/model.js";
import {
  selfTrackBucket,
  type IntensityLevel,
  type JourneyNode,
  type JourneySnapshot,
  type PaceLevel,
} from "./model.js";

/**
 * Journey derivation (V7: derived results only — the raw events stay in the
 * v0.6 store). Deterministic and pure: identical events derive identical
 * snapshots, so re-derivation is an idempotent upsert keyed by journeyId.
 *
 * Frozen derivation contract (mirrored in __tests__/journey.derive.test.ts):
 *   - session split at a >1800s event gap or a muses.session.activity
 *     idle/inactive marker; a session needs >= 3 events to exist
 *   - signal window 30s, coarsened x2 while the session exceeds 200 samples
 *   - pace: <=2 events/window low, 3-6 medium, >=7 high
 *   - intensity: <5 events/window low; otherwise burstiness
 *     (max-min)/(max+min) over 10s sub-buckets — <0.3 low, <=0.6 medium,
 *     else high
 *   - flow_entered at the third consecutive >=5-event window
 *   - rest_started at the last event before a gap, or at the idle marker
 *   - bug_valley at each failed test run; tests_green at the first passed
 *     run after an unanswered bug_valley
 */

export const SESSION_GAP_SEC = 1_800;
export const MIN_SESSION_EVENTS = 3;
export const BASE_SIGNAL_WINDOW_SEC = 30;
export const MAX_SAMPLES = 200;
export const MAX_NODES = 200;
export const DEFAULT_RETENTION_DAYS = 90;
const FLOW_WINDOW_THRESHOLD = 5;
const FLOW_CONSECUTIVE_WINDOWS = 3;
const SUB_BUCKET_SEC = 10;

export interface DeriveJourneyOptions {
  readonly userId: string | null;
  readonly now: Date;
  readonly retentionDays?: number;
}

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

const occurredAtMs = (event: ContextEventRecord): number =>
  Date.parse(event.occurredAt);

const statusOf = (event: ContextEventRecord): string | undefined => {
  if (event.data === undefined || typeof event.data !== "object") {
    return undefined;
  }
  const status = (event.data as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
};

const isRestMarker = (event: ContextEventRecord): boolean =>
  event.type === "muses.session.activity" &&
  (statusOf(event) === "idle" || statusOf(event) === "inactive");

const isFailedTest = (event: ContextEventRecord): boolean =>
  event.type === "muses.test.run.completed" && statusOf(event) === "failed";

const isPassedTest = (event: ContextEventRecord): boolean =>
  event.type === "muses.test.run.completed" && statusOf(event) === "passed";

const classifyPace = (count: number): PaceLevel => {
  if (count <= 2) {
    return "low";
  }
  return count <= 6 ? "medium" : "high";
};

const classifyIntensity = (
  offsetsInWindow: readonly number[],
  windowSec: number,
): IntensityLevel => {
  if (offsetsInWindow.length < FLOW_WINDOW_THRESHOLD) {
    return "low";
  }
  const buckets = Math.max(1, Math.floor(windowSec / SUB_BUCKET_SEC));
  const counts = new Array<number>(buckets).fill(0);
  for (const offset of offsetsInWindow) {
    const index = Math.min(buckets - 1, Math.floor(offset / SUB_BUCKET_SEC));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const burst = (max - min) / (max + min);
  return burst < 0.3 ? "low" : burst <= 0.6 ? "medium" : "high";
};

interface SignalWindow {
  readonly offsetSec: number;
  readonly pace: PaceLevel;
  readonly intensity: IntensityLevel;
  readonly eventCount: number;
  readonly eventIds: readonly string[];
}

const buildWindows = (
  sessionEvents: readonly ContextEventRecord[],
  windowSec: number,
): readonly SignalWindow[] => {
  const startMs = occurredAtMs(sessionEvents[0]!);
  const windows = new Map<number, { offsets: number[]; ids: string[] }>();
  for (const event of sessionEvents) {
    const offsetSec = (occurredAtMs(event) - startMs) / 1_000;
    const index = Math.floor(offsetSec / windowSec);
    const bucket = windows.get(index) ?? { offsets: [], ids: [] };
    bucket.offsets.push(offsetSec - index * windowSec);
    bucket.ids.push(event.id);
    windows.set(index, bucket);
  }
  return [...windows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, bucket]) => ({
      offsetSec: index * windowSec,
      pace: classifyPace(bucket.ids.length),
      intensity: classifyIntensity(bucket.offsets, windowSec),
      eventCount: bucket.ids.length,
      eventIds: bucket.ids,
    }));
};

const nodeId = (type: string, evidenceIds: readonly string[]): string => {
  const raw = type + "|" + evidenceIds.join(",");
  return "node_" + sha256Hex(raw).slice(0, 12);
};

interface Session {
  readonly events: ContextEventRecord[];
  /** True when the session ended because the next event was >1800s away. */
  readonly endedByGap: boolean;
}

const sessionize = (
  events: readonly ContextEventRecord[],
): readonly Session[] => {
  const sorted = [...events].sort((a, b) => {
    const delta = occurredAtMs(a) - occurredAtMs(b);
    return delta !== 0 ? delta : a.serverSequence - b.serverSequence;
  });

  const sessions: Session[] = [];
  let current: ContextEventRecord[] = [];
  const close = (endedByGap: boolean): void => {
    if (current.length > 0) {
      sessions.push({ events: current, endedByGap });
      current = [];
    }
  };
  for (const event of sorted) {
    if (current.length > 0) {
      const last = current[current.length - 1]!;
      const gapSec = (occurredAtMs(event) - occurredAtMs(last)) / 1_000;
      if (gapSec > SESSION_GAP_SEC) {
        close(true);
      }
    }
    current.push(event);
    if (isRestMarker(event)) {
      // The marker belongs to the session it closes.
      close(false);
    }
  }
  close(false);
  return sessions;
};

const deriveNodes = (session: Session): readonly JourneyNode[] => {
  const events = session.events;
  const startMs = occurredAtMs(events[0]!);
  const offsetOf = (event: ContextEventRecord): number =>
    (occurredAtMs(event) - startMs) / 1_000;
  const windows = buildSignalWindows(events);
  const nodes: JourneyNode[] = [];

  // flow_entered: first run of three consecutive >=5-event windows; the
  // node sits at the confirming window (sustained evidence exists from
  // there on), evidence = the first event of each qualifying window.
  for (
    let index = 0;
    index + FLOW_CONSECUTIVE_WINDOWS <= windows.length;
    index += 1
  ) {
    const run = windows.slice(index, index + FLOW_CONSECUTIVE_WINDOWS);
    if (run.every((window) => window.eventCount >= FLOW_WINDOW_THRESHOLD)) {
      const confirmation = run[run.length - 1]!;
      nodes.push({
        nodeId: nodeId(
          "flow_entered",
          run.map((window) => window.eventIds[0]!),
        ),
        type: "flow_entered",
        offsetSec: confirmation.offsetSec,
        evidenceEventIds: run.map((window) => window.eventIds[0]!),
      });
      break;
    }
  }

  // Test outcome nodes walk the session in order; a rest marker closes it.
  let valleyUnanswered = false;
  for (const event of events) {
    if (isFailedTest(event)) {
      nodes.push({
        nodeId: nodeId("bug_valley", [event.id]),
        type: "bug_valley",
        offsetSec: offsetOf(event),
        evidenceEventIds: [event.id],
      });
      valleyUnanswered = true;
    } else if (isPassedTest(event) && valleyUnanswered) {
      nodes.push({
        nodeId: nodeId("tests_green", [event.id]),
        type: "tests_green",
        offsetSec: offsetOf(event),
        evidenceEventIds: [event.id],
      });
      valleyUnanswered = false;
    }
    if (isRestMarker(event)) {
      nodes.push({
        nodeId: nodeId("rest_started", [event.id]),
        type: "rest_started",
        offsetSec: offsetOf(event),
        evidenceEventIds: [event.id],
      });
    }
  }

  // rest_started at a session-ending gap: the node sits on the session that
  // ended, evidenced by its last event.
  if (session.endedByGap) {
    const last = events[events.length - 1]!;
    nodes.push({
      nodeId: nodeId("rest_started", [last.id]),
      type: "rest_started",
      offsetSec: offsetOf(last),
      evidenceEventIds: [last.id],
    });
  }

  const unique = new Map<string, JourneyNode>();
  for (const node of nodes) {
    unique.set(node.nodeId, node);
  }
  return [...unique.values()]
    .sort((a, b) => a.offsetSec - b.offsetSec)
    .slice(0, MAX_NODES);
};

const buildSignalWindows = (
  events: readonly ContextEventRecord[],
): readonly SignalWindow[] => {
  let windowSec = BASE_SIGNAL_WINDOW_SEC;
  let windows = buildWindows(events, windowSec);
  while (windows.length > MAX_SAMPLES) {
    windowSec *= 2;
    windows = buildWindows(events, windowSec);
  }
  return windows;
};

export const deriveJourneySnapshots = (
  events: readonly ContextEventRecord[],
  options: DeriveJourneyOptions,
): readonly JourneySnapshot[] => {
  const snapshots: JourneySnapshot[] = [];
  for (const session of sessionize(events)) {
    if (session.events.length < MIN_SESSION_EVENTS) {
      continue;
    }
    const startMs = occurredAtMs(session.events[0]!);
    const endMs = occurredAtMs(session.events[session.events.length - 1]!);
    const durationSec = Math.round((endMs - startMs) / 1_000);
    const sessionStartedAt = new Date(startMs).toISOString();
    // Stable across re-derivations: the same session start derives the same
    // journey id, making derive+upsert idempotent.
    const owner = options.userId === null ? "anonymous" : options.userId;
    const identity = owner + "|" + sessionStartedAt;
    const journeyId = `jrn_${sha256Hex(identity).slice(0, 24)}`;
    const windows = buildSignalWindows(session.events);

    snapshots.push({
      journeyId,
      sessionStartedAt,
      sessionEndedAt: new Date(endMs).toISOString(),
      durationSec,
      eventCount: session.events.length,
      derivedAt: options.now.toISOString(),
      retentionDays: options.retentionDays ?? DEFAULT_RETENTION_DAYS,
      samples: windows.map((window) => ({
        offsetSec: window.offsetSec,
        pace: window.pace,
        intensity: window.intensity,
        eventCount: window.eventCount,
      })),
      nodes: deriveNodes(session),
    });
  }
  return snapshots;
};

export { selfTrackBucket };
