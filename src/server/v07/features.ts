import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";

import type { FoundationModule } from "../foundation/create-app.js";
import type { V07FeatureFlags } from "../foundation/feature-flags.js";

/**
 * GET /api/v1/features — the authenticated twin of the SPA-shell hint.
 *
 * Browsers never attach the bearer token to a navigation request (the
 * session lives in localStorage), so an auth-enabled deployment can only
 * serve the untouched v0.6 shell to the address bar. After the SPA has its
 * session it asks here which v0.7 surfaces the server will actually answer
 * for THIS account, and mounts the client routes accordingly. Registered
 * only while MUSES_V07 is on; concealed by the bearer gate (routing 404)
 * for every caller outside MUSES_V07_USERS, exactly like the other v0.7
 * routes — so a probe learns nothing from it.
 */
export const V07_FEATURES_MODULE_NAME = "v07-features";
export const V07_FEATURES_PATH = "/api/v1/features";

export const V07FeaturesResponseSchema = Type.Object(
  {
    selfTrack: Type.Boolean(),
    replay: Type.Boolean(),
  },
  { additionalProperties: false },
);

export function createV07FeaturesModule(
  features: V07FeatureFlags,
): FoundationModule {
  const snapshot: V07FeatureFlags = Object.freeze({
    selfTrack: features.selfTrack,
    replay: features.replay,
  });
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
  const plugin: FastifyPluginAsync = async (fastify) => {
    fastify.get(
      V07_FEATURES_PATH,
      { schema: { response: { 200: V07FeaturesResponseSchema } } },
      () => snapshot,
    );
  };
  return { name: V07_FEATURES_MODULE_NAME, plugin };
}
