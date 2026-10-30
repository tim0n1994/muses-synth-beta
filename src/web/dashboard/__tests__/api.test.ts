import { describe, expect, it, vi } from "vitest";

import {
  createDashboardApiClient,
  DashboardApiError,
  parseDashboardSnapshot,
  parseEventPage,
  parseLlmTextResult,
  parseServerLlm,
} from "../api";
import {
  firstEventPageFixture,
  llmDisabledCapability,
  llmReadyCapability,
  serverSnapshotFixture,
} from "./fixtures";

// A minimal but fully valid bootstrap payload for driving `getSnapshot`
// through the real parsing pipeline without a server.
function bootstrapPayload(llm: unknown): Record<string, unknown> {
  return {
    belief: {
      state: "BUILD",
      confidence: 0.82,
      freshness: 0.9,
      factors: {},
      evidence: [],
      unknownReasons: [],
      explanation: [],
      asOf: "2026-10-19T10:00:00.000Z",
      rulesetVersion: "belief-v0.1",
    },
    decision: null,
    effect: null,
    settings: {
      currentRelease: {
        document: {
          audio: { enabled: true, masterGain: 0.35 },
          privacy: {
            localOnly: true,
            rawEventRetentionHours: 24,
            sessionHistoryRetentionDays: 30,
            excludedApplications: [],
            captureScreenContent: false,
          },
          surface: { widgets: [] },
        },
      },
    },
    ...(llm === undefined ? {} : { llm }),
  };
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("dashboard API parsing", () => {
  it("keeps transport disabled until an effect exists", async () => {
    const client = createDashboardApiClient({
      fetchImpl: vi.fn(async () => okResponse(bootstrapPayload(undefined))),
    });
    const snapshot = await client.getSnapshot(new AbortController().signal);
    expect(snapshot.audio).toMatchObject({
      status: "idle",
      canPlay: false,
      canPause: false,
      canAdjustVolume: false,
    });
  });

  it("accepts a complete server snapshot", () => {
    expect(parseDashboardSnapshot(serverSnapshotFixture)).toEqual(
      serverSnapshotFixture,
    );
  });

  it("preserves UNKNOWN and NO_ACTION as first-class server values", () => {
    const parsed = parseDashboardSnapshot({
      ...serverSnapshotFixture,
      state: {
        ...serverSnapshotFixture.state,
        code: "UNKNOWN",
        label: "Unknown",
        unknownReason: "Insufficient local evidence.",
      },
      decision: {
        ...serverSnapshotFixture.decision,
        kind: "NO_ACTION",
        noActionReason: "No safe action was justified.",
      },
    });
    expect(parsed.state?.code).toBe("UNKNOWN");
    expect(parsed.decision?.kind).toBe("NO_ACTION");
  });

  it("fails closed when a privacy payload enables cloud calls or is not local-only", () => {
    expect(() =>
      parseDashboardSnapshot({
        ...serverSnapshotFixture,
        privacy: {
          ...serverSnapshotFixture.privacy,
          cloudCallsEnabled: true,
        },
      }),
    ).toThrowError(DashboardApiError);
    expect(() =>
      parseDashboardSnapshot({
        ...serverSnapshotFixture,
        privacy: {
          ...serverSnapshotFixture.privacy,
          localOnly: false,
        },
      }),
    ).toThrowError(DashboardApiError);
  });

  it("rejects malformed cursor pages", () => {
    expect(parseEventPage(firstEventPageFixture)).toEqual(
      firstEventPageFixture,
    );
    expect(() =>
      parseEventPage({ ...firstEventPageFixture, nextCursor: 42 }),
    ).toThrowError(DashboardApiError);
    expect(() =>
      parseEventPage({
        ...firstEventPageFixture,
        nextCursor: null,
        hasMore: true,
      }),
    ).toThrowError(DashboardApiError);
  });
});

describe("optional LLM capability parsing", () => {
  it("accepts a well-formed capability section", () => {
    expect(parseServerLlm(llmReadyCapability)).toEqual(llmReadyCapability);
  });

  it("is lenient by design: missing or malformed sections yield null, never a throw", () => {
    // The divergence from the strict parsers above is deliberate: the LLM
    // layer is an optional enhancement and a broken section must hide the
    // feature instead of failing the whole bootstrap render.
    for (const malformed of [
      undefined,
      null,
      42,
      "ready",
      {},
      { ...llmReadyCapability, available: "yes" },
      { ...llmReadyCapability, reason: "exploded" },
      { ...llmReadyCapability, model: "" },
      { ...llmReadyCapability, model: "x".repeat(129) },
      { ...llmReadyCapability, enabled: null },
    ]) {
      expect(parseServerLlm(malformed)).toBeNull();
    }
  });

  it("threads the parsed capability into getSnapshot without failing the rest", async () => {
    const client = createDashboardApiClient({
      fetchImpl: vi.fn(async () =>
        okResponse(bootstrapPayload(llmReadyCapability)),
      ),
    });
    const snapshot = await client.getSnapshot(new AbortController().signal);
    expect(snapshot.llm).toEqual(llmReadyCapability);
  });

  it("keeps the dashboard fully functional when the section is absent or malformed", async () => {
    for (const llmValue of [undefined, { available: true }]) {
      const client = createDashboardApiClient({
        fetchImpl: vi.fn(async () => okResponse(bootstrapPayload(llmValue))),
      });
      const snapshot = await client.getSnapshot(new AbortController().signal);
      expect(snapshot.llm).toBeNull();
      expect(snapshot.state?.code).toBe("BUILD");
    }
  });
});

describe("LLM generation POSTs", () => {
  it("sends the narration body as a literal empty JSON object", async () => {
    // N3: the server 400s an absent application/json body, so the client
    // must actually serialize `{}` — omitting the body would break the
    // request while looking harmless in dev tools.
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      okResponse({
        text: "Calm focused work.",
        model: "auto",
        generatedAt: "2026-10-19T10:05:00.000Z",
      }),
    );
    const client = createDashboardApiClient({ fetchImpl });
    const result = await client.postLlmNarration(new AbortController().signal);

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/llm/narration");
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.body).toBe("{}");
    expect(result.text).toBe("Calm focused work.");
  });

  it("passes the summary window through in the body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      okResponse({
        text: "A steady hour.",
        model: "auto",
        generatedAt: "2026-10-19T10:05:00.000Z",
      }),
    );
    const client = createDashboardApiClient({ fetchImpl });
    await client.postLlmSummary(90, new AbortController().signal);

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/llm/summary");
    expect(call?.[1]?.body).toBe(JSON.stringify({ windowMinutes: 90 }));
  });

  it("clamps generation text to 4,000 characters independently of the server", () => {
    const parsed = parseLlmTextResult({
      text: "x".repeat(5_000),
      model: "auto",
      generatedAt: "2026-10-19T10:05:00.000Z",
    });
    expect(parsed.text).toHaveLength(4_000);
  });

  it("rejects a malformed generation result", () => {
    for (const malformed of [
      null,
      {},
      { text: "hi", model: "auto" },
      { text: "hi", model: "auto", generatedAt: "not-a-date" },
      { text: "hi", model: "", generatedAt: "2026-10-19T10:05:00.000Z" },
    ]) {
      expect(() => parseLlmTextResult(malformed)).toThrowError(
        DashboardApiError,
      );
    }
  });
});

describe("privacy disclosure follows the actual LLM posture (B4)", () => {
  it("discloses the optional gateway when it is configured and enabled", async () => {
    const client = createDashboardApiClient({
      fetchImpl: vi.fn(async () =>
        okResponse(bootstrapPayload(llmReadyCapability)),
      ),
    });
    const snapshot = await client.getSnapshot(new AbortController().signal);
    const first = snapshot.privacy?.capabilities[0];
    expect(first?.id).toBe("privacy-llm-optional");
    expect(first?.detail).toBe(
      "User-triggered, display-only; belief, decisions, and effects never use remote inference.",
    );
    // The fail-closed core-pipeline booleans are untouched in every variant.
    expect(snapshot.privacy?.cloudCallsEnabled).toBe(false);
    expect(snapshot.privacy?.apiKeysPresent).toBe(false);
  });

  it("states the pipeline-true claim when the enhancement is off", async () => {
    for (const llmValue of [undefined, llmDisabledCapability]) {
      const client = createDashboardApiClient({
        fetchImpl: vi.fn(async () => okResponse(bootstrapPayload(llmValue))),
      });
      const snapshot = await client.getSnapshot(new AbortController().signal);
      const first = snapshot.privacy?.capabilities[0];
      expect(first?.id).toBe("privacy-cloud-off");
      expect(first?.detail).toBe(
        "No remote inference is used for belief, decisions, or effects.",
      );
    }
  });
});
