import { describe, expect, it } from "vitest";

import type { BeliefSnapshot } from "../../belief/model.js";
import type { LlmSummaryCounts } from "../contracts.js";
import {
  buildNarrationPrompt,
  buildSummaryPrompt,
  sanitizePromptToken,
} from "../prompt.js";

const evidenceEntry = (
  overrides: Partial<BeliefSnapshot["evidence"][number]> = {},
): BeliefSnapshot["evidence"][number] => ({
  ruleId: "rule.git-daily-commit",
  source: "urn:muses:watch",
  eventId: "evt-secret-42",
  serverSequence: 7,
  occurredAt: "2026-10-19T10:59:00.000Z",
  contribution: 0.32,
  factor: "workMode",
  ...overrides,
});

const snapshotFixture = (
  overrides: Partial<BeliefSnapshot> = {},
): BeliefSnapshot => ({
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
    attention: { value: "DEEP", confidence: 0.8, freshness: 0.7, evidence: [] },
  },
  evidence: [
    evidenceEntry(),
    evidenceEntry({
      ruleId: "rule.editor-burst",
      source: "git.activity",
      eventId: "evt-2",
      serverSequence: 9,
      occurredAt: "2026-10-19T10:55:00.000Z",
      contribution: 0.21,
      factor: "state",
    }),
  ],
  unknownReasons: [],
  explanation: ["Sustained editing activity suggests focused implementation."],
  asOf: "2026-10-19T11:00:00.000Z",
  rulesetVersion: "muses-belief-rules/0.1.0",
  inputDigest: "sha256-secret-digest",
  lastServerSequence: 9,
  ...overrides,
});

describe("sanitizePromptToken", () => {
  it("passes well-formed identifiers through unchanged", () => {
    expect(sanitizePromptToken("urn:muses:watch")).toBe("urn:muses:watch");
    expect(sanitizePromptToken("git.activity")).toBe("git.activity");
    expect(sanitizePromptToken("BUILD")).toBe("BUILD");
    expect(sanitizePromptToken("vendor/model-v2")).toBe("vendor/model-v2");
    expect(sanitizePromptToken("a".repeat(64))).toBe("a".repeat(64));
    expect(sanitizePromptToken("  padded  ")).toBe("padded");
  });

  it("replaces path-shaped and hostile tokens with the literal other", () => {
    const hostile = [
      "/Users/alice/secret",
      "./config",
      "../../etc/passwd",
      "C:\\Users\\bob\\keys",
      "C:/Users/bob",
      "..hidden",
      "a..b",
      "has space",
      'has"quote',
      "has\\backslash",
      "has\tcontrol",
      "x".repeat(65),
      "",
      "   ",
      "héllo-unicode",
    ];
    for (const value of hostile) {
      expect(sanitizePromptToken(value)).toBe("other");
    }
  });
});

describe("buildNarrationPrompt", () => {
  it("includes every whitelisted field and excludes everything else", () => {
    const prompt = buildNarrationPrompt(snapshotFixture());
    const user = prompt.user;

    // Whitelisted projections of the snapshot.
    expect(user).toContain("state: BUILD");
    expect(user).toContain("Flow"); // BELIEF_VOCABULARY label
    expect(user).toContain("Sustained implementation."); // vocabulary description
    expect(user).toContain("confidence: 0.82");
    expect(user).toContain("freshness: 0.64");
    expect(user).toContain("BUILD: 0.61");
    expect(user).toContain("activity: ACTIVE");
    expect(user).toContain("workMode: EDITING");
    expect(user).toContain("outcome: SUCCESS");
    expect(user).toContain("attention: DEEP");
    expect(user).toContain("rule=rule.git-daily-commit");
    expect(user).toContain("source=urn:muses:watch");
    expect(user).toContain("contribution=0.32");
    expect(user).toContain("asOf: 2026-10-19T11:00:00.000Z");
    expect(user).toContain("rulesetVersion: muses-belief-rules/0.1.0");
    expect(user).toContain(
      "Sustained editing activity suggests focused implementation.",
    );

    // Excluded by the whitelist: identifiers, digests, sequence numbers, and
    // anything a payload or subject could carry (they have no code path in).
    expect(user).not.toContain("evt-secret-42");
    expect(user).not.toContain("sha256-secret-digest");
    expect(user).not.toContain("serverSequence");
    expect(prompt.system).toContain("plain text");
  });

  it("caps the distribution at five entries", () => {
    const user = buildNarrationPrompt(snapshotFixture()).user;
    expect(user).toContain("BUILD: 0.61");
    expect(user).not.toContain("SETUP: 0.01");
  });

  it("replaces path-shaped evidence sources with other and never echoes them", () => {
    const malicious = [
      "/Users/alice/secret",
      "C:\\Users\\bob\\keys",
      "../../etc/passwd",
      "x".repeat(80),
      'quote"and space',
      "back\\slash",
    ];
    const snapshot = snapshotFixture({
      evidence: malicious.map((source, index) =>
        evidenceEntry({
          source,
          eventId: `evt-${index}`,
          serverSequence: index + 1,
        }),
      ),
    });

    const user = buildNarrationPrompt(snapshot).user;

    for (const source of malicious) {
      expect(user).not.toContain(source);
    }
    expect(user.match(/source=other/g)).toHaveLength(malicious.length);
    // Positive control: well-formed labels survive next to the replacements.
    const clean = buildNarrationPrompt(snapshotFixture()).user;
    expect(clean).toContain("source=urn:muses:watch");
    expect(clean).toContain("source=git.activity");
  });

  it("strips control characters and clamps explanation entries", () => {
    const longExplanation = "e".repeat(300);
    const snapshot = snapshotFixture({
      explanation: [
        "clean sentence",
        "con\u0007trol\u0000chars\u0007stripped",
        longExplanation,
        "",
        "   ",
      ],
    });

    const user = buildNarrationPrompt(snapshot).user;

    expect(user).toContain("clean sentence");
    expect(user).toContain("controlcharsstripped");
    expect(user).not.toContain("\u0007");
    expect(user).not.toContain("\u0000");
    // Clamped to 200 characters, not 300.
    expect(user).toContain("e".repeat(200));
    expect(user).not.toContain("e".repeat(201));
  });

  it("keeps at most eight explanation entries and twelve evidence entries", () => {
    const snapshot = snapshotFixture({
      evidence: Array.from({ length: 30 }, (_, index) =>
        evidenceEntry({
          eventId: `evt-${index}`,
          serverSequence: index + 1,
          ruleId: `rule.number-${index + 1}`,
        }),
      ),
      explanation: Array.from(
        { length: 10 },
        (_, index) => `line ${index + 1}`,
      ),
    });

    const user = buildNarrationPrompt(snapshot).user;

    expect(user.match(/rule=rule\.number-/g)).toHaveLength(12);
    expect(user).toContain("line 8");
    expect(user).not.toContain("line 9");
    expect(user).not.toContain("line 10");
  });
});

describe("buildSummaryPrompt", () => {
  const counts = (
    overrides: Partial<LlmSummaryCounts> = {},
  ): LlmSummaryCounts => ({
    windowMinutes: 60,
    total: 12,
    groups: [
      { type: "muses.editor.activity", source: "urn:muses:watch", count: 7 },
      { type: "muses.git.commit", source: "git.activity", count: 5 },
    ],
    ...overrides,
  });

  it("includes the window, total and sanitized group labels", () => {
    const prompt = buildSummaryPrompt(snapshotFixture(), counts());
    const user = prompt.user;

    expect(user).toContain("last 60 minutes");
    expect(user).toContain("total: 12");
    expect(user).toContain(
      "type=muses.editor.activity source=urn:muses:watch count=7",
    );
    expect(user).toContain("type=muses.git.commit source=git.activity count=5");
    expect(prompt.system).toContain("at most 10 sentences");
  });

  it("replaces hostile group labels with other, keeps the counts", () => {
    const hostileTypes = ["/Users/alice/secret", "C:\\Users\\bob\\keys"];
    const hostileSources = ["../../etc/passwd", "x".repeat(90)];
    const groups = [
      ...hostileTypes.map((type, index) => ({
        type,
        source: "urn:muses:watch",
        count: index + 1,
      })),
      ...hostileSources.map((source, index) => ({
        type: "git.activity",
        source,
        count: index + 10,
      })),
      { type: "git.activity", source: "urn:muses:watch", count: 3 },
    ];
    const user = buildSummaryPrompt(
      snapshotFixture(),
      counts({ groups, total: 27 }),
    ).user;

    for (const hostile of [...hostileTypes, ...hostileSources]) {
      expect(user).not.toContain(hostile);
    }
    expect(user.match(/type=other/g)).toHaveLength(2);
    expect(user.match(/source=other/g)).toHaveLength(2);
    // Counts survive label replacement.
    expect(user).toContain("count=1");
    expect(user).toContain("count=11");
    expect(user).toContain("total: 27");
    // Positive control.
    expect(user).toContain("type=git.activity source=urn:muses:watch count=3");
  });

  it("fits the 8000-character budget by cutting evidence before explanation", () => {
    // Big enough that evidence must shrink, small enough that the tail never
    // gets hard-truncated: 50 group lines of ~113 characters plus 12 fat
    // evidence entries overshoot 8000 by roughly 800 characters.
    const longToken = "a".repeat(45);
    const groups = Array.from({ length: 50 }, (_, index) => ({
      type: `${longToken}${index}`.slice(0, 45),
      source: `${"b".repeat(45)}${index}`.slice(0, 45),
      count: index + 1,
    }));
    const snapshot = snapshotFixture({
      evidence: Array.from({ length: 12 }, (_, index) =>
        evidenceEntry({
          ruleId: `rule.cut-${"c".repeat(50)}-${index}`.slice(0, 64),
          eventId: `evt-${index}`,
          serverSequence: index + 1,
        }),
      ),
      explanation: ["explanation that must survive the budget cut"],
    });

    const prompt = buildSummaryPrompt(snapshot, counts({ groups, total: 500 }));
    const user = prompt.user;

    expect(prompt.system.length + user.length).toBeLessThanOrEqual(8_000);
    // Evidence absorbed the cut (some, but not all, entries remain)...
    const evidenceLines = user.match(/rule=rule\.cut-/g) ?? [];
    expect(evidenceLines.length).toBeGreaterThan(0);
    expect(evidenceLines.length).toBeLessThan(12);
    // ...while explanation survived and the closing task sentence proves the
    // tail was never hard-truncated (all 50 group lines are intact).
    expect(user).toContain("explanation that must survive the budget cut");
    expect(user).toContain("Summarize the recent window");
    expect(user.match(/count=/g)).toHaveLength(50);
  });
});

describe("language instruction", () => {
  const counts = (): LlmSummaryCounts => ({
    windowMinutes: 60,
    total: 12,
    groups: [
      { type: "muses.editor.activity", source: "urn:muses:watch", count: 7 },
      { type: "muses.git.commit", source: "git.activity", count: 5 },
    ],
  });

  it("appends the answer-in instruction for every supported language", () => {
    expect(buildNarrationPrompt(snapshotFixture(), "zh").system).toContain(
      "Always answer entirely in Simplified Chinese.",
    );
    expect(buildNarrationPrompt(snapshotFixture(), "ja").system).toContain(
      "Always answer entirely in Japanese.",
    );
    expect(
      buildSummaryPrompt(snapshotFixture(), counts(), "fr").system,
    ).toContain("Always answer entirely in French.");
    expect(
      buildSummaryPrompt(snapshotFixture(), counts(), "es").system,
    ).toContain("Always answer entirely in Spanish.");
  });

  it("states English explicitly for the default language", () => {
    expect(buildNarrationPrompt(snapshotFixture()).system).toContain(
      "Always answer entirely in English.",
    );
    expect(buildSummaryPrompt(snapshotFixture(), counts()).system).toContain(
      "Always answer entirely in English.",
    );
  });

  it("appends the instruction after the intact base prompt", () => {
    const system = buildNarrationPrompt(snapshotFixture(), "es").system;
    expect(system).toContain("plain text only");
    expect(system.endsWith("Always answer entirely in Spanish.")).toBe(true);
  });
});
