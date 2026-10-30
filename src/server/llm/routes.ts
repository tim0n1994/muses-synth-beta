import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  LlmDomainError,
  LlmErrorResponseSchema,
  LlmNarrationBodySchema,
  LlmSummaryBodySchema,
  LlmTextResponseSchema,
  type LlmNarrationBody,
  type LlmSummaryBody,
} from "./contracts.js";
import type { LlmService } from "./service.js";
import type { LanguageCode } from "../settings/schema.js";

export interface LlmRoutesOptions {
  readonly service: LlmService;
  readonly prefix?: string;
  /**
   * Per-user narration language (v0.6): returns the language the given user
   * explicitly configured in their profile settings, or undefined to fall
   * back to the published global settings document's appearance.language.
   */
  readonly resolveUserLanguage?: (userId: string) => LanguageCode | undefined;
}

/**
 * The two explicitly triggered generation endpoints. Both are POST because
 * both cost gateway quota — no GET could ever be allowed to fan out from a
 * dashboard refresh. Errors use the same envelope shape as the belief
 * routes; every message is a fixed generic sentence (no URLs, no keys, no
 * upstream bodies), and route logs carry only the code and status.
 */
export const llmRoutes: FastifyPluginAsync<LlmRoutesOptions> = async (
  fastify,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  const prefix = options.prefix ?? "/api/v1/llm";

  const responses = {
    200: LlmTextResponseSchema,
    500: LlmErrorResponseSchema,
    502: LlmErrorResponseSchema,
    503: LlmErrorResponseSchema,
    504: LlmErrorResponseSchema,
  } as const;

  fastify.post<{ Body: LlmNarrationBody }>(
    `${prefix}/narration`,
    {
      schema: {
        // An empty JSON object, and the client must actually send it: with
        // application/json an absent body is a 400 before the handler runs,
        // which keeps caches/proxies from triggering generations.
        body: LlmNarrationBodySchema,
        response: responses,
      },
    },
    async (request, reply) => {
      try {
        const context = requestContext(request, options);
        return reply.code(200).send(await options.service.narrate(context));
      } catch (error: unknown) {
        return sendLlmError(reply, error);
      }
    },
  );

  fastify.post<{ Body: LlmSummaryBody }>(
    `${prefix}/summary`,
    {
      schema: {
        body: LlmSummaryBodySchema,
        response: responses,
      },
    },
    async (request, reply) => {
      try {
        const context = requestContext(request, options);
        return (
          reply
            .code(200)
            // The body may carry a window; user and language come from the
            // authenticated request, never from the client payload.
            .send(
              await options.service.summarize({
                ...(request.body.windowMinutes === undefined
                  ? {}
                  : { windowMinutes: request.body.windowMinutes }),
                ...context,
              }),
            )
        );
      } catch (error: unknown) {
        return sendLlmError(reply, error);
      }
    },
  );
};

/**
 * Resolves the per-request generation context: the user shard to narrate and
 * the per-user language preference when one was explicitly configured. The
 * language resolution runs only for authenticated users — anonymous local
 * mode always uses the global settings document.
 */
const requestContext = (
  request: FastifyRequest,
  options: LlmRoutesOptions,
): { userId: string | null; language?: LanguageCode } => {
  const userId = request.user?.id ?? null;
  if (userId === null || options.resolveUserLanguage === undefined) {
    return { userId };
  }
  const language = options.resolveUserLanguage(userId);
  return language === undefined ? { userId } : { userId, language };
};

const sendLlmError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof LlmDomainError) {
    reply.log.warn(
      { code: error.code, statusCode: error.statusCode },
      "LLM request rejected",
    );
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }

  reply.log.error({ err: error }, "Unhandled llm route error");
  return reply.code(500).send({
    error: {
      code: "LLM_INTERNAL_ERROR",
      message: "LLM request failed safely.",
    },
  });
};
