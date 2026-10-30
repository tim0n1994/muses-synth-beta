import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FEATURES_API_PATH,
  featureSurfaceChangedForSession,
  featureSurfaceDiffers,
  fetchServerFeatureFlags,
  getActiveServerFeatureFlags,
  hasServerFeatureHint,
  resolveServerFeatureFlags,
  SERVER_FEATURE_FLAGS_OFF,
  setActiveServerFeatureFlags,
  FEATURES_META_SELECTOR,
} from "../feature-flags.js";

/**
 * Round-2 per-user allowlist, client half. In an auth-enabled deployment
 * the address-bar navigation carries no bearer token, so the shell never
 * carries the hint; the SPA must ask /api/v1/features with its session and
 * fail closed on anything but a clean 200.
 */

const ORIGIN = "http://muses.test";

const metaScope = (
  content: string | null,
): {
  querySelector(
    selector: string,
  ): { getAttribute(name: string): string | null } | null;
} => ({
  querySelector(selector) {
    if (selector !== FEATURES_META_SELECTOR || content === null) {
      return null;
    }
    return { getAttribute: () => content };
  },
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const fetchAnswering = (
  status: number,
  body: unknown,
): ReturnType<typeof vi.fn> & typeof fetch =>
  vi.fn(() => Promise.resolve(jsonResponse(status, body))) as never;

afterEach(() => {
  setActiveServerFeatureFlags(SERVER_FEATURE_FLAGS_OFF);
});

describe("fetchServerFeatureFlags", () => {
  it("asks GET /api/v1/features on the page origin with the bearer token", async () => {
    const fetchImplementation = fetchAnswering(200, {
      selfTrack: true,
      replay: false,
    });
    const flags = await fetchServerFeatureFlags({
      token: "tok-1",
      fetchImplementation,
      origin: ORIGIN,
    });
    expect(flags).toEqual({ selfTrack: true, replay: false });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${ORIGIN}${FEATURES_API_PATH}`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok-1",
    );
  });

  it.each([
    [404, { error: { code: "NOT_FOUND" } }],
    [401, { error: { code: "AUTH_REQUIRED" } }],
    [500, { error: { code: "INTERNAL" } }],
    [200, "not an object"],
    [200, { selfTrack: "true", replay: 1 }],
  ])("status %s with body %j reads as off", async (status, body) => {
    expect(
      await fetchServerFeatureFlags({
        token: "tok",
        fetchImplementation: fetchAnswering(status, body),
        origin: ORIGIN,
      }),
    ).toEqual(SERVER_FEATURE_FLAGS_OFF);
  });

  it("a transport failure reads as off", async () => {
    const failing = vi.fn(() =>
      Promise.reject(new TypeError("network down")),
    ) as never;
    expect(
      await fetchServerFeatureFlags({
        token: "tok",
        fetchImplementation: failing,
        origin: ORIGIN,
      }),
    ).toEqual(SERVER_FEATURE_FLAGS_OFF);
  });
});

describe("resolveServerFeatureFlags (boot-time)", () => {
  it("an injected hint is authoritative and skips the API", async () => {
    const fetchImplementation = fetchAnswering(200, {
      selfTrack: true,
      replay: true,
    });
    const flags = await resolveServerFeatureFlags({
      scope: metaScope('{"selfTrack":true,"replay":false}'),
      token: "tok",
      fetchImplementation,
      origin: ORIGIN,
    });
    expect(flags).toEqual({ selfTrack: true, replay: false });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(hasServerFeatureHint(metaScope("{}"))).toBe(true);
    expect(hasServerFeatureHint(metaScope(null))).toBe(false);
  });

  it("without a hint, a stored session asks the API", async () => {
    const fetchImplementation = fetchAnswering(200, {
      selfTrack: true,
      replay: true,
    });
    const flags = await resolveServerFeatureFlags({
      scope: metaScope(null),
      token: "tok",
      fetchImplementation,
      origin: ORIGIN,
    });
    expect(flags).toEqual({ selfTrack: true, replay: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("without a hint, a signed-out visitor is off with no round trip", async () => {
    const fetchImplementation = fetchAnswering(200, {
      selfTrack: true,
      replay: true,
    });
    const flags = await resolveServerFeatureFlags({
      scope: metaScope(null),
      token: null,
      fetchImplementation,
      origin: ORIGIN,
    });
    expect(flags).toEqual(SERVER_FEATURE_FLAGS_OFF);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("active surface and the post-sign-in decision", () => {
  it("records the flags the router was built from", () => {
    expect(getActiveServerFeatureFlags()).toEqual(SERVER_FEATURE_FLAGS_OFF);
    setActiveServerFeatureFlags({ selfTrack: true, replay: false });
    expect(getActiveServerFeatureFlags()).toEqual({
      selfTrack: true,
      replay: false,
    });
    expect(
      featureSurfaceDiffers(
        { selfTrack: true, replay: false },
        { selfTrack: true, replay: false },
      ),
    ).toBe(false);
    expect(
      featureSurfaceDiffers(
        { selfTrack: true, replay: false },
        { selfTrack: true, replay: true },
      ),
    ).toBe(true);
  });

  it("an admitted account signing into an off router needs a reboot", async () => {
    expect(
      await featureSurfaceChangedForSession({
        token: "tok",
        fetchImplementation: fetchAnswering(200, {
          selfTrack: true,
          replay: false,
        }),
        origin: ORIGIN,
      }),
    ).toBe(true);
  });

  it("a concealed account (404) signing into an off router keeps the SPA navigation", async () => {
    expect(
      await featureSurfaceChangedForSession({
        token: "tok",
        fetchImplementation: fetchAnswering(404, {
          error: { code: "NOT_FOUND" },
        }),
        origin: ORIGIN,
      }),
    ).toBe(false);
  });

  it("a signed-out session compares as off", async () => {
    setActiveServerFeatureFlags({ selfTrack: true, replay: true });
    expect(await featureSurfaceChangedForSession({ token: null })).toBe(true);
    setActiveServerFeatureFlags(SERVER_FEATURE_FLAGS_OFF);
    expect(await featureSurfaceChangedForSession({ token: null })).toBe(false);
  });
});
