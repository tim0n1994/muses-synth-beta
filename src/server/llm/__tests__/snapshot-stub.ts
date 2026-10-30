import type { BeliefSnapshot } from "../../belief/model.js";

/**
 * Minimal valid belief snapshot for LLM route/service tests. The values are
 * chosen so the narration prompt contains recognizable markers ("BUILD",
 * "Flow") without depending on the projector.
 */
export const snapshotStub = (): BeliefSnapshot => ({
  state: "BUILD",
  confidence: 0.82,
  freshness: 0.64,
  distribution: {
    SETUP: 0.01,
    EXPLORE: 0.12,
    BUILD: 0.61,
    DEBUG: 0.08,
    REVIEW: 0.05,
    WAIT: 0.07,
    BREAK: 0.03,
    UNKNOWN: 0.03,
  },
  factors: {
    activity: {
      value: "ACTIVE",
      confidence: 0.9,
      freshness: 0.8,
      evidence: [],
    },
    workMode: {
      value: "EDITING",
      confidence: 0.7,
      freshness: 0.6,
      evidence: [],
    },
    outcome: {
      value: "SUCCESS",
      confidence: 0.5,
      freshness: 0.4,
      evidence: [],
    },
    attention: {
      value: "DEEP",
      confidence: 0.8,
      freshness: 0.7,
      evidence: [],
    },
  },
  evidence: [
    {
      ruleId: "rule.git-daily-commit",
      source: "urn:muses:watch",
      eventId: "evt-1",
      serverSequence: 7,
      occurredAt: "2026-10-19T11:59:00.000Z",
      contribution: 0.32,
      factor: "workMode",
    },
  ],
  unknownReasons: [],
  explanation: ["Sustained editing activity suggests focused implementation."],
  asOf: "2026-10-19T12:00:00.000Z",
  rulesetVersion: "muses-belief-rules/0.1.0",
  inputDigest: "sha256-stub",
  lastServerSequence: 7,
});
