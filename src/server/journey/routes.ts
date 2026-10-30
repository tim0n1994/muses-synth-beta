import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { MusesHttpError } from "../foundation/errors.js";
import {
  JourneyDetailResponseSchema,
  JourneyIdParamsSchema,
  JourneyListResponseSchema,
  ReplayResponseSchema,
} from "./contracts.js";
import type { JourneyService } from "./journey-service.js";

/**
 * Journey/replay routes (batch 2). Ownership follows the v0.6 effects
 * ledger semantics: a journey that is not the caller's is reported exactly
 * like a journey that does not exist — 404 with the frozen business code,
 * never 403, never a body that differs from the missing-id response.
 * 403 stays reserved for role gates (auth admin routes).
 */

export interface JourneyRoutesOptions {
  readonly service: JourneyService;
  readonly basePath?: string;
}

const unknownJourney = (): MusesHttpError =>
  new MusesHttpError({
    code: "UNKNOWN_JOURNEY",
    message: "Journey not found",
    statusCode: 404,
  });

const unknownReplay = (): MusesHttpError =>
  new MusesHttpError({
    code: "UNKNOWN_REPLAY",
    message: "No replay rendered for this journey yet",
    statusCode: 404,
  });

/**
 * Trailing-slash twin (Round-3 defect #1): every route is registered under
 * its canonical URL and under the same URL with a trailing slash, so
 * `/api/v1/journeys/` answers exactly like `/api/v1/journeys`. Without the
 * twin, find-my-way matched the slashed collection against `:journeyId`
 * with an empty value (400 VALIDATION_FAILED where the list answers 200) and
 * sent the slashed detail/replay forms to the generic NOT_FOUND envelope —
 * a route-shape leak the UNKNOWN_JOURNEY indistinguishability contract above
 * forbids. Kept local to this plugin on purpose: Fastify's server-level
 * `ignoreTrailingSlash` would silently re-shape every module's surface.
 */
const withTrailingSlashTwin = (url: string): readonly string[] => [
  url,
  `${url}/`,
];

export function createJourneyRoutes(
  options: JourneyRoutesOptions,
): FastifyPluginAsync {
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
  return async (server: FastifyInstance): Promise<void> => {
    const basePath = options.basePath ?? "/api/v1";
    const userIdOf = (request: { user?: { id?: string } }): string | null =>
      request.user?.id ?? null;

    for (const url of withTrailingSlashTwin(`${basePath}/journeys`)) {
      server.get(
        url,
        { schema: { response: { 200: JourneyListResponseSchema } } },
        async (request) => {
          return {
            items: await options.service.listJourneys(userIdOf(request)),
          };
        },
      );
    }

    for (const url of withTrailingSlashTwin(
      `${basePath}/journeys/:journeyId`,
    )) {
      server.get<{ Params: { journeyId: string } }>(
        url,
        {
          schema: {
            params: JourneyIdParamsSchema,
            response: { 200: JourneyDetailResponseSchema },
          },
        },
        (request) => {
          const journey = options.service.getJourney(
            request.params.journeyId,
            userIdOf(request),
          );
          if (journey === null) {
            throw unknownJourney();
          }
          return { journey };
        },
      );
    }

    for (const url of withTrailingSlashTwin(
      `${basePath}/journeys/:journeyId/replay`,
    )) {
      server.post<{ Params: { journeyId: string } }>(
        url,
        {
          schema: {
            params: JourneyIdParamsSchema,
            response: { 201: ReplayResponseSchema },
          },
        },
        (request, reply) => {
          const replay = options.service.renderReplay(
            request.params.journeyId,
            userIdOf(request),
          );
          if (replay === null) {
            throw unknownJourney();
          }
          reply.code(201);
          return { replay, tracks: options.service.trackMetaFor(replay) };
        },
      );

      server.get<{ Params: { journeyId: string } }>(
        url,
        {
          schema: {
            params: JourneyIdParamsSchema,
            response: { 200: ReplayResponseSchema },
          },
        },
        (request) => {
          const userId = userIdOf(request);
          if (
            options.service.getJourney(request.params.journeyId, userId) ===
            null
          ) {
            throw unknownJourney();
          }
          const replay = options.service.getLatestReplay(
            request.params.journeyId,
            userId,
          );
          if (replay === null) {
            throw unknownReplay();
          }
          return { replay, tracks: options.service.trackMetaFor(replay) };
        },
      );
    }
  };
}
