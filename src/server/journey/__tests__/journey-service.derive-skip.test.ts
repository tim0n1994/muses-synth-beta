import { describe, expect, it } from "vitest";

import type {
  ContextEventRecord,
  EventStoreListQuery,
} from "../../context/model.js";
import type { SqliteJourneyRepository } from "../sqlite-journey-repository.js";
import { JourneyService, type JourneyEventSource } from "../journey-service.js";

/**
 * R2 CPU budget (2026-10-21): GET /api/v1/journeys re-read and re-hydrated
 * the user's whole event stream on every call (~0.12s CPU per call on a
 * ~6.7k-event stream). deriveRecent now stamps each successful derive with
 * the stream's MAX(server_sequence) and skips the window re-read while the
 * stream is unchanged. These tests pin the skip contract:
 *   - unchanged stream  -> no second window read
 *   - advanced stream   -> re-derive
 *   - regressed stream (restored backup) -> re-derive
 *   - failed derive     -> the stamp is dropped, the retry re-derives
 *   - source without the probe -> always derive (pre-R2 behavior)
 */

const event = (n: number): ContextEventRecord =>
  ({
    id: `evt-${n}`,
    source: "urn:test:derive-skip",
    type: "muses.editor.activity",
    subject: "workspace:test",
    occurredAt: new Date(Date.UTC(2026, 9, 21, 10, 0, n)).toISOString(),
    receivedAt: new Date(Date.UTC(2026, 9, 21, 10, 0, n)).toISOString(),
    expiresAt: new Date(Date.UTC(2027, 0, 1)).toISOString(),
    serverSequence: n,
    data: { action: "edit" },
  }) as unknown as ContextEventRecord;

interface ProbeSourceOptions {
  readonly withProbe: boolean;
}

const makeSource = (options: ProbeSourceOptions) => {
  const state = { maxSequence: 3, listCalls: 0, failNextList: false };
  const source: JourneyEventSource & {
    readonly listCalls: () => number;
    readonly advance: (to: number) => void;
    readonly failNext: () => void;
  } = {
    async listEvents(_query: EventStoreListQuery) {
      state.listCalls += 1;
      if (state.failNextList) {
        state.failNextList = false;
        throw new Error("synthetic listEvents failure");
      }
      return [event(1), event(2), event(3)];
    },
    ...(options.withProbe
      ? {
          async getMaxServerSequence(_userId: string | null) {
            return state.maxSequence;
          },
        }
      : {}),
    listCalls: () => state.listCalls,
    advance: (to: number) => {
      state.maxSequence = to;
    },
    failNext: () => {
      state.failNextList = true;
    },
  };
  return source;
};

const makeRepository = () => {
  const upserts: unknown[][] = [];
  const repository = {
    upserts,
    listSummaries: (_userId: string | null) => [],
    upsertSnapshot: (snapshot: unknown, userId: string | null) => {
      upserts.push([snapshot, userId]);
    },
  };
  return {
    repository: repository as unknown as SqliteJourneyRepository,
    upserts,
  };
};

const makeService = (source: JourneyEventSource) => {
  const { repository, upserts } = makeRepository();
  return {
    service: new JourneyService({
      repository,
      eventSource: source,
      clock: {
        now: () => new Date(Date.UTC(2026, 9, 21, 12, 0, 0)),
      },
    }),
    upserts,
  };
};

describe("journey derive-on-read skip (R2 CPU budget)", () => {
  it("skips the window re-read while the stream is unchanged", async () => {
    const source = makeSource({ withProbe: true });
    const { service, upserts } = makeService(source);
    await service.listJourneys("user-a");
    await service.listJourneys("user-a");
    await service.listJourneys("user-a");
    expect(source.listCalls()).toBe(1);
    expect(upserts.length).toBeGreaterThan(0);
  });

  it("re-derives when the stream advances or regresses", async () => {
    const source = makeSource({ withProbe: true });
    const { service } = makeService(source);
    await service.listJourneys("user-a");
    source.advance(8);
    await service.listJourneys("user-a");
    source.advance(5); // restored backup: sequence regression
    await service.listJourneys("user-a");
    expect(source.listCalls()).toBe(3);
  });

  it("a failed derive drops the stamp so the retry re-derives", async () => {
    const source = makeSource({ withProbe: true });
    const { service } = makeService(source);
    await service.listJourneys("user-a");
    source.advance(8);
    source.failNext();
    await expect(service.listJourneys("user-a")).rejects.toThrow(
      "synthetic listEvents failure",
    );
    await service.listJourneys("user-a"); // same maxSequence, but re-derives
    expect(source.listCalls()).toBe(3);
  });

  it("sources without the probe keep the always-derive behavior", async () => {
    const source = makeSource({ withProbe: false });
    const { service } = makeService(source);
    await service.listJourneys("user-a");
    await service.listJourneys("user-a");
    expect(source.listCalls()).toBe(2);
  });

  it("stamps are per user", async () => {
    const source = makeSource({ withProbe: true });
    const { service } = makeService(source);
    await service.listJourneys("user-a");
    await service.listJourneys("user-b");
    expect(source.listCalls()).toBe(2);
  });
});
