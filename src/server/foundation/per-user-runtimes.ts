import type {
  BeliefProjectionRequest,
  BeliefReplayTruncation,
  BeliefSnapshot,
} from "../belief/model.js";
import { createContextBeliefEventReader } from "../belief/context-event-reader.js";
import { BeliefReplayWindowCache } from "../belief/replay-window-cache.js";
import { BeliefService, type BeliefServiceOptions } from "../belief/service.js";
import { SYSTEM_CLOCK, type ContextEventStore } from "../context/model.js";

/**
 * Identifies one user's shard of the event-sourced state. `null` is the
 * legacy global stream: what auth-disabled local mode reads and writes, and
 * what every pre-v0.6 row belongs to.
 */
export type UserKey = string | null;

/**
 * Belief surface a request is allowed to see. Structurally satisfied by
 * BeliefService, so unscoped callers (tests, the local single-user app) can
 * keep passing a plain service.
 */
export interface ScopedBeliefView {
  current(): Promise<BeliefSnapshot>;
  replay(request?: BeliefProjectionRequest): Promise<BeliefSnapshot>;
}

export interface UserScopedRuntime {
  /** Belief projection over this user's event stream only. */
  readonly belief: ScopedBeliefView;
}

export interface PerUserRuntimesOptions {
  readonly store: ContextEventStore;
  /**
   * Replay bound per projection — the BeliefService DEFAULT_MAX_EVENTS the
   * uncached path already uses (2000).
   */
  readonly maxEvents?: number;
  /** LRU cap on cached users; the least recently used shard is dropped. */
  readonly maxUsers?: number;
  /**
   * Upper bound on the age of a cached projection that may still be served
   * on a cache hit. Within the bound, an unchanged MAX(server_sequence)
   * serves the cached snapshot as-is; past it, the next read re-projects so
   * time-decayed fields (freshness, idle-driven state transitions) cannot
   * freeze between events. Defaults to 60s — comfortably inside the belief
   * rules' fastest window (conflictWindowMs 2m; idle transitions act on
   * 5–15m windows) — which bounds an idle dashboard to one replay per user
   * per minute. `0` disables serving from cache entirely.
   */
  readonly maxCacheAgeMs?: number;
  /** Clock injected for deterministic tests; defaults to the system clock. */
  readonly clock?: BeliefServiceOptions["clock"];
  /**
   * Observes every replay that had to be degraded to the most recent
   * `maxEvents` events because the user's stream outgrew the bound. Reported
   * once per actual replay (cache hits serve the degraded snapshot silently),
   * keyed by the stream it applied to, so the composition root can log it
   * with the user attached.
   */
  readonly onReplayTruncated?: (
    userId: UserKey,
    truncation: BeliefReplayTruncation,
  ) => void;
  /**
   * Byte budget for the per-shard hydrated replay windows (R2 memory work,
   * 2026-10-21). Each shard may keep its stream's window hydrated so a
   * projection whose stream only moved forward reads a small tail band
   * instead of re-reading and re-hydrating the whole window (see
   * belief/replay-window-cache.ts). When a fill pushes the registry over the
   * budget the least recently used windows are dropped until it fits again,
   * on top of the shard LRU below. `0` disables the hydrated windows
   * entirely (every projection reads the full window, the pre-R2 behavior).
   * Defaults to 32 MiB — about ten full 2000-event windows.
   */
  readonly windowCacheBytes?: number;
}

export interface PerUserRuntimeStats {
  /** Full replays performed (cache misses plus explicit invalidations). */
  readonly replays: number;
  /** Projections served from the per-user cache without a replay. */
  readonly cacheHits: number;
  /**
   * Replays forced by the staleness bound — the sequence had not moved but
   * the cached projection's asOf exceeded maxCacheAgeMs. These are the
   * replays that keep idle users' state honest.
   */
  readonly staleReplays: number;
  /** Users evicted by the LRU cap since startup. */
  readonly usersEvicted: number;
}

interface CachedBelief {
  /** The MAX(server_sequence) the cached snapshot was validated against. */
  latestSeq: number;
  readonly snapshot: BeliefSnapshot;
}

interface UserShard {
  readonly service: BeliefService;
  readonly runtime: UserScopedRuntime;
  /** Undefined while the hydrated-window budget is disabled (0). */
  readonly windowCache: BeliefReplayWindowCache | undefined;
  cachedBelief?: CachedBelief;
}

const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_MAX_USERS = 200;
const DEFAULT_MAX_CACHE_AGE_MS = 60_000;
const DEFAULT_WINDOW_CACHE_BYTES = 32 * 1_024 * 1_024;

/**
 * Per-user runtime registry with the v0.6 hot-path belief cache.
 *
 * One shard per UserKey holds a BeliefService wired to a reader scoped to
 * that user's event stream, plus the last projected snapshot. `current()`
 * first probes `SELECT MAX(server_sequence) WHERE user_id = ?` — an index
 * seek on idx_context_events_user — and returns the cached snapshot when the
 * sequence has not moved AND the cached projection is younger than
 * maxCacheAgeMs, so a dashboard bootstrap costs O(log N) storage work
 * instead of a bounded 2000-event replay. A changed sequence (or an explicit
 * invalidate() after ingest) triggers exactly one replay.
 *
 * The shard table is an LRU capped at maxUsers (default 200) so a host with
 * many registered accounts cannot grow the cache without bound; an evicted
 * user simply replays on their next request.
 *
 * Staleness bound: a cache hit alone would freeze the entire snapshot —
 * freshness AND state — between events, so an idle user's dashboard would
 * report a months-old BUILD forever. The bound (default 60s) re-projects on
 * the first read past it, which caps dishonesty well under the belief
 * rules' minute-scale decay windows at a cost of at most one bounded replay
 * per idle user per bound period. POST /belief/replay remains uncached and
 * always re-projects with a fresh asOf when an exact projection is needed.
 */
export class PerUserRuntimes {
  private readonly store: ContextEventStore;
  private readonly maxEvents: number;
  private readonly maxUsers: number;
  private readonly maxCacheAgeMs: number;
  private readonly clock: BeliefServiceOptions["clock"];
  private readonly onReplayTruncated:
    PerUserRuntimesOptions["onReplayTruncated"] | undefined;
  private readonly windowCacheBytes: number;
  private readonly shards = new Map<UserKey, UserShard>();
  private readonly statsImpl = {
    replays: 0,
    cacheHits: 0,
    staleReplays: 0,
    usersEvicted: 0,
  };

  public constructor(options: PerUserRuntimesOptions) {
    this.store = options.store;
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.maxUsers = options.maxUsers ?? DEFAULT_MAX_USERS;
    this.maxCacheAgeMs = options.maxCacheAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS;
    this.clock = options.clock;
    this.onReplayTruncated = options.onReplayTruncated;
    this.windowCacheBytes =
      options.windowCacheBytes ?? DEFAULT_WINDOW_CACHE_BYTES;
    if (
      !Number.isSafeInteger(this.maxEvents) ||
      this.maxEvents <= 0 ||
      !Number.isSafeInteger(this.maxUsers) ||
      this.maxUsers <= 0 ||
      !Number.isSafeInteger(this.maxCacheAgeMs) ||
      this.maxCacheAgeMs < 0 ||
      !Number.isSafeInteger(this.windowCacheBytes) ||
      this.windowCacheBytes < 0
    ) {
      throw new Error("PerUserRuntimes options are invalid.");
    }
  }

  /** Counters exposed read-only for tests and ops dashboards. */
  public get stats(): PerUserRuntimeStats {
    return { ...this.statsImpl };
  }

  /** Number of shards currently cached (bounded by maxUsers). */
  public get cachedUsers(): number {
    return this.shards.size;
  }

  public getFor(userId: UserKey): UserScopedRuntime {
    return this.ensureShard(userId).runtime;
  }

  /** Drops the user's cached projection; the next read must replay. */
  public invalidate(userId: UserKey): void {
    const shard = this.shards.get(userId);
    if (shard !== undefined) {
      delete shard.cachedBelief;
    }
  }

  /**
   * Looks up (or creates) the user's shard, refreshing its LRU position.
   * currentFor re-enters through here rather than caching the shard object,
   * so an LRU eviction racing an in-flight projection degrades to one extra
   * replay instead of an error.
   */
  private ensureShard(userId: UserKey): UserShard {
    const existing = this.shards.get(userId);
    if (existing !== undefined) {
      // Re-insert so Map iteration order doubles as the LRU order.
      this.shards.delete(userId);
      this.shards.set(userId, existing);
      return existing;
    }

    const onReplayTruncated = this.onReplayTruncated;
    const serviceOptions: BeliefServiceOptions = {
      ...(this.clock === undefined ? {} : { clock: this.clock }),
      ...(onReplayTruncated === undefined
        ? {}
        : {
            onReplayTruncated: (truncation: BeliefReplayTruncation) =>
              onReplayTruncated(userId, truncation),
          }),
    };
    const windowCache =
      this.windowCacheBytes > 0
        ? new BeliefReplayWindowCache(() => this.enforceWindowBudget(userId))
        : undefined;
    const service = new BeliefService(
      createContextBeliefEventReader(
        this.store,
        userId,
        windowCache === undefined ? {} : { windowCache },
      ),
      serviceOptions,
    );
    const shard: UserShard = {
      service,
      windowCache,
      runtime: {
        belief: {
          current: () => this.currentFor(userId),
          replay: (request?: BeliefProjectionRequest) =>
            service.replay(request),
        },
      },
    };
    this.shards.set(userId, shard);
    this.evictIfNeeded();
    return shard;
  }

  /**
   * Drops hydrated windows, least recently used first, until the registry
   * fits the byte budget again. Runs after every fill; the shard itself (and
   * the snapshot cache in it) stays — only the hydrated window is dropped,
   * so an evicted user pays one full window read on their next projection,
   * exactly like a shard that was never filled.
   */
  private enforceWindowBudget(justFilled: UserKey): void {
    let total = 0;
    for (const shard of this.shards.values()) {
      total += shard.windowCache?.approxBytes ?? 0;
    }
    if (total <= this.windowCacheBytes) {
      return;
    }
    for (const [key, shard] of this.shards) {
      if (total <= this.windowCacheBytes) {
        break;
      }
      if (key === justFilled || shard.windowCache?.hasWindow !== true) {
        continue;
      }
      const bytes = shard.windowCache.approxBytes;
      shard.windowCache.clear();
      total -= bytes;
    }
    // A single window larger than the whole budget (a tiny budget, or a
    // window sized above it) cannot stay cached.
    const filled = this.shards.get(justFilled);
    if (
      total > this.windowCacheBytes &&
      filled?.windowCache?.hasWindow === true
    ) {
      filled.windowCache.clear();
    }
  }

  private async currentFor(userId: UserKey): Promise<BeliefSnapshot> {
    const shard = this.ensureShard(userId);

    const latestSeq = await this.store.getMaxServerSequence(userId);
    const cached = shard.cachedBelief;
    if (
      cached !== undefined &&
      cached.latestSeq === latestSeq &&
      this.cacheAgeMs(cached.snapshot) <= this.maxCacheAgeMs
    ) {
      this.statsImpl.cacheHits += 1;
      return cached.snapshot;
    }
    if (cached !== undefined && cached.latestSeq === latestSeq) {
      // The only reason we fell through: the cached projection aged out.
      this.statsImpl.staleReplays += 1;
    }

    // The hot-path replay opts in to the shard's hydrated window (R2 memory
    // work): a stream that only moved forward is served from the cached
    // events plus a small tail band. The public replay() view above leaves
    // the flag unset and keeps the uncached contract.
    const snapshot = await shard.service.replay({
      maxEvents: this.maxEvents,
      ...(shard.windowCache === undefined ? {} : { windowCache: true }),
    });
    this.statsImpl.replays += 1;
    shard.cachedBelief = {
      // lastServerSequence reflects exactly what the projection consumed;
      // fall back to the probed sequence when the projector omitted it.
      latestSeq: snapshot.lastServerSequence ?? latestSeq,
      snapshot,
    };
    return snapshot;
  }

  private cacheAgeMs(snapshot: BeliefSnapshot): number {
    return this.nowMs() - Date.parse(snapshot.asOf);
  }

  private nowMs(): number {
    return (this.clock ?? SYSTEM_CLOCK).now().getTime();
  }

  private evictIfNeeded(): void {
    while (this.shards.size > this.maxUsers) {
      const oldest = this.shards.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.shards.delete(oldest.value);
      this.statsImpl.usersEvicted += 1;
    }
  }
}
