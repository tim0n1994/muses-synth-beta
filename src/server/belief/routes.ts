import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { BeliefDomainError } from "./errors.js";
import {
  BeliefErrorResponseSchema,
  BeliefReplayBodySchema,
  BeliefSnapshotSchema,
  type BeliefReplayBodyDto,
} from "./schemas.js";
import type { BeliefService } from "./service.js";

/**
 * Belief surface a request is served from. Satisfied structurally by
 * BeliefService, so existing unscoped callers (tests, the local single-user
 * app) can keep passing `service` directly.
 */
interface BeliefAccess {
  current(): ReturnType<BeliefService["current"]>;
  replay(
    request?: Parameters<BeliefService["replay"]>[0],
  ): ReturnType<BeliefService["replay"]>;
}

export interface BeliefRoutesOptions {
  /** Unscoped access; ignored when forUser is provided. */
  readonly service?: BeliefAccess;
  /**
   * Scoped access per user key (v0.6): null is the legacy global stream used
   * when auth is disabled. When present it wins over `service`.
   */
  readonly forUser?: (userId: string | null) => BeliefAccess;
  readonly prefix?: string;
}

export const beliefRoutes: FastifyPluginAsync<BeliefRoutesOptions> = async (
  fastify,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  const prefix = options.prefix ?? "/api/v1/belief";
  const accessFor = (userId: string | null): BeliefAccess => {
    if (options.forUser !== undefined) {
      return options.forUser(userId);
    }
    if (options.service !== undefined) {
      return options.service;
    }
    throw new Error("beliefRoutes requires either service or forUser.");
  };

  fastify.get(
    `${prefix}/current`,
    {
      schema: {
        response: {
          200: BeliefSnapshotSchema,
          503: BeliefErrorResponseSchema,
          500: BeliefErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const access = accessFor(request.user?.id ?? null);
        return reply.code(200).send(await access.current());
      } catch (error: unknown) {
        return sendBeliefError(reply, error);
      }
    },
  );

  fastify.post<{ Body: BeliefReplayBodyDto }>(
    `${prefix}/replay`,
    {
      schema: {
        body: BeliefReplayBodySchema,
        response: {
          200: BeliefSnapshotSchema,
          400: BeliefErrorResponseSchema,
          503: BeliefErrorResponseSchema,
          500: BeliefErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const access = accessFor(request.user?.id ?? null);
        return reply.code(200).send(await access.replay(request.body));
      } catch (error: unknown) {
        return sendBeliefError(reply, error);
      }
    },
  );
};

const sendBeliefError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof BeliefDomainError) {
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }

  reply.log.error({ err: error }, "Unhandled belief route error");
  return reply.code(500).send({
    error: {
      code: "BELIEF_INTERNAL_ERROR",
      message: "Belief request failed safely.",
    },
  });
};
