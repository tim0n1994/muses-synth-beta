/**
 * The single parser for the v0.7 feature switches (V11).
 *
 * History: batch 1 (vibe signal / self-track) and batch 2 (journey / replay)
 * each carried their own truthiness parser, and they disagreed on
 * whitespace-padded values — `MUSES_V07=" 1"` left batch 1 off while
 * batch 2's trimming parser turned it ON, silently bypassing the
 * "batch 2 ⊆ batch 1" layering invariant. Both modules now parse through
 * this file, and runtime-modules.ts wires the journey gate from the
 * already-computed batch-1 boolean, so the two batches cannot disagree by
 * construction.
 *
 * Semantics are the strictest of the two former parsers (fail-closed):
 * only exactly `"1"` or a case-insensitive exact `"true"` enables; unset,
 * `"0"`, garbage, or whitespace-padded values (`" 1"`, `"true "`) disable.
 * Padding is treated as an operator quoting mistake, not a hidden enable —
 * a dirty environment must never switch v0.7 on for one batch only.
 */

export const isTruthyFeatureFlag = (value: string | undefined): boolean =>
  value === "1" ||
  (typeof value === "string" && value.toLowerCase() === "true");

/** Batch 1: MUSES_V07 — Vibe Signal pulse + self-track playback plan. */
export const isV07Enabled = (
  env: Readonly<{ MUSES_V07?: string | undefined }>,
): boolean => isTruthyFeatureFlag(env.MUSES_V07);

/**
 * Batch 2: MUSES_V07 && MUSES_V07_REPLAY. Evaluated through the same
 * parser as batch 1, so journey/replay is reachable only when batch 1 is.
 */
export const isV07ReplayEnabled = (
  env: Readonly<{
    MUSES_V07?: string | undefined;
    MUSES_V07_REPLAY?: string | undefined;
  }>,
): boolean => isV07Enabled(env) && isTruthyFeatureFlag(env.MUSES_V07_REPLAY);

/** The shape the SPA-serving layer injects for the client router gate. */
export interface V07FeatureFlags {
  readonly selfTrack: boolean;
  readonly replay: boolean;
}

export const v07FeatureFlagsFromEnv = (
  env: Readonly<{
    MUSES_V07?: string | undefined;
    MUSES_V07_REPLAY?: string | undefined;
  }>,
): V07FeatureFlags => ({
  selfTrack: isV07Enabled(env),
  replay: isV07ReplayEnabled(env),
});

/**
 * MUSES_V07_USERS — the per-user release gate (Round-2 repair order, root
 * cause #1: the global switch leaked the v0.7 surface to every visitor).
 * Comma-separated user ids; entries are trimmed and empties dropped (same
 * leniency as MUSES_ALLOWED_ORIGINS, because ids never contain spaces).
 * With auth enabled an EMPTY list admits NOBODY — enabling the switch
 * without naming a single user must not silently re-widen the surface.
 */
export const parseV07Users = (
  env: Readonly<{ MUSES_V07_USERS?: string | undefined }>,
): readonly string[] => {
  const raw = env.MUSES_V07_USERS;
  if (raw === undefined) {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ];
};

/**
 * The v0.7 API surface, by path prefix. Every route the two batches can
 * register lives under one of these prefixes (pulse is nested under the
 * v0.6 /api/v1/belief namespace on purpose — V1: pulse is a belief-engine
 * extension, but it is still a v0.7 feature and must be concealed as one),
 * plus the /api/v1/features endpoint the SPA consults after login. The
 * bearer gate conceals ALL of them for callers the policy rejects.
 */
const V07_API_PREFIXES: readonly string[] = [
  "/api/v1/self-track",
  "/api/v1/belief/pulse",
  "/api/v1/journeys",
  "/api/v1/features",
];

export const isV07ApiPath = (decodedApiPath: string): boolean =>
  V07_API_PREFIXES.some(
    (prefix) =>
      decodedApiPath === prefix || decodedApiPath.startsWith(`${prefix}/`),
  );

/**
 * Who may use the v0.7 surfaces while the switches are on:
 *   - auth enabled (multi-user deployment): exactly the accounts whose id
 *     is listed in MUSES_V07_USERS. Anonymous callers and bad tokens are
 *     never admitted — they see a routing 404, never 401/403, so the
 *     surface does not even reveal that it exists.
 *   - auth disabled (single-user local mode): there is no account to
 *     list and the process is loopback-bound by config; the switches
 *     alone govern, exactly as before the allowlist existed.
 */
export interface V07AccessPolicy {
  readonly authEnabled: boolean;
  readonly users: readonly string[];
  allows(userId: string | null | undefined): boolean;
}

export const createV07AccessPolicy = (options: {
  readonly users: readonly string[];
  readonly authEnabled: boolean;
}): V07AccessPolicy => {
  const listed = new Set(options.users);
  return {
    authEnabled: options.authEnabled,
    users: [...listed],
    allows(userId) {
      if (!options.authEnabled) {
        return true;
      }
      return typeof userId === "string" && listed.has(userId);
    },
  };
};

/** The policy for processes without an auth module (bare createApp tests). */
export const LOCAL_V07_ACCESS_POLICY: V07AccessPolicy = createV07AccessPolicy({
  users: [],
  authEnabled: false,
});
