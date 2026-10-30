import type { ContextEventRecord } from "../context/model.js";
import { BELIEF_STATES } from "./model.js";
import { BELIEF_RULES } from "./rules.js";

/**
 * Per-stream memo of the hysteresis chain's checkpoint evaluations (R2 CPU
 * work, 2026-10-22).
 *
 * Why it exists: projectBelief carries the state hysteresis forward by
 * evaluating the stream at every event — evaluate(events[0..i], t_i) for each
 * i. Written as a prefix evaluation that is O(n²): a full 2000-event
 * production window cost ~1.8s of pure compute per projection, the per-user
 * cache's 60s staleness bound re-projects an idle dashboard once a minute
 * (~3% of a core per online user), and every ingest paid the same ~2s before
 * the automation seam could answer.
 *
 * Two facts make the chain cheap without changing a single output:
 *
 * 1. The checkpoint evaluation is window-local. collectFacts only admits an
 *    event into the meaningful/edit/test/review/session facts while its age
 *    at the checkpoint is <= evidenceWindowMs; the one unwindowed fact
 *    (recognizedEvents) is consulted only when no meaningful event exists, in
 *    which case rawState is forced to UNKNOWN and applyHysteresis ignores the
 *    distribution. So evaluate(events[0..i], t_i) and evaluate(window_i, t_i)
 *    — window_i being the prefix events within evidenceWindowMs of t_i —
 *    agree on rawState, on the distribution whenever it is read, and on
 *    freshness: everything the chain carries.
 *
 * 2. Between two projections of one stream the normalized window is nearly
 *    the same list: identical for a staleness re-projection, one event longer
 *    after an ingest, one event shifted for a stream past the replay bound.
 *    A checkpoint whose window holds no inserted or dropped event has exactly
 *    the evaluation it had last time.
 *
 * The memo keeps, per checkpoint of the last projection, the event identity
 * (serverSequence + contentHash), its occurredAt, and the three evaluation
 * outputs the chain reads (rawState, freshness, distribution). `plan` aligns
 * the new window against it and says which checkpoints must be re-evaluated;
 * `commit` makes the new window's evaluations the current generation. The
 * fold itself (applyHysteresis across the checkpoints) is always re-run — it
 * is O(n) arithmetic.
 *
 * Exactness, not approximation: a checkpoint is re-evaluated whenever any
 * inserted or dropped event lies within [t_i - evidenceWindowMs, t_i]; the
 * test is conservative at the boundaries (an event tied on occurredAt but
 * ordered after the checkpoint still forces a re-evaluation). The
 * equivalence with the prefix evaluation is covered by a randomized test in
 * __tests__/projector-chain.test.ts.
 *
 * Footprint: two generations (current + spare) of ~100 bytes per checkpoint
 * (typed arrays plus references to the contentHash strings the events
 * already own) — ~400 KiB for a full 2000-event window, held once per
 * BeliefService (one per user shard). The projector borrows the spare
 * generation and the memo swaps on commit, so a steady-state projection
 * allocates no chain arrays at all (R2 memory work: the per-projection
 * typed-array churn was malloc-backed and only returned on a major GC).
 */

/** Number of belief states; distributions are stored STATE_COUNT per checkpoint in BELIEF_STATES order. */
export const STATE_COUNT = BELIEF_STATES.length;

/**
 * The chain's view of one window: per checkpoint, the evaluation outputs
 * applyHysteresis reads. Arrays may be longer than the window (capacity);
 * only [0, size) is meaningful.
 */
export interface ChainCheckpoints {
  /** Index into BELIEF_STATES of the checkpoint's rawState. */
  readonly rawState: Uint8Array;
  readonly freshness: Float64Array;
  /** STATE_COUNT entries per checkpoint, BELIEF_STATES order. */
  readonly distribution: Float64Array;
}

/**
 * One generation of chain state for a window: the parallel identity and
 * timestamp arrays plus the checkpoint evaluations. The projector fills
 * `occurredMs` and `checkpoints` for [0, size); `commit` fills the identity.
 */
export interface ChainGeneration {
  readonly capacity: number;
  /** Checkpoints in use; set by borrow(). */
  size: number;
  readonly sequences: Float64Array;
  readonly hashes: string[];
  readonly occurredMs: Float64Array;
  readonly checkpoints: ChainCheckpoints;
}

export const createChainGeneration = (
  capacity: number,
  size: number = capacity,
): ChainGeneration => ({
  capacity,
  size,
  sequences: new Float64Array(capacity),
  hashes: new Array<string>(capacity),
  occurredMs: new Float64Array(capacity),
  checkpoints: {
    rawState: new Uint8Array(capacity),
    freshness: new Float64Array(capacity),
    distribution: new Float64Array(capacity * STATE_COUNT),
  },
});

/** Headroom on (re)allocation so a stream growing one event per ingest reallocates every GROWTH_HEADROOM projections, not every one. */
const GROWTH_HEADROOM = 64;

export class BeliefChainMemo {
  private current: ChainGeneration = createChainGeneration(0);
  private spare: ChainGeneration | undefined;

  /** Checkpoints remembered from the last committed window. */
  public get size(): number {
    return this.current.size;
  }

  /**
   * Hands the projector a generation with capacity >= size to fill. Reuses
   * the spare generation (the one before the current) when it is large
   * enough; otherwise allocates with headroom. The borrowed generation is
   * not referenced by the memo until commit().
   */
  public borrow(size: number): ChainGeneration {
    const spare = this.spare;
    this.spare = undefined;
    if (spare !== undefined && spare.capacity >= size) {
      spare.size = size;
      return spare;
    }
    return createChainGeneration(size + GROWTH_HEADROOM, size);
  }

  /**
   * Aligns a normalized window (ascending by occurredAt, then serverSequence
   * — the projector's order) against the current generation. Returns, per
   * checkpoint, the memo index whose evaluation can be reused, or -1 when the
   * checkpoint must be evaluated again.
   */
  public plan(
    events: readonly ContextEventRecord[],
    occurredMs: Float64Array,
  ): Int32Array {
    const size = events.length;
    const reuse = new Int32Array(size).fill(-1);
    const memo = this.current;
    const memoSize = memo.size;
    if (memoSize === 0) {
      return reuse;
    }

    // Merge-walk both lists (same comparator as normalizeEvents): an event
    // present in both is aligned; one present on only one side is an insert
    // or a drop whose occurredAt is recorded, in ascending order.
    const changed: number[] = [];
    let index = 0;
    let memoIndex = 0;
    while (index < size && memoIndex < memoSize) {
      const event = events[index]!;
      const memoSequence = memo.sequences[memoIndex]!;
      if (
        event.serverSequence === memoSequence &&
        event.contentHash === memo.hashes[memoIndex]
      ) {
        reuse[index] = memoIndex;
        index += 1;
        memoIndex += 1;
        continue;
      }
      const eventMs = occurredMs[index]!;
      const memoMs = memo.occurredMs[memoIndex]!;
      const eventFirst =
        eventMs < memoMs ||
        (eventMs === memoMs && event.serverSequence < memoSequence);
      const memoFirst =
        memoMs < eventMs ||
        (eventMs === memoMs && memoSequence < event.serverSequence);
      if (eventFirst) {
        changed.push(eventMs);
        index += 1;
      } else if (memoFirst) {
        changed.push(memoMs);
        memoIndex += 1;
      } else {
        // Same position, different content: a drop and an insert at once.
        changed.push(eventMs);
        index += 1;
        memoIndex += 1;
      }
    }
    for (; index < size; index += 1) {
      changed.push(occurredMs[index]!);
    }
    for (; memoIndex < memoSize; memoIndex += 1) {
      changed.push(memo.occurredMs[memoIndex]!);
    }

    // An aligned checkpoint keeps its evaluation only while no change fell
    // inside its window. Both the checkpoints and `changed` ascend, so one
    // cursor walks the changes.
    let cursor = 0;
    for (let checkpoint = 0; checkpoint < size; checkpoint += 1) {
      if (reuse[checkpoint]! < 0) {
        continue;
      }
      const checkpointMs = occurredMs[checkpoint]!;
      const lowerBound = checkpointMs - BELIEF_RULES.evidenceWindowMs;
      while (cursor < changed.length && changed[cursor]! < lowerBound) {
        cursor += 1;
      }
      if (cursor < changed.length && changed[cursor]! <= checkpointMs) {
        reuse[checkpoint] = -1;
      }
    }
    return reuse;
  }

  /** Copies the remembered evaluation `memoIndex` into `target[targetIndex]`. */
  public copyInto(
    target: ChainCheckpoints,
    targetIndex: number,
    memoIndex: number,
  ): void {
    const source = this.current.checkpoints;
    target.rawState[targetIndex] = source.rawState[memoIndex]!;
    target.freshness[targetIndex] = source.freshness[memoIndex]!;
    const sourceBase = memoIndex * STATE_COUNT;
    const targetBase = targetIndex * STATE_COUNT;
    for (let state = 0; state < STATE_COUNT; state += 1) {
      target.distribution[targetBase + state] =
        source.distribution[sourceBase + state]!;
    }
  }

  /**
   * Makes the borrowed, now filled, generation current: records the window's
   * identity and parks the previous generation as the spare. The projector
   * must not touch `generation` after this.
   */
  public commit(
    events: readonly ContextEventRecord[],
    generation: ChainGeneration,
  ): void {
    const size = events.length;
    generation.size = size;
    for (let index = 0; index < size; index += 1) {
      const event = events[index]!;
      generation.sequences[index] = event.serverSequence;
      generation.hashes[index] = event.contentHash;
    }
    // Drop string references beyond the window so a shrunken window does
    // not pin the previous one's contentHash strings.
    for (let index = size; index < generation.hashes.length; index += 1) {
      generation.hashes[index] = "";
    }
    this.spare = this.current;
    this.current = generation;
  }

  /** Forgets everything; the next projection evaluates every checkpoint. */
  public clear(): void {
    this.current = createChainGeneration(0);
    this.spare = undefined;
  }
}
