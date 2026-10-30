import type { FastifyPluginAsync } from "fastify";

import type { FoundationModule } from "../foundation/create-app.js";
import type { SqliteDatabase } from "../db/types.js";
import { SelfTrackPlanService, type PulseAccess } from "./plan-service.js";
import { selfTrackRoutes } from "./routes.js";

/**
 * Self-track playback plan module (v0.7 batch 1, wired by the stage-3
 * integrator behind the same MUSES_V07 switch as the vibe signal):
 *
 *   const planModule = createSelfTrackPlanModule({
 *     database, pulseFor, enabled: isVibeSignalEnabled(process.env),
 *   });
 *   if (planModule !== null) {
 *     modules.push(planModule);
 *   }
 *
 * Returns null when disabled — zero registration, zero construction, the
 * module graph stays byte-for-byte the v0.6 graph (V10/V11).
 */
export const SELF_TRACK_MODULE_NAME = "self-track";

export interface SelfTrackModuleOptions {
  readonly database: SqliteDatabase;
  /**
   * Scoped pulse access per user key (null is the legacy global stream).
   * Hand over vibeSignal.runtimes.getFor(userId).pulse from the wiring site.
   */
  readonly pulseFor?: ((userId: string | null) => PulseAccess | null) | null;
  /** From isVibeSignalEnabled(process.env) at the wiring site. */
  readonly enabled: boolean;
  readonly stepCount?: number;
}

export function createSelfTrackPlanModule(
  options: SelfTrackModuleOptions,
): FoundationModule | null {
  if (!options.enabled) {
    return null;
  }
  const service = new SelfTrackPlanService({
    database: options.database,
    ...(options.pulseFor === undefined ? {} : { pulseFor: options.pulseFor }),
    ...(options.stepCount === undefined
      ? {}
      : { stepCount: options.stepCount }),
  });
  const plugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(selfTrackRoutes, { service });
  };
  return { name: SELF_TRACK_MODULE_NAME, plugin };
}
