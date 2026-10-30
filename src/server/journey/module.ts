import type { FastifyPluginAsync } from "fastify";

import type { FoundationModule } from "../foundation/create-app.js";
import { isV07ReplayEnabled } from "../foundation/feature-flags.js";
import { createJourneyRoutes } from "./routes.js";
import { JourneyService, type JourneyEventSource } from "./journey-service.js";
import type { TrackCatalog } from "./replay-planner.js";
import {
  SqliteJourneyRepository,
  type SqliteDatabasePort,
} from "./sqlite-journey-repository.js";
import { selfTrackBucket } from "./model.js";
import { createSqliteTrackMetaResolver } from "./track-meta.js";

/**
 * Batch-2 feature gate (V11 + the kill-switch contract): journey/replay
 * exists ONLY while both MUSES_V07 and MUSES_V07_REPLAY are enabled. With
 * either off, buildJourneyModule returns null — zero registration, the
 * module graph is byte-for-byte the pre-v0.7 graph, and every journey URL
 * falls through to the foundation 404 handler. Stage 3 wires this into
 * runtime-modules.ts exactly like the auth module's conditional append.
 *
 * Flag values are parsed by the SAME shared, fail-closed parser as batch 1
 * (src/server/foundation/feature-flags.ts): exactly "1" or case-insensitive
 * "true" enables; anything else — including unset, garbage, or
 * whitespace-padded values — disables. The wiring site additionally feeds
 * its batch-1 boolean into the journey gate, so batch 2 can never be
 * reachable while batch 1 is off.
 */

export const JOURNEY_MODULE_NAME = "journey";

export const isJourneyReplayEnabled = isV07ReplayEnabled;

export interface JourneyModuleDependencies {
  readonly database: SqliteDatabasePort;
  readonly eventSource: JourneyEventSource;
  /**
   * Self-track catalog (V2's nine pace x intensity buckets). Production
   * wiring hands over the library-backed selector's output; until stage 3
   * connects it, buckets without entries resolve to the explicit
   * "unassigned" track id.
   */
  readonly catalog?: TrackCatalog;
}

const DEFAULT_CATALOG: TrackCatalog = Object.freeze(
  Object.fromEntries(
    (["low", "medium", "high"] as const).flatMap((pace) =>
      (["low", "medium", "high"] as const).map((intensity) => [
        selfTrackBucket(pace, intensity),
        ["unassigned"],
      ]),
    ),
  ),
);

export function buildJourneyModule(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: JourneyModuleDependencies,
): FoundationModule | null {
  if (!isJourneyReplayEnabled(env)) {
    return null;
  }
  const repository = new SqliteJourneyRepository(dependencies.database);
  const service = new JourneyService({
    repository,
    eventSource: dependencies.eventSource,
    catalog: dependencies.catalog ?? DEFAULT_CATALOG,
    resolveTracks: createSqliteTrackMetaResolver(dependencies.database),
  });
  const plugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(createJourneyRoutes({ service }));
  };
  return { name: JOURNEY_MODULE_NAME, plugin };
}
