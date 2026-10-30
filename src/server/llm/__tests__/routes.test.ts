import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../../settings/default-settings.js";
import type { SettingsDocument } from "../../settings/schema.js";
import {
  llmCooldown,
  llmDisabled,
  llmGatewayError,
  llmNotConfigured,
  llmTimeout,
  type LlmTextResponse,
} from "../contracts.js";
import { llmRoutes } from "../routes.js";
import { LlmService } from "../service.js";
import type { LlmGatewayClient } from "../gateway-client.js";
import { snapshotStub } from "./snapshot-stub.js";

const applications: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close()),
  );
});

const stubService = (
  overrides: {
    narrate?: () => Promise<LlmTextResponse>;
    summarize?: (
      request: Readonly<{ windowMinutes?: number }>,
    ) => Promise<LlmTextResponse>;
  } = {},
): LlmService =>
  ({
    capability: () => {
      throw new Error("not expected in these tests");
    },
    narrate:
      overrides.narrate ??
      (async () => ({
        text: "stub",
        model: "stub-model",
        generatedAt: "2026-10-19T12:00:00.000Z",
      })),
    summarize:
      overrides.summarize ??
      (async () => ({
        text: "stub",
        model: "stub-model",
        generatedAt: "2026-10-19T12:00:00.000Z",
      })),
  }) as unknown as LlmService;

const register = async (service: LlmService): Promise<FastifyInstance> => {
  const application = Fastify({ logger: false });
  applications.push(application);
  await application.register(llmRoutes, { service });
  return application;
};

describe("llm routes", () => {
  it("returns a sanitized narration for an empty-object body", async () => {
    const application = await register(
      stubService({
        narrate: async () => ({
          text: "  plain narration  ",
          model: "resolved-alias",
          generatedAt: "2026-10-19T12:00:00.000Z",
        }),
      }),
    );

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      text: "  plain narration  ",
      model: "resolved-alias",
      generatedAt: "2026-10-19T12:00:00.000Z",
    });
  });

  it("maps every domain error to its status and envelope", async () => {
    const cases: ReadonlyArray<{
      error: Error;
      statusCode: number;
      code: string;
      details?: Record<string, unknown>;
    }> = [
      {
        error: llmNotConfigured(),
        statusCode: 503,
        code: "LLM_NOT_CONFIGURED",
      },
      { error: llmDisabled(), statusCode: 503, code: "LLM_DISABLED" },
      {
        error: llmCooldown(42),
        statusCode: 503,
        code: "LLM_COOLDOWN",
        details: { retryAfterSeconds: 42 },
      },
      { error: llmTimeout(), statusCode: 504, code: "LLM_TIMEOUT" },
      {
        error: llmGatewayError(429),
        statusCode: 502,
        code: "LLM_GATEWAY_ERROR",
        details: { upstreamStatus: 429 },
      },
    ];

    for (const testCase of cases) {
      const application = await register(
        stubService({ narrate: () => Promise.reject(testCase.error) }),
      );
      const response = await application.inject({
        method: "POST",
        url: "/api/v1/llm/narration",
        headers: { "content-type": "application/json" },
        payload: {},
      });

      expect(response.statusCode).toBe(testCase.statusCode);
      const body = response.json<{
        error: { code: string; message: string; details?: unknown };
      }>();
      expect(body.error.code).toBe(testCase.code);
      expect(typeof body.error.message).toBe("string");
      expect(body.error.details).toEqual(testCase.details);
    }
  });

  it("hides unexpected failures behind a generic 500 envelope", async () => {
    const application = await register(
      stubService({
        narrate: () =>
          Promise.reject(new Error("boom http://gateway secret-key")),
      }),
    );

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("LLM_INTERNAL_ERROR");
    expect(body.error.message).not.toContain("boom");
  });

  it("requires an actual JSON body for a narration (N3)", async () => {
    const application = await register(stubService());

    // With application/json an empty body is rejected by the content parser
    // before the handler runs, so nothing can trigger a generation for free.
    const emptyBody = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(emptyBody.statusCode).toBe(400);

    const malformedBody = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: "not-json",
    });
    expect(malformedBody.statusCode).toBe(400);
  });

  it("validates the summary window bounds", async () => {
    const application = await register(stubService());

    // Fastify's default validator coerces numeric strings, so "60" is a
    // valid window; the bounds and non-numeric values are what must reject.
    for (const windowMinutes of [5, 241, null, "hour"]) {
      const response = await application.inject({
        method: "POST",
        url: "/api/v1/llm/summary",
        headers: { "content-type": "application/json" },
        payload: { windowMinutes },
      });
      expect(response.statusCode).toBe(400);
    }

    for (const windowMinutes of [15, 240, "60"]) {
      const response = await application.inject({
        method: "POST",
        url: "/api/v1/llm/summary",
        headers: { "content-type": "application/json" },
        payload: { windowMinutes },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it("runs the real service against a stub client end to end", async () => {
    let completionInput:
      | {
          model: string;
          system: string;
          user: string;
          maxTokens: number;
        }
      | undefined;
    const client = {
      complete: async (input: {
        model: string;
        system: string;
        user: string;
        maxTokens: number;
      }) => {
        completionInput = input;
        return { text: "  trimmed \n narration ", model: "resolved-alias" };
      },
      cooldownUntil: () => null,
    } as unknown as LlmGatewayClient;

    const settings: SettingsDocument = {
      ...DEFAULT_SETTINGS,
      llm: { enabled: true, model: "auto" },
    };
    let countsWindow: { since: string; until: string } | undefined;
    const fixedNow = Date.parse("2026-10-19T12:00:00.000Z");

    const service = new LlmService({
      env: {
        baseUrl: "http://gateway.internal.test:9000/v1",
        apiKey: "key-value",
        model: null,
      },
      client,
      getSettings: () => settings,
      getBelief: async () => snapshotStub(),
      getEventCounts: async (sinceIso, untilIso) => {
        countsWindow = { since: sinceIso, until: untilIso };
        return {
          total: 3,
          groups: [
            { type: "git.activity", source: "urn:muses:watch", count: 3 },
          ],
        };
      },
      now: () => fixedNow,
    });

    expect(service.capability()).toMatchObject({
      available: true,
      reason: "ready",
      model: "auto",
    });

    const application = await register(service);

    const narration = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(narration.statusCode).toBe(200);
    expect(narration.json()).toEqual({
      text: "trimmed \n narration",
      model: "resolved-alias",
      generatedAt: "2026-10-19T12:00:00.000Z",
    });
    expect(completionInput?.model).toBe("auto");
    expect(completionInput?.maxTokens).toBe(300);
    expect(completionInput?.user).toContain("state: BUILD");

    const summary = await application.inject({
      method: "POST",
      url: "/api/v1/llm/summary",
      headers: { "content-type": "application/json" },
      payload: { windowMinutes: 90 },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json<{ model: string }>().model).toBe("resolved-alias");
    expect(countsWindow).toEqual({
      since: "2026-10-19T10:30:00.000Z",
      until: "2026-10-19T12:00:00.000Z",
    });
    expect(summary.json()).toMatchObject({ text: "trimmed \n narration" });
  });

  it("passes appearance.language from settings into every prompt", async () => {
    let completionInput:
      | {
          model: string;
          system: string;
          user: string;
          maxTokens: number;
        }
      | undefined;
    const client = {
      complete: async (input: {
        model: string;
        system: string;
        user: string;
        maxTokens: number;
      }) => {
        completionInput = input;
        return { text: "localized narration", model: "resolved-alias" };
      },
      cooldownUntil: () => null,
    } as unknown as LlmGatewayClient;

    const settings: SettingsDocument = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, language: "zh" },
      llm: { enabled: true, model: "auto" },
    };

    const service = new LlmService({
      env: {
        baseUrl: "http://gateway.internal.test:9000/v1",
        apiKey: "key-value",
        model: null,
      },
      client,
      getSettings: () => settings,
      getBelief: async () => snapshotStub(),
      getEventCounts: async () => ({ total: 0, groups: [] }),
      now: () => Date.parse("2026-10-19T12:00:00.000Z"),
    });

    await service.narrate();
    expect(completionInput?.system).toContain(
      "Always answer entirely in Simplified Chinese.",
    );

    await service.summarize({ windowMinutes: 30 });
    expect(completionInput?.system).toContain(
      "Always answer entirely in Simplified Chinese.",
    );
  });

  it("surfaces the gate order through the real service", async () => {
    const client = {
      complete: async () => {
        throw new Error("the stub client must never be called");
      },
      cooldownUntil: () => null,
    } as unknown as LlmGatewayClient;

    const unconfigured = new LlmService({
      env: null,
      client: null,
      getSettings: () => DEFAULT_SETTINGS,
      getBelief: async () => snapshotStub(),
      getEventCounts: async () => ({ total: 0, groups: [] }),
    });
    const appUnconfigured = await register(unconfigured);
    const responseUnconfigured = await appUnconfigured.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(responseUnconfigured.statusCode).toBe(503);
    expect(
      responseUnconfigured.json<{ error: { code: string } }>().error.code,
    ).toBe("LLM_NOT_CONFIGURED");

    const disabled = new LlmService({
      env: {
        baseUrl: "http://gateway.internal.test:9000/v1",
        apiKey: "key-value",
        model: null,
      },
      client,
      getSettings: () => DEFAULT_SETTINGS,
      getBelief: async () => snapshotStub(),
      getEventCounts: async () => ({ total: 0, groups: [] }),
    });
    const appDisabled = await register(disabled);
    const responseDisabled = await appDisabled.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(responseDisabled.statusCode).toBe(503);
    expect(
      responseDisabled.json<{ error: { code: string } }>().error.code,
    ).toBe("LLM_DISABLED");
  });
});
