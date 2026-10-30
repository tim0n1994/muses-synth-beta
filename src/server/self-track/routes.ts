import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { PlanErrorResponseSchema, PlaybackPlanSchema } from "./schemas.js";
import {
  SelfTrackLibraryEmptyError,
  type SelfTrackPlanService,
} from "./plan-service.js";

/**
 * The self-track playback plan HTTP surface (v0.7 batch 1).
 *
 * GET /api/v1/self-track/plan — "which track comes next, when does the
 * transition happen, and how do the two decks overlap" (V3: the server plans,
 * the browser mixes). Registered only while MUSES_V07 is enabled; flag-off
 * means this route does not exist and every URL falls through to the
 * foundation 404 handler.
 */
export interface SelfTrackRoutesOptions {
  readonly service: SelfTrackPlanService;
  readonly prefix?: string;
}

export const selfTrackRoutes: FastifyPluginAsync<
  SelfTrackRoutesOptions
> = async (
  fastify,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  const prefix = options.prefix ?? "/api/v1/self-track";
  const userIdOf = (request: { user?: { id?: string } }): string | null =>
    request.user?.id ?? null;

  fastify.get(
    `${prefix}/plan`,
    {
      schema: {
        response: {
          200: PlaybackPlanSchema,
          503: PlanErrorResponseSchema,
          500: PlanErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const plan = await options.service.planFor(userIdOf(request));
        return reply.code(200).send(plan);
      } catch (error: unknown) {
        return sendPlanError(reply, error);
      }
    },
  );
};

const sendPlanError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof SelfTrackLibraryEmptyError) {
    return reply.code(503).send({
      error: {
        code: "SELF_TRACK_LIBRARY_EMPTY",
        message: error.message,
      },
    });
  }

  reply.log.error({ err: error }, "Unhandled self-track plan error");
  return reply.code(500).send({
    error: {
      code: "SELF_TRACK_PLAN_INTERNAL_ERROR",
      message: "Self-track plan request failed safely.",
    },
  });
};
