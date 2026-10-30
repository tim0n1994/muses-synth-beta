import { describe, expect, it } from "vitest";

import modelSource from "./model.ts?raw";
import templatesSource from "./templates.ts?raw";
import { resolveSignature } from "./model.js";
import {
  createMemoryFeedbackJournal,
  type SignatureFeedbackEvent,
} from "./calibration-journal.js";

function events(
  journal: ReturnType<typeof createMemoryFeedbackJournal>,
): readonly SignatureFeedbackEvent[] {
  return journal.exportEntries();
}

describe("feedback journal (V9: record-only, never used for learning)", () => {
  it("records skip and relisten events with timestamps", () => {
    const journal = createMemoryFeedbackJournal();
    journal.record({
      kind: "skip",
      trackId: "t-1",
      occurredAt: "2026-10-20T09:00:00.000Z",
    });
    journal.record({
      kind: "relisten",
      trackId: "t-2",
      occurredAt: "2026-10-20T09:05:00.000Z",
    });
    journal.record({
      kind: "skip",
      trackId: "t-1",
      occurredAt: "2026-10-20T09:10:00.000Z",
    });
    expect(events(journal)).toHaveLength(3);
    expect(events(journal)[0]).toEqual({
      kind: "skip",
      trackId: "t-1",
      occurredAt: "2026-10-20T09:00:00.000Z",
    });
  });

  it("exposes entries read-only (exported copies, append-only)", () => {
    const journal = createMemoryFeedbackJournal();
    journal.record({ kind: "skip", trackId: "t-1", occurredAt: "x" });
    const first = events(journal);
    (first as SignatureFeedbackEvent[]).pop();
    expect(events(journal)).toHaveLength(1);
  });

  it("never changes calibration output, no matter how many events pile up", () => {
    const before = resolveSignature("minimalElectronic", {
      bpmRange: { min: 120, max: 140 },
    });
    const journal = createMemoryFeedbackJournal();
    for (let i = 0; i < 50; i += 1) {
      journal.record({
        kind: i % 2 === 0 ? "skip" : "relisten",
        trackId: `t-${i % 5}`,
        occurredAt: new Date(i).toISOString(),
      });
    }
    const after = resolveSignature("minimalElectronic", {
      bpmRange: { min: 120, max: 140 },
    });
    expect(after).toEqual(before);
  });

  it("is structurally impossible to learn from: the model never imports the journal", () => {
    expect(modelSource).not.toContain("calibration-journal");
    expect(modelSource).not.toContain("FeedbackJournal");
    expect(templatesSource).not.toContain("calibration-journal");
  });
});
