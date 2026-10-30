import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  CurrentEffectResponseSchema,
  EffectErrorResponseSchema,
  EffectOutcomeSchema,
  RecordEffectOutcomeResponseSchema,
  type CurrentEffectResponse,
  type EffectErrorResponse,
  type EffectOutcome,
  type RecordEffectOutcomeResponse,
} from "./contracts.js";
import { type EffectLedgerService, UnknownEffectError } from "./ledger.js";

export interface EffectRoutesOptions {
  readonly ledger: EffectLedgerService;
  readonly basePath?: string;
}

export function createEffectRoutes(
  options: EffectRoutesOptions,
): FastifyPluginAsync {
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
  return async (server: FastifyInstance): Promise<void> => {
    const basePath = options.basePath ?? "/api/v1";

    server.get<{ Reply: CurrentEffectResponse }>(
      `${basePath}/effects/current`,
      {
        schema: {
          response: {
            200: CurrentEffectResponseSchema,
          },
        },
      },
      (request): CurrentEffectResponse => ({
        // Per-user scoping: each account sees its own latest effect; without
        // auth the request joins the legacy global stream.
        effect: options.ledger.getCurrent(request.user?.id ?? null),
      }),
    );

    server.post<{
      Body: EffectOutcome;
      Reply: RecordEffectOutcomeResponse | EffectErrorResponse;
    }>(
      `${basePath}/effects/outcomes`,
      {
        schema: {
          body: EffectOutcomeSchema,
          response: {
            200: RecordEffectOutcomeResponseSchema,
            404: EffectErrorResponseSchema,
          },
        },
      },
      (request, reply): RecordEffectOutcomeResponse | EffectErrorResponse => {
        try {
          return {
            effect: options.ledger.recordOutcome(
              request.body,
              request.user?.id ?? null,
            ),
          };
        } catch (error: unknown) {
          if (error instanceof UnknownEffectError) {
            reply.code(404);
            return { error: "UNKNOWN_EFFECT" };
          }
          throw error;
        }
      },
    );
  };
}
