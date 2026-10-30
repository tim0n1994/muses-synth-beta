import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  CurrentDecisionResponseSchema,
  type CurrentDecisionResponse,
} from "./contracts.js";
import type { DecisionRepository } from "./repository.js";

export interface DecisionRoutesOptions {
  readonly repository: DecisionRepository;
  readonly basePath?: string;
}

export function createDecisionRoutes(
  options: DecisionRoutesOptions,
): FastifyPluginAsync {
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
  return async (server: FastifyInstance): Promise<void> => {
    const basePath = options.basePath ?? "/api/v1";

    server.get<{ Reply: CurrentDecisionResponse }>(
      `${basePath}/decisions/current`,
      {
        schema: {
          response: {
            200: CurrentDecisionResponseSchema,
          },
        },
      },
      (request): CurrentDecisionResponse => ({
        // Per-user scoping: with auth on, each account sees its own latest
        // decision; without auth the request joins the legacy global stream.
        decision: options.repository.getCurrent(request.user?.id ?? null),
      }),
    );
  };
}
