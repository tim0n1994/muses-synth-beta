import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { PulseDomainError } from "./errors.js";
import type { PulseProjectionRequest, PulseSnapshot } from "./model.js";
import {
  PulseErrorResponseSchema,
  PulseReplayBodySchema,
  PulseSnapshotSchema,
  type PulseReplayBodyDto,
} from "./schemas.js";

/**
 * Pulse surface a request is served from. Satisfied structurally by
 * PulseService (current/replay), so unscoped callers (tests, the local
 * single-user app) can keep passing the service directly — the
 * beliefRoutes accessor pattern.
 */
interface PulseAccess {
  current(request?: { maxEvents?: number }): Promise<PulseSnapshot>;
  replay(request?: PulseProjectionRequest): Promise<PulseSnapshot>;
}

export interface PulseRoutesOptions {
  /** Unscoped access; ignored when forUser is provided. */
  readonly service?: PulseAccess;
  /**
   * Scoped access per user key: null is the legacy global stream used when
   * auth is disabled. When present it wins over `service`.
   */
  readonly forUser?: (userId: string | null) => PulseAccess;
  readonly prefix?: string;
}

/**
 * The pulse HTTP surface, nested under /api/v1/belief to make its
 * "extension of the belief engine" identity explicit. Registered by the
 * stage-3 integrator only when MUSES_V07 is enabled; flag-off means these
 * routes do not exist (404) and v0.6 behavior is unchanged.
 */
export const pulseRoutes: FastifyPluginAsync<PulseRoutesOptions> = async (
  fastify,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  const prefix = options.prefix ?? "/api/v1/belief/pulse";
  const accessFor = (userId: string | null): PulseAccess => {
    if (options.forUser !== undefined) {
      return options.forUser(userId);
    }
    if (options.service !== undefined) {
      return options.service;
    }
    throw new Error("pulseRoutes requires either service or forUser.");
  };

  fastify.get(
    `${prefix}/current`,
    {
      schema: {
        response: {
          200: PulseSnapshotSchema,
          400: PulseErrorResponseSchema,
          413: PulseErrorResponseSchema,
          503: PulseErrorResponseSchema,
          500: PulseErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const access = accessFor(request.user?.id ?? null);
        return reply.code(200).send(await access.current());
      } catch (error: unknown) {
        return sendPulseError(reply, error);
      }
    },
  );

  fastify.post<{ Body: PulseReplayBodyDto }>(
    `${prefix}/replay`,
    {
      schema: {
        body: PulseReplayBodySchema,
        response: {
          200: PulseSnapshotSchema,
          400: PulseErrorResponseSchema,
          413: PulseErrorResponseSchema,
          503: PulseErrorResponseSchema,
          500: PulseErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const access = accessFor(request.user?.id ?? null);
        return reply.code(200).send(await access.replay(request.body ?? {}));
      } catch (error: unknown) {
        return sendPulseError(reply, error);
      }
    },
  );
};

const sendPulseError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof PulseDomainError) {
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }

  reply.log.error({ err: error }, "Unhandled pulse route error");
  return reply.code(500).send({
    error: {
      code: "PULSE_INTERNAL_ERROR",
      message: "Pulse request failed safely.",
    },
  });
};
