import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { ContextDomainError } from "./errors.js";
import { parseCloudEventInput } from "./parse.js";
import {
  CloudEventIngestSchema,
  ContextErrorResponseSchema,
  ContextEventListQuerySchema,
  ContextEventPageSchema,
  ContextIngestResponseSchema,
  type ContextEventListQueryDto,
} from "./schemas.js";
import type { ContextEventService } from "./service.js";

export interface ContextRoutesOptions {
  readonly service: ContextEventService;
  readonly prefix?: string;
  /**
   * Invoked after a fresh (non-duplicate) event lands, with the user stream
   * the event was attributed to — null when auth is disabled, matching the
   * legacy global stream the event was written to.
   */
  readonly onIngested?: (userId: string | null) => Promise<void>;
}

export const contextRoutes: FastifyPluginAsync<ContextRoutesOptions> = async (
  fastify,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  const prefix = options.prefix ?? "/api/v1/context";

  fastify.post<{ Body: unknown }>(
    `${prefix}/events`,
    {
      schema: {
        body: CloudEventIngestSchema,
        response: {
          200: ContextIngestResponseSchema,
          202: ContextIngestResponseSchema,
          400: ContextErrorResponseSchema,
          409: ContextErrorResponseSchema,
          503: ContextErrorResponseSchema,
          500: ContextErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const event = parseCloudEventInput(request.body);
        // Attribution: when the auth gate authenticated this request, the
        // event lands in that user's stream; otherwise it joins the legacy
        // global (NULL) stream exactly as before.
        const userId = request.user?.id ?? null;
        const result = await options.service.ingest(event, { userId });
        // After a fresh event lands, give automation a chance to re-project
        // belief and evaluate policy for the affected user. Best-effort:
        // failures must not reject the ingest, which already succeeded.
        if (!result.duplicate) {
          try {
            await options.onIngested?.(userId);
          } catch {
            // Automation failures are observable via decision/effect routes.
          }
        }
        return reply.code(result.duplicate ? 200 : 202).send(result);
      } catch (error: unknown) {
        return sendContextError(reply, error);
      }
    },
  );

  fastify.get<{ Querystring: ContextEventListQueryDto }>(
    `${prefix}/events`,
    {
      schema: {
        querystring: ContextEventListQuerySchema,
        response: {
          200: ContextEventPageSchema,
          400: ContextErrorResponseSchema,
          503: ContextErrorResponseSchema,
          500: ContextErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const page = await options.service.list(
          request.query,
          request.user?.id ?? null,
        );
        return reply.code(200).send(page);
      } catch (error: unknown) {
        return sendContextError(reply, error);
      }
    },
  );
};

const sendContextError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof ContextDomainError) {
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }

  reply.log.error({ err: error }, "Unhandled context route error");
  return reply.code(500).send({
    error: {
      code: "CONTEXT_INTERNAL_ERROR",
      message: "Context request failed safely.",
    },
  });
};
