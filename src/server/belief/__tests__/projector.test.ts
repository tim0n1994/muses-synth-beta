import { describe, expect, it } from "vitest";
import { projectBelief } from "../projector.js";
import {
  conflictingTestsFixture,
  failingTestFixture,
  record,
  recoveredReviewFixture,
  sustainedEditingFixture,
} from "../__fixtures__/replay-fixtures.js";

describe("deterministic belief projection", () => {
  it("selects BUILD for sustained editing", () => {
    const snapshot = projectBelief(
      sustainedEditingFixture,
      "2026-07-30T00:04:00.000Z",
    );

    expect(snapshot.state).toBe("BUILD");
    expect(snapshot.factors.attention.value).toBe("DEEP");
    expect(
      snapshot.evidence.some((entry) => entry.ruleId === "sustained-editing"),
    ).toBe(true);
  });

  it("selects DEBUG for a latest failing test", () => {
    const snapshot = projectBelief(
      failingTestFixture,
      "2026-07-30T00:05:00.000Z",
    );

    expect(snapshot.state).toBe("DEBUG");
    expect(snapshot.factors.outcome.value).toBe("FAILURE");
    expect(snapshot.explanation.join(" ")).toContain(
      "latest fresh test run failed",
    );
  });

  it("reinforces BUILD for sustained editing with repeated successful tests", () => {
    const snapshot = projectBelief(
      [
        ...sustainedEditingFixture,
        record(
          4,
          "test-pass-1",
          "muses.test.run.completed",
          "2026-07-30T00:04:10.000Z",
          {
            status: "passed",
          },
        ),
        record(
          5,
          "test-pass-2",
          "muses.test.run.completed",
          "2026-07-30T00:04:30.000Z",
          {
            status: "passed",
          },
        ),
      ],
      "2026-07-30T00:04:30.000Z",
    );

    expect(snapshot.state).toBe("BUILD");
    expect(snapshot.factors.outcome.value).toBe("SUCCESS");
    expect(
      snapshot.evidence.some(
        (entry) => entry.ruleId === "sustained-editing-and-success",
      ),
    ).toBe(true);
  });

  it("transitions to REVIEW after recovery and explicit review activity", () => {
    const snapshot = projectBelief(
      recoveredReviewFixture,
      "2026-07-30T00:09:00.000Z",
    );

    expect(snapshot.state).toBe("REVIEW");
    expect(snapshot.factors.outcome.value).toBe("SUCCESS");
    expect(snapshot.factors.workMode.value).toBe("REVIEWING");
  });

  it("makes conflicting pass/fail evidence UNKNOWN", () => {
    const snapshot = projectBelief(
      conflictingTestsFixture,
      "2026-07-30T01:01:00.000Z",
    );

    expect(snapshot.state).toBe("UNKNOWN");
    expect(snapshot.factors.outcome.value).toBe("MIXED");
    expect(snapshot.unknownReasons).toContain("CONFLICTING_TEST_RESULTS");
  });

  it("moves from active work to WAIT and BREAK as evidence ages", () => {
    const wait = projectBelief(
      sustainedEditingFixture,
      "2026-07-30T00:12:00.000Z",
    );
    const breakState = projectBelief(
      sustainedEditingFixture,
      "2026-07-30T00:22:00.000Z",
    );

    expect(wait.state).toBe("WAIT");
    expect(breakState.state).toBe("BREAK");
    expect(breakState.factors.activity.value).toBe("INACTIVE");
  });

  it("returns UNKNOWN when all recognized evidence is stale", () => {
    const snapshot = projectBelief(
      sustainedEditingFixture,
      "2026-07-30T00:40:00.000Z",
    );

    expect(snapshot.state).toBe("UNKNOWN");
    expect(snapshot.unknownReasons).toContain("STALE_EVIDENCE");
    expect(snapshot.freshness).toBe(0);
  });

  it("ignores expired evidence during replay", () => {
    const expiredFailure = record(
      4,
      "expired-fail",
      "muses.test.run.completed",
      "2026-07-30T00:05:00.000Z",
      { status: "failed" },
      { expiresAt: "2026-07-30T00:05:30.000Z" },
    );
    const snapshot = projectBelief(
      [...sustainedEditingFixture, expiredFailure],
      "2026-07-30T00:06:00.000Z",
    );

    expect(snapshot.state).not.toBe("DEBUG");
    expect(
      snapshot.evidence.some((entry) => entry.eventId === "expired-fail"),
    ).toBe(false);
  });

  it("deduplicates source/id and replays out-of-order input deterministically", () => {
    const duplicate = {
      ...sustainedEditingFixture[0],
      serverSequence: 99,
      contentHash: sustainedEditingFixture[0].contentHash,
    };
    const shuffled = [
      sustainedEditingFixture[2],
      duplicate,
      sustainedEditingFixture[1],
      sustainedEditingFixture[0],
    ];
    const ordered = projectBelief(
      sustainedEditingFixture,
      "2026-07-30T00:04:00.000Z",
    );
    const replayed = projectBelief(shuffled, "2026-07-30T00:04:00.000Z");

    expect(replayed.state).toBe(ordered.state);
    expect(replayed.inputDigest).toBe(ordered.inputDigest);
    expect(
      replayed.evidence.filter((entry) => entry.eventId === "edit-1").length,
    ).toBeGreaterThan(0);
    expect(
      new Set(
        replayed.evidence
          .filter((entry) => entry.eventId === "edit-1")
          .map((entry) => entry.serverSequence),
      ),
    ).toEqual(new Set([1]));
  });

  it("fails safely on a corrupt duplicate identity with different content", () => {
    const corruptDuplicate = {
      ...sustainedEditingFixture[0],
      serverSequence: 99,
      contentHash: "different-content",
    };

    expect(() =>
      projectBelief(
        [...sustainedEditingFixture, corruptDuplicate],
        "2026-07-30T00:04:00.000Z",
      ),
    ).toThrow("Conflicting duplicate event identity");
  });

  it("uses an explicit inactive signal as stronger evidence than recent edits", () => {
    const snapshot = projectBelief(
      [
        ...sustainedEditingFixture,
        record(
          4,
          "inactive",
          "muses.session.activity",
          "2026-07-30T00:04:30.000Z",
          {
            status: "inactive",
          },
        ),
      ],
      "2026-07-30T00:04:30.000Z",
    );

    expect(snapshot.state).toBe("BREAK");
    expect(snapshot.factors.activity.value).toBe("INACTIVE");
  });
});
