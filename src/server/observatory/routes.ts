import type { FastifyPluginAsync } from "fastify";

import type { BeliefSnapshot } from "../belief/model.js";
import type { LlmCapability } from "../llm/contracts.js";
import type { Decision } from "../policy/contracts.js";
import type { EffectLedgerEntry } from "../effects/contracts.js";
import type { SettingsDocument } from "../settings/schema.js";

export interface BootstrapRoutesOptions {
  readonly basePath?: string;
  /**
   * Per-user scoped getters (v0.6): called with the requesting user's key —
   * null for the legacy global stream (auth disabled) — so the aggregate
   * reflects exactly that user's shard.
   */
  readonly getBelief: (userId: string | null) => Promise<BeliefSnapshot>;
  readonly getDecision: (userId: string | null) => Decision | null;
  readonly getEffect: (userId: string | null) => EffectLedgerEntry | null;
  readonly getSettings: () => SettingsDocument;
  /**
   * Pure local derivation (settings + environment) with no network side
   * effects — see the note below on why it lives here anyway.
   */
  readonly getLlm: () => LlmCapability;
}

/**
 * `GET /api/v1/bootstrap` — the read-only aggregate ADR-0001 specified.
 *
 * It returns exactly what the four resource routes return, in one round trip,
 * so the dashboard does not fan out N parallel fetches on every refresh. It
 * deliberately performs **no** reshaping: an earlier draft of this file
 * invented its own state vocabulary and display labels, drifted out of the
 * dependency graph, and was never registered. Aggregation is the whole job;
 * every projection stays in the client where it is already tested.
 *
 * Recorded exception (ADR-0001 dated note, 2026-10-19): the `llm` capability
 * field is *not* the projection of an existing resource endpoint. It is a
 * pure local derivation over settings + environment, cheap to compute and
 * with no independent route of its own, so bootstrap is its natural home.
 * This is the one sanctioned deviation from "aggregate = existing endpoints
 * only"; anything similar needs its own ADR note, not silent drift.
 */
export const createBootstrapRoutes: FastifyPluginAsync<
  BootstrapRoutesOptions
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
> = async (fastify, options) => {
  const basePath = options.basePath ?? "/api/v1";

  fastify.get(`${basePath}/bootstrap`, async (request, reply) => {
    try {
      // The requesting user's shard; null is the legacy global stream when
      // auth is disabled, which is exactly what the unscoped getters used
      // to read.
      const userId = request.user?.id ?? null;
      return {
        generatedAt: new Date().toISOString(),
        belief: await options.getBelief(userId),
        decision: options.getDecision(userId),
        effect: options.getEffect(userId),
        settings: { currentRelease: { document: options.getSettings() } },
        llm: options.getLlm(),
      };
    } catch (error: unknown) {
      fastify.log.error({ err: error }, "bootstrap aggregate failed");
      return reply.code(500).send({
        code: "BOOTSTRAP_FAILED",
        message: "Failed to assemble the bootstrap projection.",
      });
    }
  });
};
