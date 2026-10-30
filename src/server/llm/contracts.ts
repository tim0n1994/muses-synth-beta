import { Type, type Static } from "@sinclair/typebox";

/**
 * Shared contracts for the optional LLM narration layer.
 *
 * Everything the gateway and the model produce is *untrusted observation
 * data*: it may only leave this module as plain display text (`text`), never
 * as an instruction, never into belief/policy/effect state. Error payloads are
 * deliberately generic — no gateway URL, no API key, no upstream response
 * body ever appears in a message, a details record, or a log line.
 */

export const LLM_TEXT_MAX_LENGTH = 2_000;

export const LlmCapabilitySchema = Type.Object(
  {
    available: Type.Boolean(),
    enabled: Type.Boolean(),
    configured: Type.Boolean(),
    model: Type.String({ minLength: 1, maxLength: 128 }),
    reason: Type.Union([
      Type.Literal("ready"),
      Type.Literal("disabled"),
      Type.Literal("unconfigured"),
      Type.Literal("cooldown"),
    ]),
  },
  { additionalProperties: false },
);
export type LlmCapability = Static<typeof LlmCapabilitySchema>;

export const LlmTextResponseSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: LLM_TEXT_MAX_LENGTH }),
    model: Type.String({ minLength: 1, maxLength: 128 }),
    generatedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type LlmTextResponse = Static<typeof LlmTextResponseSchema>;

export const LlmNarrationBodySchema = Type.Object(
  {},
  { additionalProperties: false },
);
export type LlmNarrationBody = Static<typeof LlmNarrationBodySchema>;

export const LlmSummaryBodySchema = Type.Object(
  {
    windowMinutes: Type.Optional(Type.Integer({ minimum: 15, maximum: 240 })),
  },
  { additionalProperties: false },
);
export type LlmSummaryBody = Static<typeof LlmSummaryBodySchema>;

export const LlmErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
        details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type LlmErrorCode =
  | "LLM_NOT_CONFIGURED"
  | "LLM_DISABLED"
  | "LLM_COOLDOWN"
  | "LLM_TIMEOUT"
  | "LLM_GATEWAY_UNAVAILABLE"
  | "LLM_GATEWAY_ERROR"
  | "LLM_INVALID_RESPONSE";

export class LlmDomainError extends Error {
  public readonly code: LlmErrorCode;
  public readonly statusCode: number;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: LlmErrorCode,
    message: string,
    statusCode: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "LlmDomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const llmNotConfigured = (): LlmDomainError =>
  new LlmDomainError(
    "LLM_NOT_CONFIGURED",
    "The narration gateway is not configured.",
    503,
  );

export const llmDisabled = (): LlmDomainError =>
  new LlmDomainError(
    "LLM_DISABLED",
    "AI narration is disabled in settings.",
    503,
  );

export const llmCooldown = (retryAfterSeconds: number): LlmDomainError =>
  new LlmDomainError(
    "LLM_COOLDOWN",
    "The narration gateway is cooling down after repeated failures.",
    503,
    { retryAfterSeconds },
  );

export const llmTimeout = (): LlmDomainError =>
  new LlmDomainError("LLM_TIMEOUT", "The narration gateway timed out.", 504);

export const llmGatewayUnavailable = (): LlmDomainError =>
  new LlmDomainError(
    "LLM_GATEWAY_UNAVAILABLE",
    "The narration gateway could not be reached.",
    502,
  );

/** `upstreamStatus` is the only fact we keep from the gateway's answer. */
export const llmGatewayError = (upstreamStatus: number): LlmDomainError =>
  new LlmDomainError(
    "LLM_GATEWAY_ERROR",
    "The narration gateway rejected the request.",
    502,
    { upstreamStatus },
  );

export const llmInvalidResponse = (): LlmDomainError =>
  new LlmDomainError(
    "LLM_INVALID_RESPONSE",
    "The narration gateway returned an unusable response.",
    502,
  );

/**
 * Second gate of the output trust chain: strip control characters (keeping
 * \n and \t so paragraphs survive), trim, and clamp. The model output is
 * display-only; this makes it safe plain text before it ever reaches a
 * response schema or a client.
 */
export function sanitizeLlmText(value: string): string {
  const withoutControls = value.replace(
    // Deliberate allow-list: \n (\u000A) and \t (\u0009) are the only survivors.
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
  const trimmed = withoutControls.trim();
  return trimmed.length > LLM_TEXT_MAX_LENGTH
    ? trimmed.slice(0, LLM_TEXT_MAX_LENGTH)
    : trimmed;
}

/** Event-count aggregate a summary prompt is built from (payload-free). */
export interface LlmEventGroupCount {
  readonly type: string;
  readonly source: string;
  readonly count: number;
}

export interface LlmEventCounts {
  readonly total: number;
  readonly groups: readonly LlmEventGroupCount[];
}

export interface LlmSummaryCounts extends LlmEventCounts {
  readonly windowMinutes: number;
}
