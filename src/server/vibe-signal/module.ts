import type { FastifyPluginAsync } from "fastify";

import type { ContextClock, ContextEventStore } from "../context/model.js";
import type { SqliteDatabasePort } from "../context/sqlite-context-event-store.js";
import { isV07Enabled } from "../foundation/feature-flags.js";
import { pulseRoutes } from "./routes.js";
import {
  createPulseIngestHook,
  PulseRuntimes,
  type PulseScheduler,
} from "./runtime.js";
import { SqlitePulseReadingsStore } from "./snapshot-store.js";

/**
 * MUSES_V07 feature switch (V11). Conservative and fail-closed: only exactly
 * "1" or case-insensitive "true" enable the pulse; unset, "0", garbage, or
 * whitespace-padded values leave v0.6 untouched. Delegates to the shared
 * parser (src/server/foundation/feature-flags.ts) so batch 1 and batch 2 can
 * never disagree on the same environment.
 */
export const isVibeSignalEnabled = isV07Enabled;

export interface VibeSignalModuleOptions {
  readonly database: SqliteDatabasePort;
  /** Event store port used for the MAX(server_sequence) cache probe. */
  readonly store: ContextEventStore;
  /** From isVibeSignalEnabled(process.env) at the wiring site. */
  readonly enabled: boolean;
  /** Persist cache-miss snapshots into pulse_readings (migration 005). */
  readonly persistReadings?: boolean;
  readonly clock?: ContextClock;
  readonly maxEvents?: number;
  readonly maxCacheAgeMs?: number;
  readonly refreshDelayMs?: number;
  readonly schedule?: PulseScheduler;
}

export interface VibeSignalModule {
  readonly runtimes: PulseRuntimes;
  /**
   * Fire-and-forget hook for the context ingest path: invalidate the
   * user's cached pulse and schedule the debounced refresh. Never throws.
   */
  readonly onIngested: (userId: string | null) => Promise<void>;
  /** Zero-arg plugin registering the /api/v1/belief/pulse/* routes. */
  readonly routes: FastifyPluginAsync;
}

/**
 * Assembles the whole Vibe Signal feature behind one factory so the
 * stage-3 integrator needs a single guarded block in runtime-modules.ts:
 *
 *   const vibe = createVibeSignalModule({ ..., enabled: isVibeSignalEnabled(process.env) });
 *   if (vibe !== null) {
 *     modules.push({ name: "vibe-signal", plugin: vibe.routes });
 *   }
 *
 * Returns null when disabled — zero registration, zero behavior, the
 * MUSES_V07-off regression guarantee.
 */
export const createVibeSignalModule = (
  options: VibeSignalModuleOptions,
): VibeSignalModule | null => {
  if (!options.enabled) {
    return null;
  }
  const clock = options.clock;
  const runtimes = new PulseRuntimes({
    database: options.database,
    store: options.store,
    ...(options.maxEvents === undefined
      ? {}
      : { maxEvents: options.maxEvents }),
    ...(options.maxCacheAgeMs === undefined
      ? {}
      : { maxCacheAgeMs: options.maxCacheAgeMs }),
    ...(clock === undefined ? {} : { clock }),
    ...(options.persistReadings
      ? {
          snapshotStoreFor: (userId: string | null) =>
            new SqlitePulseReadingsStore(options.database, {
              userId,
              ...(clock === undefined ? {} : { clock }),
            }),
        }
      : {}),
  });
  const onIngested = createPulseIngestHook({
    runtimes,
    ...(options.refreshDelayMs === undefined
      ? {}
      : { refreshDelayMs: options.refreshDelayMs }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
  });
  const routes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(pulseRoutes, {
      forUser: (userId) => runtimes.getFor(userId).pulse,
    });
  };
  return { runtimes, onIngested, routes };
};
