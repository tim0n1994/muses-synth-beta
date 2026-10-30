import { describe, expect, it } from "vitest";
import type { ContextClock } from "../../context/model.js";
import type {
  BeliefEventWindow,
  BeliefReplayTruncation,
  BeliefSnapshot,
  BeliefSnapshotStore,
} from "../model.js";
import { projectBelief } from "../projector.js";
import { BeliefService } from "../service.js";
import { sustainedEditingFixture } from "../__fixtures__/replay-fixtures.js";

const AS_OF = "2026-07-30T00:04:00.000Z";

const fixedClock: ContextClock = {
  now: () => new Date(AS_OF),
};

class CapturingSnapshotStore implements BeliefSnapshotStore {
  public saved: BeliefSnapshot | undefined;

  public async saveBeliefSnapshot(snapshot: BeliefSnapshot): Promise<void> {
    this.saved = snapshot;
  }
}

const wholeStream = (): BeliefEventWindow => ({
  events: sustainedEditingFixture,
  total: sustainedEditingFixture.length,
});

/** The two newest fixture events by serverSequence — what a 2-event window holds. */
const newestTwo = sustainedEditingFixture.slice(-2);

describe("BeliefService", () => {
  it("persists current projections but keeps replay side-effect free", async () => {
    const snapshots = new CapturingSnapshotStore();
    const service = new BeliefService(
      {
        readForBelief: async () => wholeStream(),
      },
      { clock: fixedClock, snapshotStore: snapshots },
    );

    const current = await service.current();
    expect(current.state).toBe("BUILD");
    expect(snapshots.saved?.inputDigest).toBe(current.inputDigest);

    snapshots.saved = undefined;
    await service.replay({ asOf: AS_OF });
    expect(snapshots.saved).toBeUndefined();
  });

  it("degrades to the most recent window instead of failing when the stream exceeds the replay limit", async () => {
    const truncations: BeliefReplayTruncation[] = [];
    const queries: Array<{ asOf: string; limit: number }> = [];
    const service = new BeliefService(
      {
        // A production reader returns the newest `limit` events plus the
        // stream total; here the stream holds 3 events and the window is 2.
        readForBelief: async (query) => {
          queries.push(query);
          return { events: newestTwo, total: sustainedEditingFixture.length };
        },
      },
      {
        clock: fixedClock,
        defaultMaxEvents: 2,
        onReplayTruncated: (truncation) => truncations.push(truncation),
      },
    );

    const snapshot = await service.current();

    // The window is exactly what the service asked the reader for.
    expect(queries).toEqual([{ asOf: AS_OF, limit: 2 }]);
    // The result is the replay of the most recent window, nothing else.
    expect(snapshot).toEqual(projectBelief(newestTwo, AS_OF));
    expect(snapshot.lastServerSequence).toBe(3);
    expect(truncations).toEqual([
      { asOf: AS_OF, total: 3, window: 2, maxEvents: 2 },
    ]);
  });

  it("trims an over-delivering reader to the most recent events by serverSequence", async () => {
    const truncations: BeliefReplayTruncation[] = [];
    const service = new BeliefService(
      {
        // A reader that ignores `limit` (older doubles, or a stream read in
        // one page) must not reintroduce the unbounded replay: the service
        // keeps the newest events itself. Reverse the order to prove the
        // selection is by serverSequence, not by array position.
        readForBelief: async () => ({
          events: [...sustainedEditingFixture].reverse(),
          total: sustainedEditingFixture.length,
        }),
      },
      {
        clock: fixedClock,
        defaultMaxEvents: 2,
        onReplayTruncated: (truncation) => truncations.push(truncation),
      },
    );

    const snapshot = await service.replay();

    expect(snapshot).toEqual(projectBelief(newestTwo, AS_OF));
    expect(truncations).toEqual([
      { asOf: AS_OF, total: 3, window: 2, maxEvents: 2 },
    ]);
  });

  it("does not report truncation when the whole stream fits the window", async () => {
    const truncations: BeliefReplayTruncation[] = [];
    const service = new BeliefService(
      { readForBelief: async () => wholeStream() },
      {
        clock: fixedClock,
        onReplayTruncated: (truncation) => truncations.push(truncation),
      },
    );

    const snapshot = await service.current();

    expect(snapshot).toEqual(projectBelief(sustainedEditingFixture, AS_OF));
    expect(truncations).toEqual([]);
  });
});
