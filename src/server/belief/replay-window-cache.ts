import type { ContextEventRecord } from "../context/model.js";

/**
 * Hydrated replay window kept per user shard (R2 memory work, 2026-10-21).
 *
 * Why it exists: after the v0.6 P0 fix (replay the most recent 2000 events
 * instead of failing with 413), every post-ingest projection re-read and
 * re-hydrated the whole window — `listEvents({limit: 2000, order: "desc"})`
 * plus 2000 `JSON.parse` calls, a few MB of short-lived objects per replay.
 * The same-build flag-off/flag-on comparison on the production dist put both
 * arms at ~258MB RSS against a ~140MB boot floor with only ~17MB of live heap
 * at exit: not a leak, but an allocation rate V8 answers by growing the heap.
 * Keeping the hydrated window and reading only what moved removes that rate.
 *
 * The cache is a dumb holder: the reader (context-event-reader.ts) decides
 * when the window can be reused and when it must be rebuilt, PerUserRuntimes
 * decides how many windows may live at once (byte budget + LRU across
 * shards). `events` are owned by the cache and shared with the projection
 * that consumed them — nobody mutates them; every refresh builds new arrays.
 */
export interface BeliefReplayWindow {
  /** The `limit` the window was built for (maxEvents of the projection). */
  readonly limit: number;
  /** The highest serverSequence in the window. */
  readonly maxSequence: number;
  /** Ascending by serverSequence; at most `limit` long; never empty. */
  readonly events: readonly ContextEventRecord[];
}

/**
 * Rough retained footprint of one hydrated ContextEventRecord, for the byte
 * budget only. Production candidate_json averages ~450 bytes; the parsed
 * candidate (data/extensions objects, timestamps, hashes, the record wrapper)
 * lands around 1.5 KiB. A 2000-event window is therefore accounted as ~3 MiB.
 */
export const APPROX_RECORD_BYTES = 1_536;

export class BeliefReplayWindowCache {
  private cached: BeliefReplayWindow | undefined;
  private uses = 0;
  private readonly onFill: (() => void) | undefined;

  /** `onFill` runs after every (re)fill so the owner can re-check its budget. */
  public constructor(onFill?: () => void) {
    this.onFill = onFill;
  }

  public get window(): BeliefReplayWindow | undefined {
    return this.cached;
  }

  public get hasWindow(): boolean {
    return this.cached !== undefined;
  }

  /** Approximate bytes retained by the current window (0 when empty). */
  public get approxBytes(): number {
    return this.cached === undefined
      ? 0
      : this.cached.events.length * APPROX_RECORD_BYTES;
  }

  /**
   * Counts one reuse of the window and reports whether the reader should
   * rebuild it from a full read instead. Every `interval`-th reuse rebuilds,
   * which bounds any drift the incremental refresh cannot see (an event whose
   * occurredAt was still in the future when it was ingested and that has
   * since sunk below the healing band) to at most `interval - 1` projections.
   */
  public takeUse(interval: number): boolean {
    this.uses += 1;
    return this.uses % interval === 0;
  }

  /**
   * Replaces the window. `events` must be ascending by serverSequence and at
   * most `limit` long; an empty array clears the window instead (an empty
   * stream is cheaper to re-read than to describe).
   */
  public fill(events: readonly ContextEventRecord[], limit: number): void {
    const last = events[events.length - 1];
    if (last === undefined) {
      this.cached = undefined;
      return;
    }
    this.cached = { limit, maxSequence: last.serverSequence, events };
    this.onFill?.();
  }

  public clear(): void {
    this.cached = undefined;
  }
}
