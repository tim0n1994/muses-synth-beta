import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LlmDomainError } from "../contracts.js";
import {
  LlmGatewayClient,
  type LlmFetch,
  type LlmFetchInit,
  type LlmFetchResponse,
  type LlmGatewayLogFields,
} from "../gateway-client.js";

const BASE_URL = "http://gateway.internal.test:9000/v1";
const API_KEY = "test-key-do-not-log";

const jsonResponse = (body: unknown, status = 200): LlmFetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const completionBody = (
  content: unknown,
  model = "resolved-alias",
): unknown => ({
  choices: [{ message: { content } }],
  model,
});

const input = {
  model: "auto",
  system: "system prompt",
  user: "user prompt",
  maxTokens: 300,
};

describe("LlmGatewayClient", () => {
  let nowMs: number;

  beforeEach(() => {
    nowMs = Date.parse("2026-10-19T12:00:00.000Z");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const now = (): number => nowMs;

  const createClient = (
    fetchImpl: LlmFetch,
    options: Partial<ConstructorParameters<typeof LlmGatewayClient>[0]> = {},
  ): LlmGatewayClient =>
    new LlmGatewayClient({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl,
      now,
      cooldownMs: 300_000,
      ...options,
    });

  it("completes with string content and posts the expected request", async () => {
    const calls: LlmFetchInit[] = [];
    const client = createClient(async (url, init) => {
      expect(url).toBe(`${BASE_URL}/chat/completions`);
      calls.push(init);
      return jsonResponse(completionBody("plain answer"));
    });

    const result = await client.complete(input);

    expect(result).toEqual({ text: "plain answer", model: "resolved-alias" });
    expect(calls).toHaveLength(1);
    const init = calls[0];
    if (init === undefined) {
      throw new Error("expected a fetch call");
    }
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body) as {
      model: string;
      stream: boolean;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("auto");
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(300);
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
  });

  it("joins segmented content arrays and keeps the requested alias when the gateway omits model", async () => {
    // No `model` key in the body on purpose: the gateway resolved the alias
    // silently and the requested alias must survive to the UI.
    const client = createClient(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "first " },
                { type: "text", text: "second" },
              ],
            },
          },
        ],
      }),
    );

    const result = await client.complete(input);
    expect(result).toEqual({ text: "first second", model: "auto" });
  });

  it("retries a 403 once, succeeds, and does not arm the breaker", async () => {
    let mode: "rotated" | "fail" | "ok" = "rotated";
    const calls: number[] = [];
    const client = createClient(async () => {
      calls.push(1);
      if (mode === "rotated") {
        mode = "ok";
        return jsonResponse({}, 403);
      }
      if (mode === "fail") {
        return jsonResponse({}, 500);
      }
      return jsonResponse(completionBody("after rotation"));
    });

    await expect(client.complete(input)).resolves.toEqual({
      text: "after rotation",
      model: "resolved-alias",
    });
    expect(calls).toHaveLength(2);

    // The 403-then-success pair counts as zero failures: a single later 500
    // leaves the client out of cooldown.
    mode = "fail";
    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_GATEWAY_ERROR",
    });
    expect(client.cooldownUntil()).toBeNull();
  });

  it("retries a 429 once, then fails with the upstream status", async () => {
    const fetchImpl = vi.fn<LlmFetch>(async () => jsonResponse({}, 429));
    const client = createClient(fetchImpl);

    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_GATEWAY_ERROR",
      statusCode: 502,
      details: { upstreamStatus: 429 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry 5xx responses", async () => {
    const fetchImpl = vi.fn<LlmFetch>(async () => jsonResponse({}, 503));
    const client = createClient(fetchImpl);

    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_GATEWAY_ERROR",
      details: { upstreamStatus: 503 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a network-layer rejection once and reports unavailability if it persists", async () => {
    const fetchImpl = vi
      .fn<LlmFetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = createClient(fetchImpl);

    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_GATEWAY_UNAVAILABLE",
      statusCode: 502,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats an unusable 2xx body as LLM_INVALID_RESPONSE without retry or breaker", async () => {
    const fetchImpl = vi.fn<LlmFetch>(async () =>
      jsonResponse({ choices: [] }),
    );
    const client = createClient(fetchImpl);

    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_INVALID_RESPONSE",
      statusCode: 502,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Invalid shapes never count toward the circuit: after two of them the
    // client still attempts another call instead of cooling down.
    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_INVALID_RESPONSE",
    });
    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_INVALID_RESPONSE",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("times out without retrying and raises a sub-minute timeout to 60s", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<LlmFetch>(
      () => new Promise<LlmFetchResponse>(() => undefined),
    );
    const client = createClient(fetchImpl, { timeoutMs: 1_000 });

    const assertion = expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_TIMEOUT",
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1); // timeout never retries
  });

  it("enters cooldown after two consecutive failures and sends nothing while cooling", async () => {
    const fetchImpl = vi.fn<LlmFetch>(async () => jsonResponse({}, 500));
    const client = createClient(fetchImpl);

    await expect(client.complete(input)).rejects.toBeInstanceOf(LlmDomainError);
    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_GATEWAY_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const cooldownUntil = client.cooldownUntil();
    expect(cooldownUntil).toBe(nowMs + 300_000);

    // Third call fails fast: zero additional fetch calls, LLM_COOLDOWN.
    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_COOLDOWN",
      statusCode: 503,
      details: { retryAfterSeconds: 300 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // The getter is read-only: repeated calls neither reset nor change state.
    expect(client.cooldownUntil()).toBe(cooldownUntil);
    expect(client.cooldownUntil()).toBe(cooldownUntil);
  });

  it("recovers when the cooldown expires and resets the breaker on success", async () => {
    let status = 500;
    const fetchImpl = vi.fn<LlmFetch>(async () =>
      status === 200
        ? jsonResponse(completionBody("recovered"))
        : jsonResponse({}, status),
    );
    const client = createClient(fetchImpl);

    await expect(client.complete(input)).rejects.toBeInstanceOf(LlmDomainError);
    await expect(client.complete(input)).rejects.toBeInstanceOf(LlmDomainError);
    expect(client.cooldownUntil()).not.toBeNull();

    nowMs += 300_001; // cooldown expired
    status = 200;
    await expect(client.complete(input)).resolves.toMatchObject({
      text: "recovered",
    });
    expect(client.cooldownUntil()).toBeNull();

    // Counter cleared: two fresh failures are needed before the next cooldown.
    status = 500;
    await expect(client.complete(input)).rejects.toBeInstanceOf(LlmDomainError);
    expect(client.cooldownUntil()).toBeNull();
  });

  it("keeps at most maxConcurrency requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    let completedFetches = 0;
    const released: Array<() => void> = [];
    const fetchImpl = vi.fn<LlmFetch>(
      () =>
        new Promise<LlmFetchResponse>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          released.push(() => {
            inFlight -= 1;
            completedFetches += 1;
            resolve(jsonResponse(completionBody("ok")));
          });
        }),
    );
    const client = createClient(fetchImpl);

    const pending = Array.from({ length: 5 }, () =>
      expect(client.complete(input)).resolves.toMatchObject({ text: "ok" }),
    );
    while (completedFetches < 5) {
      await vi.waitFor(() => {
        expect(released.length).toBeGreaterThan(0);
      });
      for (const release of released.splice(0)) {
        release();
      }
    }
    await Promise.all(pending);

    expect(peak).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("never exposes the key or URL through the log hook", async () => {
    const events: LlmGatewayLogFields[] = [];
    const fetchImpl = vi.fn<LlmFetch>(async () => jsonResponse({}, 500));
    const client = createClient(fetchImpl, {
      log: (fields) => {
        events.push(fields);
      },
    });

    await expect(client.complete(input)).rejects.toBeInstanceOf(LlmDomainError);
    await expect(client.complete(input)).rejects.toBeInstanceOf(LlmDomainError);
    await expect(client.complete(input)).rejects.toMatchObject({
      code: "LLM_COOLDOWN",
    });

    expect(events).toHaveLength(3);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(BASE_URL);
    expect(serialized).not.toContain("authorization");
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual([
        "durationMs",
        "model",
        "outcome",
      ]);
    }
    expect(events[2]?.outcome).toBe("cooldown");
  });
});
