/**
 * Server-provided feature flags for the client router (Round-1 review B2,
 * Round-2 per-user allowlist).
 *
 * Two sources, consulted in order:
 *
 *  1. The `<meta name="muses-features">` hint the SPA-serving layer injects
 *     into the HTML shell (see src/server/foundation/static-files.ts; a meta
 *     tag because the foundation CSP's script-src 'self' blocks injected
 *     inline scripts). The server injects it only while the v0.7 switches
 *     are on AND the requester is admitted — in an auth-enabled deployment
 *     the address-bar navigation carries no bearer token, so the shell a
 *     browser receives is the untouched v0.6 shell and this source is
 *     absent for everyone.
 *  2. `GET /api/v1/features`, asked with the stored session token. The
 *     server answers 200 with the two booleans for an admitted account and
 *     a routing 404 for everyone else (anonymous, outside MUSES_V07_USERS,
 *     or the switches off) — concealed exactly like the other v0.7 routes.
 *
 * Any absent, malformed or failed answer fails closed to "off": the router
 * then mounts exactly the v0.6 route set and /self-track, /signature and
 * /replay fall through to the foundation catch-all — the same page v0.6
 * serves — instead of an error page from half-registered surfaces.
 */

import { getStoredToken } from "../auth/auth-store.js";

export interface ServerFeatureFlags {
  readonly selfTrack: boolean;
  readonly replay: boolean;
}

export const SERVER_FEATURE_FLAGS_OFF: ServerFeatureFlags = Object.freeze({
  selfTrack: false,
  replay: false,
});

export const FEATURES_META_SELECTOR = 'meta[name="muses-features"]';
export const FEATURES_API_PATH = "/api/v1/features";

interface MetaElementLike {
  getAttribute(name: string): string | null;
}

interface MetaScopeLike {
  querySelector(selector: string): MetaElementLike | null;
}

interface DocumentCarrier {
  readonly document?: MetaScopeLike;
}

const globalDocument: MetaScopeLike | undefined = (
  globalThis as unknown as DocumentCarrier
).document;

function parseFeatureFlags(raw: unknown): ServerFeatureFlags {
  if (typeof raw !== "object" || raw === null) {
    return SERVER_FEATURE_FLAGS_OFF;
  }
  const candidate = raw as {
    readonly selfTrack?: unknown;
    readonly replay?: unknown;
  };
  return {
    selfTrack: candidate.selfTrack === true,
    replay: candidate.replay === true,
  };
}

/** True when the server injected a hint into this shell at all. */
export function hasServerFeatureHint(
  scope: MetaScopeLike | undefined = globalDocument,
): boolean {
  const meta = scope?.querySelector(FEATURES_META_SELECTOR);
  return meta !== undefined && meta !== null;
}

export function readServerFeatureFlags(
  scope: MetaScopeLike | undefined = globalDocument,
): ServerFeatureFlags {
  const meta = scope?.querySelector(FEATURES_META_SELECTOR);
  if (meta === undefined || meta === null) {
    return SERVER_FEATURE_FLAGS_OFF;
  }
  try {
    return parseFeatureFlags(JSON.parse(meta.getAttribute("content") ?? ""));
  } catch {
    return SERVER_FEATURE_FLAGS_OFF;
  }
}

export interface FetchServerFeatureFlagsOptions {
  readonly token: string;
  readonly fetchImplementation?: typeof fetch;
  /** Absolute origin for the request; defaults to the page origin. */
  readonly origin?: string;
}

function pageOrigin(): string {
  return typeof location === "undefined" ? "" : location.origin;
}

/**
 * Ask the server which v0.7 surfaces it will answer for this session. Every
 * non-200 answer (the concealment 404 included) and every transport failure
 * reads as "off" — the client never guesses a surface the server did not
 * confirm.
 */
export async function fetchServerFeatureFlags(
  options: FetchServerFeatureFlagsOptions,
): Promise<ServerFeatureFlags> {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  try {
    const response = await fetchImplementation(
      `${options.origin ?? pageOrigin()}${FEATURES_API_PATH}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.token}`,
        },
      },
    );
    if (response.status !== 200) {
      return SERVER_FEATURE_FLAGS_OFF;
    }
    return parseFeatureFlags(await response.json());
  } catch {
    return SERVER_FEATURE_FLAGS_OFF;
  }
}

export interface ResolveServerFeatureFlagsOptions {
  readonly scope?: MetaScopeLike | undefined;
  /** Session token; defaults to the stored session. null = signed out. */
  readonly token?: string | null;
  readonly fetchImplementation?: typeof fetch;
  readonly origin?: string;
}

/**
 * Boot-time resolution: an injected hint is authoritative (the server
 * already judged this requester); otherwise a stored session asks the
 * API; a signed-out visitor is off without a round trip.
 */
export async function resolveServerFeatureFlags(
  options: ResolveServerFeatureFlagsOptions = {},
): Promise<ServerFeatureFlags> {
  const scope = "scope" in options ? options.scope : globalDocument;
  if (hasServerFeatureHint(scope)) {
    return readServerFeatureFlags(scope);
  }
  const token = options.token === undefined ? getStoredToken() : options.token;
  if (token === null) {
    return SERVER_FEATURE_FLAGS_OFF;
  }
  return fetchServerFeatureFlags({
    token,
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
}

/**
 * The flags the mounted router was built from. The route table is decided
 * once at boot, so a sign-in that changes the answer needs a fresh boot —
 * LoginPage consults featureSurfaceChangedForSession() to decide between a
 * client-side navigation and a full reload.
 */
let activeServerFeatureFlags: ServerFeatureFlags = SERVER_FEATURE_FLAGS_OFF;

export function getActiveServerFeatureFlags(): ServerFeatureFlags {
  return activeServerFeatureFlags;
}

export function setActiveServerFeatureFlags(flags: ServerFeatureFlags): void {
  activeServerFeatureFlags = {
    selfTrack: flags.selfTrack === true,
    replay: flags.replay === true,
  };
}

export function featureSurfaceDiffers(
  left: ServerFeatureFlags,
  right: ServerFeatureFlags,
): boolean {
  return left.selfTrack !== right.selfTrack || left.replay !== right.replay;
}

/**
 * Full document navigation (a fresh boot, so the route table is rebuilt
 * from the new session's answer). Isolated so sign-in flows can be tested
 * without jsdom's unimplemented navigation.
 */
export function rebootInto(path: string): void {
  window.location.replace(path);
}

/**
 * After a successful sign-in: does the server answer a different v0.7
 * surface for the new session than the one the running router mounted?
 * Signed-out (no token) compares as "off".
 */
export async function featureSurfaceChangedForSession(
  options: Omit<ResolveServerFeatureFlagsOptions, "scope"> = {},
): Promise<boolean> {
  const token = options.token === undefined ? getStoredToken() : options.token;
  const next =
    token === null
      ? SERVER_FEATURE_FLAGS_OFF
      : await fetchServerFeatureFlags({
          token,
          ...(options.fetchImplementation === undefined
            ? {}
            : { fetchImplementation: options.fetchImplementation }),
          ...(options.origin === undefined ? {} : { origin: options.origin }),
        });
  return featureSurfaceDiffers(activeServerFeatureFlags, next);
}
