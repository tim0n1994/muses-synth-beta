import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../../settings/default-settings.js";
import type { SettingsDocument } from "../../settings/schema.js";
import { LlmGatewayClient } from "../gateway-client.js";
import type {
  LlmFetch,
  LlmFetchInit,
  LlmFetchResponse,
} from "../gateway-client.js";
import { llmRoutes } from "../routes.js";
import { LlmService } from "../service.js";
import { snapshotStub } from "./snapshot-stub.js";
import type { PublicUser } from "../../auth/types.js";

const applications: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map(async (application) => application.close()),
  );
});

const jsonResponse = (body: unknown): LlmFetchResponse => ({
  ok: true,
  status: 200,
  json: async () => body,
});

/**
 * Builds a real LlmService whose gateway posts to an in-memory fetch, so the
 * exact prompt text (including the language instruction) can be asserted.
 */
const createCapturingService = (): {
  readonly service: LlmService;
  readonly bodies: string[];
} => {
  const bodies: string[] = [];
  const fetchImpl: LlmFetch = async (
    _url: string,
    init: LlmFetchInit,
  ): Promise<LlmFetchResponse> => {
    bodies.push(init.body);
    return jsonResponse({
      choices: [{ message: { content: "plain narration text" } }],
      model: "resolved-alias",
    });
  };
  const client = new LlmGatewayClient({
    baseUrl: "http://gateway.internal.test:9000/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  const settings: SettingsDocument = {
    ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, enabled: true },
  };
  const service = new LlmService({
    env: {
      baseUrl: "http://gateway.internal.test:9000/v1",
      apiKey: "test-key",
      model: "test-model",
    },
    client,
    getSettings: () => settings,
    getBelief: async () => snapshotStub(),
    getEventCounts: async () => ({ total: 0, groups: [] }),
  });
  return { service, bodies };
};

const user = (id: string): PublicUser => ({
  id,
  email: `${id}@example.com`,
  displayName: id,
  createdAt: "2026-10-19T00:00:00.000Z",
  subscription: "free",
  role: "user",
  emailVerified: true,
  isActive: true,
  settings: {},
});

const registerFor = async (
  service: LlmService,
  userId: string,
  resolveUserLanguage:
    ((userId: string) => "zh" | "en" | undefined) | undefined,
): Promise<FastifyInstance> => {
  const application = Fastify({ logger: false });
  applications.push(application);
  // Stands in for the auth gate: attaches the authenticated user the routes
  // scope reads and language resolution key on.
  application.addHook("onRequest", async (request) => {
    request.user = user(userId);
  });
  await application.register(llmRoutes, {
    service,
    ...(resolveUserLanguage === undefined ? {} : { resolveUserLanguage }),
  });
  return application;
};

describe("llm per-user narration language", () => {
  it("prefers the user's configured language over the global settings default", async () => {
    const { service, bodies } = createCapturingService();
    const application = await registerFor(service, "user-zh", (userId) =>
      userId === "user-zh" ? "zh" : undefined,
    );

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Always answer entirely in Simplified Chinese");
  });

  it("falls back to the global settings language when the user set none", async () => {
    const { service, bodies } = createCapturingService();
    // Resolver reports "no explicit preference" for this user.
    const application = await registerFor(service, "user-en", () => undefined);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    // The published settings document's appearance.language is "en".
    expect(bodies[0]).toContain("Always answer entirely in English");
  });

  it("applies the same per-user language to summaries", async () => {
    const { service, bodies } = createCapturingService();
    const application = await registerFor(service, "user-zh", () => "zh");

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/llm/summary",
      headers: { "content-type": "application/json" },
      payload: { windowMinutes: 30 },
    });

    expect(response.statusCode).toBe(200);
    expect(bodies[0]).toContain("Always answer entirely in Simplified Chinese");
  });

  it("uses the global language when no resolver is wired (local mode)", async () => {
    const { service, bodies } = createCapturingService();
    const application = await registerFor(service, "local-user", undefined);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/llm/narration",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(bodies[0]).toContain("Always answer entirely in English");
  });
});
