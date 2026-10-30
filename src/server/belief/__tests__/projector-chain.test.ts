import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { ContextEventRecord, JsonValue } from "../../context/model.js";
import { BeliefChainMemo } from "../chain-memo.js";
import {
  projectBelief,
  referenceHysteresisChain,
  windowHysteresisChain,
} from "../projector.js";
import { BELIEF_RULES, BELIEF_RULESET_VERSION } from "../rules.js";
import { record } from "../__fixtures__/replay-fixtures.js";

/**
 * The R2 CPU work rewrote the hysteresis chain of projectBelief from a prefix
 * evaluation (O(n²)) to a window-local, memoized one (chain-memo.ts). The
 * contract is "same snapshot, cheaper": these tests hold the new chain
 * against the pre-R2 chain kept verbatim as `referenceHysteresisChain`, and
 * the memoized projection against a cold one, across randomized streams that
 * exercise everything the alignment has to cope with — appends, a sliding
 * window bound, out-of-order and tied timestamps, duplicate re-ingests,
 * expiry under an advancing asOf, a shrinking replay bound, asOf moving
 * backwards.
 */

const MINUTE = 60_000;
const WINDOW_MS = BELIEF_RULES.evidenceWindowMs;
const BASE_MS = Date.parse("2026-07-30T00:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

/** mulberry32: a tiny seeded PRNG so a failure names its seed. */
const prng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const pick = <T>(rand: () => number, choices: readonly T[]): T =>
  choices[Math.floor(rand() * choices.length)]!;

const randomTypeAndData = (
  rand: () => number,
): Readonly<{ type: string; data: JsonValue }> => {
  const roll = rand();
  if (roll < 0.3) {
    return {
      type: "muses.editor.activity",
      data: {
        action: pick(rand, ["edit", "save", "navigate", "open", "hover"]),
      },
    };
  }
  if (roll < 0.45) {
    return {
      type: "muses.test.run.completed",
      data: {
        status: pick(rand, ["passed", "failed", "cancelled", "skipped"]),
      },
    };
  }
  if (roll < 0.55) {
    return { type: "muses.review.activity", data: { action: "diff" } };
  }
  if (roll < 0.7) {
    return {
      type: "muses.session.activity",
      data: { status: pick(rand, ["active", "idle", "inactive", "away"]) },
    };
  }
  if (roll < 0.78) {
    return { type: "muses.environment.setup", data: { tool: "pnpm" } };
  }
  if (roll < 0.9) {
    return {
      type: "muses.process.activity",
      data: {
        status: pick(rand, [
          "started",
          "waiting",
          "completed",
          "failed",
          "zombie",
        ]),
      },
    };
  }
  return { type: "muses.unknown.thing", data: { x: 1 } };
};

const makeEvent = (
  rand: () => number,
  sequence: number,
  occurredMs: number,
  expiresMs: number,
): ContextEventRecord => {
  const { type, data } = randomTypeAndData(rand);
  return record(sequence, `evt-${sequence}`, type, iso(occurredMs), data, {
    expiresAt: iso(expiresMs),
  });
};

const readerWindow = (
  stream: readonly ContextEventRecord[],
  asOfMs: number,
  limit: number,
): ContextEventRecord[] =>
  stream
    .filter(
      (event) =>
        Date.parse(event.expiresAt) > asOfMs &&
        Date.parse(event.occurredAt) <= asOfMs,
    )
    .slice(-limit)
    .reverse(); // the reader hands the window back descending by sequence

const expectSameAsReference = (
  window: readonly ContextEventRecord[],
  asOf: string,
  limit: number,
  memo: BeliefChainMemo,
): void => {
  const memoized = projectBelief(window, asOf, {
    maxEvents: limit,
    chainMemo: memo,
  });
  const cold = projectBelief(window, asOf, { maxEvents: limit });
  expect(memoized).toEqual(cold);
  expect(windowHysteresisChain(window, asOf)).toEqual(
    referenceHysteresisChain(window, asOf),
  );
  expect(windowHysteresisChain(window, asOf, new BeliefChainMemo())).toEqual(
    referenceHysteresisChain(window, asOf),
  );
};

const runScenario = (seed: number): void => {
  const rand = prng(seed);
  const stream: ContextEventRecord[] = [];
  let sequence = 1;
  let lastMs = BASE_MS;
  let asOfMs = BASE_MS;
  const limit = 1 + Math.floor(rand() * 60);
  const memo = new BeliefChainMemo();
  const steps = 12 + Math.floor(rand() * 20);

  for (let step = 0; step < steps; step += 1) {
    const appends =
      step === 0 ? 1 + Math.floor(rand() * 40) : Math.floor(rand() * 7);
    for (let count = 0; count < appends; count += 1) {
      const gapRoll = rand();
      const gap =
        gapRoll < 0.75
          ? rand() * 3 * MINUTE
          : gapRoll < 0.9
            ? 25 * MINUTE + rand() * 10 * MINUTE
            : 31 * MINUTE + rand() * 90 * MINUTE;
      let occurredMs = lastMs + Math.floor(gap);
      if (rand() < 0.1) {
        // Out of order: lands before events already ingested.
        occurredMs = lastMs - Math.floor(rand() * 10 * MINUTE);
      } else if (rand() < 0.05) {
        // Tied timestamp: ordering falls back to serverSequence.
        occurredMs = lastMs;
      }
      const expiresMs =
        rand() < 0.15
          ? occurredMs + 20 * MINUTE + Math.floor(rand() * 40 * MINUTE)
          : occurredMs + 30 * 24 * 60 * MINUTE;
      stream.push(makeEvent(rand, sequence, occurredMs, expiresMs));
      lastMs = Math.max(lastMs, occurredMs);
      sequence += 1;
      if (rand() < 0.05) {
        // Duplicate re-ingest: same identity and content, newer sequence.
        const original = pick(rand, stream);
        stream.push({ ...original, serverSequence: sequence });
        sequence += 1;
      }
    }

    asOfMs =
      Math.max(asOfMs, lastMs) +
      (rand() < 0.3
        ? Math.floor(rand() * 90 * MINUTE)
        : Math.floor(rand() * 30_000));
    expectSameAsReference(
      readerWindow(stream, asOfMs, limit),
      iso(asOfMs),
      limit,
      memo,
    );

    if (rand() < 0.15) {
      // An explicit replay through the same service: a smaller bound and an
      // asOf that may sit before the latest events.
      const replayLimit = 1 + Math.floor(rand() * limit);
      const replayAsOfMs = BASE_MS + Math.floor(rand() * (asOfMs - BASE_MS));
      expectSameAsReference(
        readerWindow(stream, replayAsOfMs, replayLimit),
        iso(replayAsOfMs),
        replayLimit,
        memo,
      );
    }
  }
};

const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

describe("window-local, memoized hysteresis chain", () => {
  it.each(SEEDS)(
    "matches the prefix chain and the cold projection across a randomized stream (seed %i)",
    (seed) => {
      runScenario(seed);
    },
    20_000,
  );

  it("matches on the documented fixtures with a memo carried across asOf moves", () => {
    const memo = new BeliefChainMemo();
    const events = [
      record(1, "edit-1", "muses.editor.activity", iso(BASE_MS), {
        action: "edit",
      }),
      record(2, "edit-2", "muses.editor.activity", iso(BASE_MS + 2 * MINUTE), {
        action: "save",
      }),
      record(3, "edit-3", "muses.editor.activity", iso(BASE_MS + 4 * MINUTE), {
        action: "edit",
      }),
      record(
        4,
        "test-fail",
        "muses.test.run.completed",
        iso(BASE_MS + 5 * MINUTE),
        { status: "failed" },
      ),
      record(
        5,
        "test-pass",
        "muses.test.run.completed",
        iso(BASE_MS + 7 * MINUTE),
        { status: "passed" },
      ),
    ];
    for (const minutes of [4, 5, 7, 8, 20, 40, 70]) {
      const asOf = iso(BASE_MS + minutes * MINUTE);
      const window = events.filter(
        (event) => Date.parse(event.occurredAt) <= Date.parse(asOf),
      );
      expect(projectBelief(window, asOf, { chainMemo: memo })).toEqual(
        projectBelief(window, asOf),
      );
    }
  });
});

describe("input digest", () => {
  /** The pre-R2 digest: one JSON.stringify over wrapper objects. */
  const referenceDigest = (
    events: readonly ContextEventRecord[],
    asOf: string,
  ): string =>
    createHash("sha256")
      .update(
        JSON.stringify({
          rulesetVersion: BELIEF_RULESET_VERSION,
          asOf,
          events: events.map((event) => ({
            source: event.source,
            id: event.id,
            serverSequence: event.serverSequence,
            contentHash: event.contentHash,
            occurredAt: event.occurredAt,
            expiresAt: event.expiresAt,
          })),
        }),
      )
      .digest("hex");

  it("is byte-identical to the object form, including JSON escaping", () => {
    const events = [
      record(
        1,
        'id "with" \\ backslash \n newline \u00e9 \u{1f3b5} \u0000',
        "muses.editor.activity",
        iso(BASE_MS),
        { action: "edit" },
        { source: 'urn:muses:te"st\\x\t' },
      ),
      record(2, "plain", "muses.editor.activity", iso(BASE_MS + MINUTE), {
        action: "save",
      }),
      record(3, "unknown", "muses.unknown.thing", iso(BASE_MS + 2 * MINUTE), {
        x: 1,
      }),
    ];
    for (const asOf of [
      iso(BASE_MS + 2 * MINUTE),
      iso(BASE_MS + 90 * MINUTE),
    ]) {
      const snapshot = projectBelief(events, asOf);
      expect(snapshot.inputDigest).toBe(referenceDigest(events, snapshot.asOf));
      expect(
        projectBelief(events, asOf, { chainMemo: new BeliefChainMemo() })
          .inputDigest,
      ).toBe(snapshot.inputDigest);
    }
  });

  it("covers an empty window", () => {
    const snapshot = projectBelief([], iso(BASE_MS));
    expect(snapshot.inputDigest).toBe(referenceDigest([], snapshot.asOf));
  });
});

describe("BeliefChainMemo.plan", () => {
  const editAt = (sequence: number, ms: number): ContextEventRecord =>
    record(sequence, `edit-${sequence}`, "muses.editor.activity", iso(ms), {
      action: "edit",
    });
  const times = (events: readonly ContextEventRecord[]): Float64Array =>
    Float64Array.from(events, (event) => Date.parse(event.occurredAt));
  /** Five edits, one every 10 minutes: every checkpoint's window spans the previous three. */
  const baseline = [0, 10, 20, 30, 40].map((minutes, index) =>
    editAt(index + 1, BASE_MS + minutes * MINUTE),
  );
  const primed = (): BeliefChainMemo => {
    const memo = new BeliefChainMemo();
    windowHysteresisChain(baseline, iso(BASE_MS + 41 * MINUTE), memo);
    return memo;
  };

  it("reuses nothing from an empty memo", () => {
    const memo = new BeliefChainMemo();
    expect(memo.size).toBe(0);
    expect([...memo.plan(baseline, times(baseline))]).toEqual([
      -1, -1, -1, -1, -1,
    ]);
  });

  it("reuses every checkpoint of an unchanged window", () => {
    const memo = primed();
    expect(memo.size).toBe(5);
    expect([...memo.plan(baseline, times(baseline))]).toEqual([0, 1, 2, 3, 4]);
  });

  it("re-evaluates only the appended checkpoint after an ingest", () => {
    const memo = primed();
    const next = [...baseline, editAt(6, BASE_MS + 50 * MINUTE)];
    expect([...memo.plan(next, times(next))]).toEqual([0, 1, 2, 3, 4, -1]);
  });

  it("re-evaluates the checkpoints within evidenceWindowMs after a dropped head", () => {
    const memo = primed();
    const slid = [...baseline.slice(1), editAt(6, BASE_MS + 50 * MINUTE)];
    // t=10,20,30 still see t=0 inside their 30-minute window; t=40 does not.
    expect([...memo.plan(slid, times(slid))]).toEqual([-1, -1, -1, 4, -1]);
  });

  it("treats a changed contentHash at the same sequence as a drop plus an insert", () => {
    const memo = primed();
    const replaced = baseline.map((event, index) =>
      index === 2 ? { ...event, contentHash: "hash-rewritten" } : event,
    );
    expect([...memo.plan(replaced, times(replaced))]).toEqual([
      0, 1, -1, -1, -1,
    ]);
  });

  it("invalidates a checkpoint for an insert exactly evidenceWindowMs before it", () => {
    const memo = primed();
    // A late edit lands at t=10 with sequence 9: tied with edit-2 and ordered
    // after it. The t=40 checkpoint sees it at age == evidenceWindowMs, which
    // collectFacts still admits (only > is excluded).
    const inserted = [
      baseline[0]!,
      baseline[1]!,
      editAt(9, BASE_MS + 10 * MINUTE),
      ...baseline.slice(2),
    ];
    expect(BASE_MS + 40 * MINUTE - (BASE_MS + 10 * MINUTE)).toBe(WINDOW_MS);
    expect([...memo.plan(inserted, times(inserted))]).toEqual([
      0, -1, -1, -1, -1, -1,
    ]);
  });

  it("forgets on clear", () => {
    const memo = primed();
    memo.clear();
    expect(memo.size).toBe(0);
    expect([...memo.plan(baseline, times(baseline))]).toEqual([
      -1, -1, -1, -1, -1,
    ]);
  });
});
