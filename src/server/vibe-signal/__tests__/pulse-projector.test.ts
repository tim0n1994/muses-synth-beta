import { describe, expect, it } from "vitest";

import { record } from "../../belief/__fixtures__/replay-fixtures.js";
import type { ContextEventRecord } from "../../context/model.js";
import { projectPulse } from "../projector.js";
import { PULSE_RULESET_VERSION, PULSE_RULE_ID_SET } from "../rules.js";

const AS_OF = "2026-07-30T12:00:00.000Z";
const AS_OF_MS = Date.parse(AS_OF);
const WINDOW_START = "2026-07-30T11:59:00.000Z";
const WINDOW_START_MS = Date.parse(WINDOW_START);

const at = (offsetSeconds: number): string =>
  new Date(AS_OF_MS + offsetSeconds * 1_000).toISOString();

const edit = (sequence: number, offsetSeconds: number): ContextEventRecord =>
  record(
    sequence,
    `edit-${sequence}`,
    "muses.editor.activity",
    at(offsetSeconds),
    {
      action: sequence % 4 === 0 ? "save" : "edit",
    },
  );

const navigate = (
  sequence: number,
  offsetSeconds: number,
): ContextEventRecord =>
  record(
    sequence,
    `nav-${sequence}`,
    "muses.editor.activity",
    at(offsetSeconds),
    { action: "navigate" },
  );

const testEvent = (
  sequence: number,
  offsetSeconds: number,
  status: "passed" | "failed" | "cancelled",
): ContextEventRecord =>
  record(
    sequence,
    `test-${sequence}`,
    "muses.test.run.completed",
    at(offsetSeconds),
    {
      status,
    },
  );

const processEvent = (
  sequence: number,
  offsetSeconds: number,
  status: "started" | "waiting" | "completed" | "failed",
): ContextEventRecord =>
  record(
    sequence,
    `proc-${sequence}`,
    "muses.process.activity",
    at(offsetSeconds),
    { status },
  );

const reviewEvent = (
  sequence: number,
  offsetSeconds: number,
): ContextEventRecord =>
  record(
    sequence,
    `review-${sequence}`,
    "muses.review.activity",
    at(offsetSeconds),
    { action: "diff-opened" },
  );

const uniformEdits = (
  count: number,
  spacingMs: number,
  firstOffsetMs: number,
): readonly ContextEventRecord[] =>
  Array.from({ length: count }, (_, index) =>
    edit(index + 1, (firstOffsetMs + index * spacingMs) / 1_000),
  );

/** PRD 1.1 example: uniform editing traffic plus a recent green test. */
const prdExampleFixture = [
  ...uniformEdits(24, 2_500, -58_750),
  testEvent(25, -10, "passed"),
];

/** 15 edits crammed into the head of the window, then silence. */
const burstHeadFixture = Array.from({ length: 15 }, (_, index) =>
  edit(index + 1, (-59_500 + index * 700) / 1_000),
);

/** Sparse editing grid used as the emotion-independent base. */
const troughBaseFixture = [edit(1, -55), edit(2, -20)];

/** The trough: same grid plus two failing tests and one failed process. */
const troughFixture = [
  ...troughBaseFixture,
  testEvent(3, -45, "failed"),
  testEvent(4, -30, "failed"),
  processEvent(5, -5, "failed"),
];

/** One isolated event at the window midpoint: CALM by construction. */
const calmFixture = [edit(1, -30)];

/** 25 edits inside the first 20s of the window. */
const cramFixture = Array.from({ length: 25 }, (_, index) =>
  edit(index + 1, (-59_000 + index * 800) / 1_000),
);

describe("pulse projector quantities", () => {
  it("maps the PRD flow example to FAST rhythm, STEADY intensity, POSITIVE emotion", () => {
    const snapshot = projectPulse(prdExampleFixture, AS_OF);

    expect(snapshot.asOf).toBe(AS_OF);
    expect(snapshot.windowStartedAt).toBe(WINDOW_START);
    expect(snapshot.windowEndedAt).toBe(AS_OF);
    expect(snapshot.rulesetVersion).toBe(PULSE_RULESET_VERSION);
    expect(snapshot.rulesetVersion).toBe("muses-pulse-rules/0.1.0");
    expect(snapshot.lastServerSequence).toBe(25);

    // 24 edit/save events at weight 1.0 plus one passed test at 0.5.
    expect(snapshot.rhythm.value).toBe("FAST");
    expect(snapshot.rhythm.score).toBe(24.5);
    expect(
      snapshot.rhythm.evidence.some(
        (entry) => entry.ruleId === "rhythm-rate-high",
      ),
    ).toBe(true);

    // Uniform spacing keeps CV low and coverage high: STEADY intensity.
    expect(snapshot.intensity.value).toBe("STEADY");
    expect(snapshot.intensity.score).toBeGreaterThanOrEqual(0.35);
    expect(snapshot.intensity.score).toBeLessThan(0.65);

    // Single recent passed test: V = 0.6 * (1 - 10/60) = 0.5 -> tanh.
    expect(snapshot.emotion.value).toBeCloseTo(Math.tanh(0.5), 6);
    expect(snapshot.emotion.tone).toBe("POSITIVE");
    expect(snapshot.emotion.transitionModulation).toEqual({
      crossfadeMs: 2_500,
      energyBias: 0,
      hardCut: false,
    });
  });

  it("classifies a head burst followed by silence as INTENSE intensity", () => {
    const snapshot = projectPulse(burstHeadFixture, AS_OF);

    expect(snapshot.rhythm.value).toBe("STEADY");
    expect(snapshot.rhythm.score).toBe(15);
    expect(snapshot.intensity.value).toBe("INTENSE");
    expect(
      snapshot.intensity.evidence.some(
        (entry) => entry.ruleId === "intensity-intense",
      ),
    ).toBe(true);
  });

  it("keeps rhythm and intensity levels stable when only emotion events are added", () => {
    const withTrough = projectPulse(troughFixture, AS_OF);
    const withoutTrough = projectPulse(troughBaseFixture, AS_OF);

    expect(withTrough.rhythm.value).toBe("SLOW");
    expect(withoutTrough.rhythm.value).toBe("SLOW");
    expect(withTrough.rhythm.value).toBe(withoutTrough.rhythm.value);
    expect(withTrough.intensity.value).toBe(withoutTrough.intensity.value);
    expect(withTrough.intensity.value).toBe("STEADY");

    expect(withTrough.emotion.tone).toBe("NEGATIVE");
    expect(withTrough.emotion.value as number).toBeLessThan(-0.15);
    expect(withoutTrough.emotion.tone).toBe("NEUTRAL");
    expect(withoutTrough.emotion.value).toBe(0);
    expect(withTrough.emotion.transitionModulation).toEqual({
      crossfadeMs: 8_000,
      energyBias: -1,
      hardCut: false,
    });
    expect(withoutTrough.emotion.transitionModulation).toEqual({
      crossfadeMs: 3_000,
      energyBias: 0,
      hardCut: false,
    });
  });

  it("reports UNKNOWN with NO_RELEVANT_EVIDENCE for an empty window", () => {
    const snapshot = projectPulse([], AS_OF);

    expect(snapshot.rhythm.value).toBe("UNKNOWN");
    expect(snapshot.intensity.value).toBe("UNKNOWN");
    expect(snapshot.emotion.value).toBe("UNKNOWN");
    expect(snapshot.emotion.tone).toBe("UNKNOWN");
    expect(snapshot.rhythm.evidence).toEqual([]);
    expect(snapshot.intensity.evidence).toEqual([]);
    expect(snapshot.emotion.evidence).toEqual([]);
    expect(snapshot.unknownReasons).toEqual(["NO_RELEVANT_EVIDENCE"]);
    expect(snapshot.explanation.join(" ")).toContain("pulse-no-evidence");
  });

  it("excludes non-work events (session/environment) from the pulse", () => {
    const fixture = [
      record(1, "session-1", "muses.session.activity", at(-5), {
        status: "active",
      }),
      record(2, "setup-1", "muses.environment.setup", at(-4), {
        shell: "zsh",
      }),
    ];
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.rhythm.value).toBe("UNKNOWN");
    expect(snapshot.intensity.value).toBe("UNKNOWN");
    expect(snapshot.unknownReasons).toEqual(["NO_RELEVANT_EVIDENCE"]);
  });

  it("excludes events older than the 60s window and expired events", () => {
    const oldEdit = edit(1, -300);
    const expiredEdit = record(
      2,
      "edit-expired",
      "muses.editor.activity",
      at(-10),
      { action: "edit" },
      { expiresAt: at(-5) },
    );
    const snapshot = projectPulse([oldEdit, expiredEdit], AS_OF);

    expect(snapshot.rhythm.value).toBe("UNKNOWN");
    // The expired event is dropped by admission; the old (but unexpired)
    // event is outside the window yet still advances lastServerSequence.
    expect(snapshot.lastServerSequence).toBe(1);
  });

  it("covers SLOW rhythm with CALM intensity for an isolated midpoint event", () => {
    const snapshot = projectPulse(calmFixture, AS_OF);

    expect(snapshot.rhythm.value).toBe("SLOW");
    expect(snapshot.rhythm.score).toBe(1);
    expect(
      snapshot.rhythm.evidence.some(
        (entry) => entry.ruleId === "rhythm-rate-low",
      ),
    ).toBe(true);
    expect(snapshot.intensity.value).toBe("CALM");
    // Gaps [30, 30]: CV = 0, coverage = 1 - 30/60 -> 0.45 * 0.5 = 0.225.
    expect(snapshot.intensity.score).toBeCloseTo(0.225, 6);
    expect(
      snapshot.intensity.evidence.some(
        (entry) => entry.ruleId === "intensity-calm",
      ),
    ).toBe(true);
    expect(snapshot.emotion.tone).toBe("NEUTRAL");
    expect(snapshot.emotion.transitionModulation).toEqual({
      crossfadeMs: 3_000,
      energyBias: 0,
      hardCut: false,
    });
  });

  it("covers FAST rhythm with INTENSE intensity for a dense recent burst", () => {
    const snapshot = projectPulse(cramFixture, AS_OF);

    expect(snapshot.rhythm.value).toBe("FAST");
    expect(snapshot.rhythm.score).toBe(25);
    expect(snapshot.intensity.value).toBe("INTENSE");
  });

  it("weights navigate/open at 0.4 and counts review valence", () => {
    const fixture = [edit(1, -50), navigate(2, -30), reviewEvent(3, -20)];
    const snapshot = projectPulse(fixture, AS_OF);

    // 1.0 + 0.4 + 0.5 = 1.9.
    expect(snapshot.rhythm.score).toBe(1.9);
    expect(snapshot.emotion.value).toBeCloseTo(
      Math.tanh(0.2 * (1 - 20 / 60)),
      6,
    );
    expect(
      snapshot.emotion.evidence.some(
        (entry) => entry.ruleId === "valence-review",
      ),
    ).toBe(true);
  });

  it("records cancelled test runs as events without valence", () => {
    const fixture = [testEvent(1, -30, "cancelled")];
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.rhythm.score).toBe(0.5);
    expect(snapshot.emotion.value).toBe(0);
    expect(snapshot.emotion.tone).toBe("NEUTRAL");
    expect(snapshot.emotion.evidence).toEqual([]);
  });

  it("counts process started/waiting events at weight 0.5 without valence", () => {
    const fixture = [
      processEvent(1, -40, "started"),
      processEvent(2, -20, "waiting"),
    ];
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.rhythm.score).toBe(1);
    expect(snapshot.emotion.value).toBe(0);
  });

  it("counts process completed events with positive valence", () => {
    const fixture = [processEvent(1, -30, "completed")];
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.rhythm.score).toBe(0.5);
    expect(snapshot.emotion.value).toBeCloseTo(Math.tanh(0.3 * 0.5), 6);
    expect(
      snapshot.emotion.evidence.some(
        (entry) => entry.ruleId === "valence-process-completed",
      ),
    ).toBe(true);
  });
});

describe("pulse evidence chain traceability", () => {
  const cases: readonly Readonly<{
    readonly name: string;
    readonly fixture: readonly ContextEventRecord[];
  }>[] = [
    { name: "prd example", fixture: prdExampleFixture },
    { name: "head burst", fixture: burstHeadFixture },
    { name: "trough", fixture: troughFixture },
    { name: "cram", fixture: cramFixture },
  ];

  it("traces every evidence entry back to a real in-window event", () => {
    for (const item of cases) {
      const snapshot = projectPulse(item.fixture, AS_OF);
      const identities = new Set(
        item.fixture
          .filter(
            (event) =>
              Date.parse(event.occurredAt) > WINDOW_START_MS &&
              Date.parse(event.occurredAt) <= AS_OF_MS,
          )
          .map(
            (event) =>
              `${event.source}\u0000${event.id}\u0000${event.serverSequence}`,
          ),
      );

      const quantities = [
        snapshot.rhythm,
        snapshot.intensity,
        snapshot.emotion,
      ];
      for (const quantity of quantities) {
        if (quantity.value === "UNKNOWN") {
          continue;
        }
        for (const entry of quantity.evidence) {
          expect(PULSE_RULE_ID_SET.has(entry.ruleId)).toBe(true);
          if (quantity === snapshot.emotion) {
            // Emotion contributions are a signed valence ledger.
            expect(entry.contribution).not.toBe(0);
          } else {
            expect(entry.contribution).toBeGreaterThan(0);
          }
          expect(
            identities.has(
              `${entry.source}\u0000${entry.eventId}\u0000${entry.serverSequence}`,
            ),
          ).toBe(true);
          const occurredMs = Date.parse(entry.occurredAt);
          expect(occurredMs).toBeGreaterThan(WINDOW_START_MS);
          expect(occurredMs).toBeLessThanOrEqual(AS_OF_MS);
        }
      }

      for (const entry of snapshot.evidence) {
        expect(PULSE_RULE_ID_SET.has(entry.ruleId)).toBe(true);
      }
    }
  });

  it("attributes the selected rhythm and intensity level to its level rule", () => {
    const snapshots = [
      projectPulse(prdExampleFixture, AS_OF),
      projectPulse(burstHeadFixture, AS_OF),
      projectPulse(calmFixture, AS_OF),
      projectPulse(cramFixture, AS_OF),
    ];
    const rhythmRules: Record<string, string> = {
      FAST: "rhythm-rate-high",
      STEADY: "rhythm-rate-mid",
      SLOW: "rhythm-rate-low",
    };
    const intensityRules: Record<string, string> = {
      INTENSE: "intensity-intense",
      STEADY: "intensity-steady",
      CALM: "intensity-calm",
    };
    for (const snapshot of snapshots) {
      expect(
        snapshot.rhythm.evidence.some(
          (entry) => entry.ruleId === rhythmRules[snapshot.rhythm.value],
        ),
      ).toBe(true);
      expect(
        snapshot.intensity.evidence.some(
          (entry) => entry.ruleId === intensityRules[snapshot.intensity.value],
        ),
      ).toBe(true);
    }
  });

  it("isolates emotion factors from rhythm and intensity evidence (B3)", () => {
    const positive = projectPulse(
      [...troughBaseFixture, testEvent(3, -30, "passed")],
      AS_OF,
    );
    const negative = projectPulse(
      [...troughBaseFixture, testEvent(3, -30, "failed")],
      AS_OF,
    );

    expect(positive.rhythm.value).toBe(negative.rhythm.value);
    expect(positive.intensity.value).toBe(negative.intensity.value);
    expect(positive.emotion.transitionModulation).not.toEqual(
      negative.emotion.transitionModulation,
    );

    for (const snapshot of [positive, negative]) {
      for (const entry of snapshot.rhythm.evidence) {
        expect(entry.factor).toBe("rhythm");
      }
      for (const entry of snapshot.intensity.evidence) {
        expect(entry.factor).toBe("intensity");
      }
      for (const entry of snapshot.emotion.evidence) {
        expect(entry.factor).toBe("emotion");
      }
    }
  });

  it("caps each quantity's evidence at 12 entries, keeping the most recent", () => {
    const fixture = uniformEdits(30, 2_000, -59_000);
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.rhythm.evidence.length).toBe(12);
    expect(snapshot.intensity.evidence.length).toBe(12);
    const kept = snapshot.rhythm.evidence.map((entry) => entry.serverSequence);
    expect(kept).toEqual([...kept].sort((left, right) => left - right));
    expect(kept).toContain(30);
    expect(kept).not.toContain(1);
    expect(snapshot.evidence.length).toBeLessThanOrEqual(36);
  });

  it("caps emotion evidence at 12 entries", () => {
    const fixture = Array.from({ length: 20 }, (_, index) =>
      testEvent(
        index + 1,
        -59 + index * 2.5,
        index % 2 === 0 ? "passed" : "failed",
      ),
    );
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.emotion.evidence.length).toBeLessThanOrEqual(12);
  });
});

describe("pulse hysteresis", () => {
  it("retains the incumbent level inside the ±20% deadband around a boundary", () => {
    // 22 uniformly spaced edits: final rate 22 crosses the raw FAST
    // threshold (20) but not 20 * 1.2 = 24, so STEADY is retained.
    const fixture = Array.from({ length: 22 }, (_, index) =>
      edit(index + 1, (-57_000 + index * 2_700) / 1_000),
    );
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.rhythm.value).toBe("STEADY");
    expect(snapshot.rhythm.score).toBe(22);
    expect(snapshot.explanation.join(" ")).toContain("Hysteresis retained");
  });

  it("flips the level once the challenger clears the deadband", () => {
    // 25 uniformly spaced edits: rate 25 > 24 clears the FAST boundary.
    const fixture = Array.from({ length: 25 }, (_, index) =>
      edit(index + 1, (-57_600 + index * 2_400) / 1_000),
    );
    const snapshot = projectPulse(fixture, AS_OF);

    expect(snapshot.rhythm.value).toBe("FAST");
  });
});

describe("pulse determinism and replay", () => {
  it("produces identical snapshots and digests for identical inputs (C1)", () => {
    const first = projectPulse(troughFixture, AS_OF);
    const second = projectPulse(troughFixture, AS_OF);

    expect(second).toEqual(first);
    expect(second.inputDigest).toBe(first.inputDigest);
  });

  it("normalizes unordered and duplicated input into the same snapshot (C1)", () => {
    const baseline = projectPulse(prdExampleFixture, AS_OF);
    const noisy = [...prdExampleFixture]
      .reverse()
      .flatMap((event, index) => (index % 3 === 0 ? [event, event] : [event]));
    const snapshot = projectPulse(noisy, AS_OF);

    expect(snapshot.inputDigest).toBe(baseline.inputDigest);
    expect(snapshot.rhythm).toEqual(baseline.rhythm);
  });

  it("rejects conflicting duplicate identities (C1 guard)", () => {
    const conflicting = [
      edit(1, -30),
      { ...edit(1, -30), serverSequence: 7, contentHash: "hash-conflicting" },
    ];
    expect(() => projectPulse(conflicting, AS_OF)).toThrow(
      /Conflicting duplicate event identity/,
    );
  });

  it("validates asOf and maxEvents", () => {
    expect(() => projectPulse([], "not-a-timestamp")).toThrow(/asOf/);
    expect(() => projectPulse([], AS_OF, { maxEvents: 0 })).toThrow(
      /maxEvents/,
    );
    expect(() =>
      projectPulse(
        Array.from({ length: 5 }, (_, index) => edit(index + 1, -30)),
        AS_OF,
        { maxEvents: 3 },
      ),
    ).toThrow(/maximum/);
  });
});
