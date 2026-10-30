import {
  llmCooldown,
  llmGatewayError,
  llmGatewayUnavailable,
  llmInvalidResponse,
  llmTimeout,
  type LlmDomainError,
} from "./contracts.js";

/**
 * Minimal OpenAI-compatible chat/completions client for the optional LLM
 * layer. One method touches the network; one read-only getter exposes
 * cooldown state. Everything here is in-memory only — a restart forgets all
 * failures, so a transient outage never poisons the session.
 *
 * Gateway discipline is built in, not bolted on: concurrency <= 4 (extra
 * callers queue, they are never rejected — this is a single-user
 * click-triggered feature), per-attempt timeout >= 60s, and exactly one
 * retry, allowed only for network-layer rejections (the server never saw the
 * request) and HTTP 403/429 (routine key rotation). Retrying anything else,
 * or retrying at a second layer, multiplies load on an already struggling
 * gateway.
 */

export interface LlmCompletionRequest {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
}

export interface LlmCompletionResult {
  readonly text: string;
  readonly model: string;
}

/** Structural slice of fetch — enough for POST + JSON, mockable in tests. */
export interface LlmFetchInit {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface LlmFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type LlmFetch = (
  url: string,
  init: LlmFetchInit,
) => Promise<LlmFetchResponse>;

export type LlmGatewayLogOutcome =
  | "success"
  | "timeout"
  | "network-error"
  | "http-error"
  | "invalid-response"
  | "cooldown";

/**
 * The only logging hook. Fields are a closed allow-list; the apiKey, the full
 * URL, and any request or response body must never join them.
 */
export interface LlmGatewayLogFields {
  readonly model: string;
  readonly durationMs: number;
  readonly outcome: LlmGatewayLogOutcome;
}

export type LlmGatewayLogSink = (fields: LlmGatewayLogFields) => void;

export interface LlmGatewayClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: LlmFetch;
  readonly timeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly cooldownMs?: number;
  readonly failureThreshold?: number;
  readonly now?: () => number;
  readonly log?: LlmGatewayLogSink;
}

const MINIMUM_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_COOLDOWN_MS = 300_000;
const DEFAULT_FAILURE_THRESHOLD = 2;

// Rejection trigger for the timeout race. Its identity is never compared —
// the `timedOut` flag in attemptOnce decides the outcome — but it stays an
// Error so rejections follow the platform convention.
const TIMEOUT_SENTINEL = new Error("llm gateway request timeout");

type AttemptOutcome =
  | { readonly kind: "success"; readonly text: string; readonly model: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "network-error" }
  | { readonly kind: "invalid-response" }
  | { readonly kind: "http-error"; readonly status: number };

export class LlmGatewayClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: LlmFetch;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly cooldownMs: number;
  private readonly failureThreshold: number;
  private readonly now: () => number;
  private readonly logSink: LlmGatewayLogSink | undefined;

  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private consecutiveFailures = 0;
  private cooldownEndsAt: number | null = null;

  public constructor(options: LlmGatewayClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.max(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      MINIMUM_TIMEOUT_MS,
    );
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.now = options.now ?? Date.now;
    this.logSink = options.log;
  }

  /** Read-only cooldown view for capability derivation; never mutates. */
  public cooldownUntil(): number | null {
    return this.cooldownEndsAt;
  }

  public async complete(
    input: LlmCompletionRequest,
  ): Promise<LlmCompletionResult> {
    const cooldownEndsAt = this.cooldownEndsAt;
    if (cooldownEndsAt !== null && this.now() < cooldownEndsAt) {
      // Fail fast: while cooling down, not one byte leaves the process.
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((cooldownEndsAt - this.now()) / 1_000),
      );
      this.emitLog(input.model, 0, "cooldown");
      throw llmCooldown(retryAfterSeconds);
    }

    await this.acquire();
    const startedAt = this.now();
    try {
      let attemptsUsed = 0;
      for (;;) {
        attemptsUsed += 1;
        const outcome = await this.attemptOnce(input);
        if (outcome.kind === "success") {
          this.recordSuccess();
          this.emitLog(input.model, this.now() - startedAt, "success");
          return { text: outcome.text, model: outcome.model };
        }

        const retryable =
          outcome.kind === "network-error" ||
          (outcome.kind === "http-error" &&
            (outcome.status === 403 || outcome.status === 429));
        if (retryable && attemptsUsed === 1) {
          continue; // the single allowed retry, and only in this layer
        }

        this.recordFailure(outcome);
        this.emitLog(input.model, this.now() - startedAt, outcome.kind);
        throw this.toError(outcome);
      }
    } finally {
      this.release();
    }
  }

  private async attemptOnce(
    input: LlmCompletionRequest,
  ): Promise<AttemptOutcome> {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    // The timer both aborts the real fetch and settles the race below, so a
    // fetch implementation that ignores the abort signal still times out.
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(TIMEOUT_SENTINEL);
      }, this.timeoutMs);
      timeoutHandle.unref?.();
    });

    try {
      const fetchPromise = this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          max_tokens: input.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
      // If the race has already settled, a later abort rejection must not
      // surface as an unhandled promise rejection.
      void fetchPromise.catch(() => undefined);

      let response: LlmFetchResponse;
      try {
        response = await Promise.race([fetchPromise, timeoutPromise]);
      } catch {
        return timedOut ? { kind: "timeout" } : { kind: "network-error" };
      }

      if (!response.ok) {
        // The upstream error body is deliberately not read: it may carry
        // account information and must never reach logs or error envelopes.
        return { kind: "http-error", status: response.status };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: "invalid-response" };
      }
      const parsed = parseCompletionBody(body, input.model);
      return parsed === null
        ? { kind: "invalid-response" }
        : { kind: "success", text: parsed.text, model: parsed.model };
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.cooldownEndsAt = null;
  }

  private recordFailure(outcome: AttemptOutcome): void {
    // Quota/rotation signals (403/429) never arm the breaker on their own —
    // only repeated *failure* does. 403/429 reach this point only after the
    // allowed retry already failed. An unusable 2xx body is a shape problem,
    // not an availability problem, so it does not count either.
    const counts =
      outcome.kind === "timeout" ||
      outcome.kind === "network-error" ||
      (outcome.kind === "http-error" && outcome.status >= 500) ||
      (outcome.kind === "http-error" &&
        (outcome.status === 403 || outcome.status === 429));
    if (!counts) {
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.cooldownEndsAt = this.now() + this.cooldownMs;
    }
  }

  private toError(outcome: AttemptOutcome): LlmDomainError {
    switch (outcome.kind) {
      case "timeout":
        return llmTimeout();
      case "network-error":
        return llmGatewayUnavailable();
      case "invalid-response":
        return llmInvalidResponse();
      case "http-error":
        return llmGatewayError(outcome.status);
      case "success":
        // Unreachable: only failure outcomes are mapped.
        return llmInvalidResponse();
    }
  }

  private emitLog(
    model: string,
    durationMs: number,
    outcome: LlmGatewayLogOutcome,
  ): void {
    this.logSink?.({ model, durationMs, outcome });
  }

  private async acquire(): Promise<void> {
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
      // release() handed its slot straight to us, so `active` already counts
      // this caller.
      return;
    }
    this.active += 1;
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next(); // hand the slot straight to the next waiter
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

interface CompletionBody {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
  }[];
  readonly model?: unknown;
}

/**
 * Accepts both shapes OpenAI-compatible gateways emit for
 * choices[0].message.content — a plain string, or an array of
 * {type:"text",text} segments. Anything else (or empty content) is an
 * unusable response. The response's own `model` field wins when present, so
 * the UI can show which alias the gateway actually resolved.
 */
const parseCompletionBody = (
  body: unknown,
  requestModel: string,
): { readonly text: string; readonly model: string } | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const candidate = body as CompletionBody;
  const first = candidate.choices?.[0];
  const content = first?.message?.content;
  if (typeof content !== "string" && !Array.isArray(content)) {
    return null;
  }

  let text: string;
  if (typeof content === "string") {
    text = content;
  } else {
    const parts: string[] = [];
    for (const segment of content) {
      if (
        typeof segment === "object" &&
        segment !== null &&
        (segment as { type?: unknown }).type === "text" &&
        typeof (segment as { text?: unknown }).text === "string"
      ) {
        parts.push((segment as { text: string }).text);
      }
    }
    text = parts.join("");
  }

  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }

  const model =
    typeof candidate.model === "string" && candidate.model.trim() !== ""
      ? candidate.model
      : requestModel;
  return { text: trimmed, model };
};
