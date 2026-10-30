import type { ContextClock, ContextEventStore } from "../context/model.js";
import { SYSTEM_CLOCK } from "../context/model.js";
import type { SqliteDatabasePort } from "../context/sqlite-context-event-store.js";
import type {
  PulseProjectionRequest,
  PulseSnapshot,
  PulseSnapshotStore,
} from "./model.js";
import { createSqlitePulseEventReader } from "./event-reader.js";
import { PulseService } from "./service.js";

/**
 * Identifies one user's pulse shard. null is the legacy global stream,
 * mirroring UserKey in foundation/per-user-runtimes.ts.
 */
export type PulseUserKey = string | null;

/** Pulse surface a request is allowed to see. */
export interface ScopedPulseView {
  current(): Promise<PulseSnapshot>;
  replay(request?: PulseProjectionRequest): Promise<PulseSnapshot>;
}

export interface PulseRuntimeStats {
  /** Full re-projections performed (cache misses plus invalidations). */
  readonly replays: number;
  /** Projections served from the per-user cache without a replay. */
  readonly cacheHits: number;
  /** Replays forced by the 60s staleness bound with an unchanged sequence. */
  readonly staleReplays: number;
}

export interface PulseRuntimesOptions {
  /** Raw database handle backing the recent-window reader. */
  readonly database: SqliteDatabasePort;
  /** Event store port; used only for the MAX(server_sequence) probe. */
  readonly store: ContextEventStore;
  /** Replay bound per projection (the PulseService default is 2000). */
  readonly maxEvents?: number;
  /** Upper bound on the age of a served cached snapshot. Default 60s. */
  readonly maxCacheAgeMs?: number;
  /** Clock injected for deterministic tests; defaults to the system clock. */
  readonly clock?: ContextClock;
  /**
   * Optional per-user snapshot persistence (pulse_readings). Evaluated
   * once per shard; return undefined to skip persistence for that user.
   */
  readonly snapshotStoreFor?: (
    userId: PulseUserKey,
  ) => PulseSnapshotStore | undefined;
}

interface CachedPulse {
  readonly latestSeq: number;
  readonly snapshot: PulseSnapshot;
}

interface PulseShard {
  readonly service: PulseService;
  readonly view: { pulse: ScopedPulseView };
  cachedPulse?: CachedPulse;
}

const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_MAX_CACHE_AGE_MS = 60_000;

/**
 * Per-user pulse registry with the v0.6 hot-path cache pattern
 * (foundation/per-user-runtimes.ts): one shard per user holding a
 * PulseService over a reader scoped to that user's stream plus the last
 * snapshot. current() probes MAX(server_sequence) via the store port —
 * unchanged sequence + fresh cache serves the cached snapshot; otherwise
 * exactly one replay. The 60s staleness bound keeps idle users' pulses
 * honest (the window slides even without new events). invalidate() drops
 * the cached projection so the next read after an ingest re-projects.
 */
export class PulseRuntimes {
  private readonly database: SqliteDatabasePort;
  private readonly store: ContextEventStore;
  private readonly maxEvents: number;
  private readonly maxCacheAgeMs: number;
  private readonly clock: ContextClock;
  private readonly snapshotStoreFor:
    ((userId: PulseUserKey) => PulseSnapshotStore | undefined) | undefined;
  private readonly shards = new Map<PulseUserKey, PulseShard>();
  private readonly statsImpl = {
    replays: 0,
    cacheHits: 0,
    staleReplays: 0,
  };

  public constructor(options: PulseRuntimesOptions) {
    this.database = options.database;
    this.store = options.store;
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.maxCacheAgeMs = options.maxCacheAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.snapshotStoreFor = options.snapshotStoreFor;
    if (
      !Number.isSafeInteger(this.maxEvents) ||
      this.maxEvents <= 0 ||
      !Number.isSafeInteger(this.maxCacheAgeMs) ||
      this.maxCacheAgeMs < 0
    ) {
      throw new Error("PulseRuntimes options are invalid.");
    }
  }

  public get stats(): PulseRuntimeStats {
    return { ...this.statsImpl };
  }

  public get cachedUsers(): number {
    return this.shards.size;
  }

  public getFor(userId: PulseUserKey): { pulse: ScopedPulseView } {
    return this.ensureShard(userId).view;
  }

  /** Drops the user's cached projection; the next read must replay. */
  public invalidate(userId: PulseUserKey): void {
    const shard = this.shards.get(userId);
    if (shard !== undefined) {
      delete shard.cachedPulse;
    }
  }

  private ensureShard(userId: PulseUserKey): PulseShard {
    const existing = this.shards.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const snapshotStore = this.snapshotStoreFor?.(userId);
    const service = new PulseService(
      createSqlitePulseEventReader(this.database, userId),
      {
        defaultMaxEvents: this.maxEvents,
        clock: this.clock,
        ...(snapshotStore === undefined
          ? {}
          : { snapshotStore: snapshotStore }),
      },
    );
    const shard: PulseShard = {
      service,
      view: {
        pulse: {
          current: () => this.currentFor(userId),
          replay: (request?: PulseProjectionRequest) => service.replay(request),
        },
      },
    };
    this.shards.set(userId, shard);
    return shard;
  }

  private async currentFor(userId: PulseUserKey): Promise<PulseSnapshot> {
    const shard = this.ensureShard(userId);

    const latestSeq = await this.store.getMaxServerSequence(userId);
    const cached = shard.cachedPulse;
    if (
      cached !== undefined &&
      cached.latestSeq === latestSeq &&
      this.cacheAgeMs(cached.snapshot) <= this.maxCacheAgeMs
    ) {
      this.statsImpl.cacheHits += 1;
      return cached.snapshot;
    }
    if (cached !== undefined && cached.latestSeq === latestSeq) {
      this.statsImpl.staleReplays += 1;
    }

    const snapshot = await shard.service.current({ maxEvents: this.maxEvents });
    this.statsImpl.replays += 1;
    shard.cachedPulse = {
      latestSeq: snapshot.lastServerSequence ?? latestSeq,
      snapshot,
    };
    return snapshot;
  }

  private cacheAgeMs(snapshot: PulseSnapshot): number {
    return this.clock.now().getTime() - Date.parse(snapshot.asOf);
  }
}

/** Minimal surface the ingest hook needs; PulseRuntimes satisfies it. */
export interface PulseRefreshTarget {
  getFor(userId: PulseUserKey): {
    pulse: { current(): Promise<PulseSnapshot> };
  };
  invalidate(userId: PulseUserKey): void;
}

export type PulseScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

export interface PulseIngestHookOptions {
  readonly runtimes: PulseRefreshTarget;
  /** Trailing-edge debounce; defaults to the rule table's 5s. */
  readonly refreshDelayMs?: number;
  /** Injectable scheduler for deterministic tests. */
  readonly schedule?: PulseScheduler;
}

const defaultSchedule: PulseScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
};

/**
 * The pulse's ingest hook (integration point 1 of the rule table): called
 * fire-and-forget after a fresh context event lands. It invalidates the
 * user's cached pulse immediately — an event landing means the pulse is
 * stale — and schedules a trailing-edge refresh so an edit burst costs one
 * re-projection, not one per keystroke batch. Every failure is swallowed
 * (the runtime-modules.ts void-error pattern): a broken pulse must never
 * reject the ingest that triggered it.
 */
export const createPulseIngestHook = (
  options: PulseIngestHookOptions,
): ((userId: PulseUserKey) => Promise<void>) => {
  const refreshDelayMs = options.refreshDelayMs ?? 5_000;
  const schedule = options.schedule ?? defaultSchedule;
  const cancelByUser = new Map<PulseUserKey, () => void>();

  const refresh = (userId: PulseUserKey): void => {
    cancelByUser.delete(userId);
    try {
      void options.runtimes
        .getFor(userId)
        .pulse.current()
        .catch(() => undefined);
    } catch (error: unknown) {
      void error;
    }
  };

  // eslint-disable-next-line @typescript-eslint/require-await -- the hook contract is fire-and-forget Promise<void>; the refresh itself is scheduled, never awaited here.
  const hook = async (userId: PulseUserKey): Promise<void> => {
    try {
      options.runtimes.invalidate(userId);
      const previous = cancelByUser.get(userId);
      if (previous !== undefined) {
        previous();
        cancelByUser.delete(userId);
      }
      const cancel = schedule(() => refresh(userId), refreshDelayMs);
      cancelByUser.set(userId, cancel);
    } catch (error: unknown) {
      void error;
    }
  };

  return hook;
};
