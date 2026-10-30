import { describe, expect, it } from "vitest";

import type { ContextClock, ContextEventRecord } from "../../context/model.js";
import { record } from "../../belief/__fixtures__/replay-fixtures.js";
import { PulseService } from "../service.js";
import type { PulseEventReader, PulseSnapshot } from "../model.js";

const AS_OF = "2026-07-30T12:00:00.000Z";

const clock: ContextClock = {
  now: () => new Date(AS_OF),
};

const fixture = [
  record(1, "edit-1", "muses.editor.activity", "2026-07-30T11:59:30.000Z", {
    action: "edit",
  }),
  record(2, "edit-2", "muses.editor.activity", "2026-07-30T11:59:45.000Z", {
    action: "save",
  }),
  record(3, "test-3", "muses.test.run.completed", "2026-07-30T11:59:55.000Z", {
    status: "passed",
  }),
] as const;

const fakeReader = (
  events: readonly ContextEventRecord[],
): PulseEventReader & {
  queries: { asOf: string; limit: number }[];
} => {
  const queries: { asOf: string; limit: number }[] = [];
  return {
    readRecentForPulse: async (query) => {
      queries.push({ ...query });
      return events;
    },
    queries,
  };
};

describe("PulseService", () => {
  it("splits current (persisting) from replay (non-persisting)", async () => {
    const reader = fakeReader(fixture);
    const saved: PulseSnapshot[] = [];
    const service = new PulseService(reader, {
      clock,
      snapshotStore: {
        savePulseSnapshot: async (snapshot) => void saved.push(snapshot),
      },
    });

    const current = await service.current();
    expect(saved.length).toBe(1);
    expect(saved[0]?.inputDigest).toBe(current.inputDigest);

    await service.replay();
    expect(saved.length).toBe(1);
  });

  it("passes maxEvents + 1 as the reader limit and rejects excess events", async () => {
    const many = Array.from({ length: 3 }, (_, index) =>
      record(
        index + 1,
        `edit-${index + 1}`,
        "muses.editor.activity",
        "2026-07-30T11:59:30.000Z",
        { action: "edit" },
      ),
    );
    const reader = fakeReader(many);
    const service = new PulseService(reader, {
      clock,
      defaultMaxEvents: 2,
    });

    await expect(service.current()).rejects.toMatchObject({
      code: "PULSE_REPLAY_LIMIT_EXCEEDED",
      statusCode: 413,
      details: { maxEvents: 2 },
    });
    expect(reader.queries[0]?.limit).toBe(3);
  });

  it("rejects invalid and far-future asOf values", async () => {
    const service = new PulseService(fakeReader(fixture), { clock });

    await expect(
      service.replay({ asOf: "not-a-timestamp" }),
    ).rejects.toMatchObject({ code: "PULSE_INVALID_REQUEST", statusCode: 400 });
    await expect(
      service.replay({ asOf: "2026-07-30T12:10:00.000Z" }),
    ).rejects.toMatchObject({ code: "PULSE_INVALID_REQUEST", statusCode: 400 });
  });

  it("rejects out-of-range maxEvents", async () => {
    const service = new PulseService(fakeReader(fixture), { clock });

    await expect(service.replay({ maxEvents: 0 })).rejects.toMatchObject({
      code: "PULSE_INVALID_REQUEST",
      statusCode: 400,
    });
  });

  it("wraps reader failures as storage failures", async () => {
    const service = new PulseService(
      {
        readRecentForPulse: async () => {
          throw new Error("disk exploded");
        },
      },
      { clock },
    );

    await expect(service.current()).rejects.toMatchObject({
      code: "PULSE_STORAGE_FAILURE",
      statusCode: 503,
    });
  });

  it("is deterministic across repeated replays of the same window", async () => {
    const service = new PulseService(fakeReader(fixture), { clock });
    const first = await service.replay({ asOf: AS_OF });
    const second = await service.replay({ asOf: AS_OF });

    expect(second).toEqual(first);
    expect(second.inputDigest).toBe(first.inputDigest);
    expect(first.rhythm.value).toBe("SLOW");
    expect(first.rhythm.score).toBe(2.5);
    expect(first.emotion.tone).toBe("POSITIVE");
  });
});
