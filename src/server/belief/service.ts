import type { ContextClock, ContextEventRecord } from "../context/model.js";
import { SYSTEM_CLOCK } from "../context/model.js";
import { beliefStorageFailure, invalidBeliefRequest } from "./errors.js";
import type {
  BeliefEventReader,
  BeliefProjectionRequest,
  BeliefReplayTruncation,
  BeliefSnapshot,
  BeliefSnapshotStore,
} from "./model.js";
import { projectBelief } from "./projector.js";
import { BeliefChainMemo } from "./chain-memo.js";

export interface BeliefServiceOptions {
  readonly clock?: ContextClock;
  readonly defaultMaxEvents?: number;
  readonly maximumMaxEvents?: number;
  readonly snapshotStore?: BeliefSnapshotStore;
  /**
   * Observes projections whose stream exceeded `maxEvents` and were replayed
   * from their most recent window instead. The service keeps no user notion,
   * so the owner of the stream (the composition root) attributes and logs it.
   */
  readonly onReplayTruncated?: (truncation: BeliefReplayTruncation) => void;
}

const DEFAULT_MAX_EVENTS = 2_000;
const MAXIMUM_MAX_EVENTS = 10_000;

export class BeliefService {
  private readonly reader: BeliefEventReader;
  private readonly clock: ContextClock;
  private readonly defaultMaxEvents: number;
  private readonly maximumMaxEvents: number;
  private readonly snapshotStore: BeliefSnapshotStore | undefined;
  private readonly onReplayTruncated:
    ((truncation: BeliefReplayTruncation) => void) | undefined;
  /**
   * One stream per service (the composition root builds a service per user
   * shard), so one hysteresis-chain memo per service: a projection reuses
   * the checkpoint evaluations of the previous one wherever the window did
   * not move (R2 CPU work; see chain-memo.ts). Snapshots are identical with
   * and without it.
   */
  private readonly chainMemo = new BeliefChainMemo();

  public constructor(
    reader: BeliefEventReader,
    options: BeliefServiceOptions = {},
  ) {
    this.reader = reader;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.defaultMaxEvents = options.defaultMaxEvents ?? DEFAULT_MAX_EVENTS;
    this.maximumMaxEvents = options.maximumMaxEvents ?? MAXIMUM_MAX_EVENTS;
    this.snapshotStore = options.snapshotStore;
    this.onReplayTruncated = options.onReplayTruncated;
  }

  public async current(): Promise<BeliefSnapshot> {
    return this.project({ persist: true });
  }

  public async replay(
    request: BeliefProjectionRequest = {},
  ): Promise<BeliefSnapshot> {
    return this.project({ ...request, persist: false });
  }

  private async project(
    request: BeliefProjectionRequest,
  ): Promise<BeliefSnapshot> {
    const asOf = normalizeAsOf(request.asOf, this.clock.now());
    const maxEvents = request.maxEvents ?? this.defaultMaxEvents;
    if (
      !Number.isSafeInteger(maxEvents) ||
      maxEvents <= 0 ||
      maxEvents > this.maximumMaxEvents
    ) {
      throw invalidBeliefRequest(
        `maxEvents must be an integer from 1 to ${this.maximumMaxEvents}.`,
      );
    }

    let window;
    try {
      window = await this.reader.readForBelief({
        asOf,
        limit: maxEvents,
        // Internal hot-path lever (R2 memory work): only the composition
        // root's cached projection opts in; the public replay contract
        // leaves it unset and always reads the full window.
        ...(request.windowCache === true ? { useWindowCache: true } : {}),
      });
    } catch (error: unknown) {
      throw beliefStorageFailure("readForBelief", error);
    }

    // A stream larger than the bound is replayed from its most recent
    // `maxEvents` events rather than refused: an account's history growing
    // past the bound must degrade the projection, not take the dashboard
    // down with it (v0.6 production regression, 2026-10-21). The reader
    // already windows; trimming here as well keeps the invariant even for a
    // reader that hands back more than it was asked for.
    const events =
      window.events.length > maxEvents
        ? mostRecentBySequence(window.events, maxEvents)
        : window.events;
    const total = Math.max(window.total, window.events.length);
    if (total > events.length) {
      this.onReplayTruncated?.({
        asOf,
        total,
        window: events.length,
        maxEvents,
      });
    }

    const snapshot = projectBelief(events, asOf, {
      maxEvents,
      chainMemo: this.chainMemo,
    });
    if ((request.persist ?? false) && this.snapshotStore !== undefined) {
      try {
        await this.snapshotStore.saveBeliefSnapshot(snapshot);
      } catch (error: unknown) {
        throw beliefStorageFailure("saveBeliefSnapshot", error);
      }
    }
    return snapshot;
  }
}

const mostRecentBySequence = (
  events: readonly ContextEventRecord[],
  count: number,
): readonly ContextEventRecord[] =>
  [...events]
    .sort((left, right) => right.serverSequence - left.serverSequence)
    .slice(0, count);

const normalizeAsOf = (input: string | undefined, now: Date): string => {
  if (input === undefined) {
    return now.toISOString();
  }
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds)) {
    throw invalidBeliefRequest("asOf must be an RFC3339 timestamp.");
  }
  if (milliseconds > now.getTime() + 5 * 60 * 1_000) {
    throw invalidBeliefRequest("asOf is too far in the future.");
  }
  return new Date(milliseconds).toISOString();
};
