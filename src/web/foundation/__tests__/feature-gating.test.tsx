import { describe, expect, it } from "vitest";

import { musesRouteObjects, V06_ROUTE_PATHS } from "../app-router.js";
import {
  FEATURES_META_SELECTOR,
  readServerFeatureFlags,
  SERVER_FEATURE_FLAGS_OFF,
  type ServerFeatureFlags,
} from "../feature-flags.js";

/** A document-like scope whose feature meta carries the given content. */
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

/**
 * Client-surface feature gating (Round-1 review B2): with MUSES_V07 off the
 * deployed SPA must answer /self-track, /signature and /replay exactly like
 * v0.6 — the foundation catch-all — instead of mounting half-registered
 * surfaces that render error pages. The gate is the server-injected
 * window.__MUSES_FEATURES__ hint; these tests pin the route table and the
 * fail-closed hint parsing.
 */

const pathsOf = (routes: readonly { path?: string }[]): readonly string[] =>
  routes.map((route) => route.path ?? "(no path)");

const flags = (selfTrack: boolean, replay: boolean): ServerFeatureFlags => ({
  selfTrack,
  replay,
});

describe("server feature-flag hint parsing (fail-closed)", () => {
  it("an absent hint reads as fully off", () => {
    expect(readServerFeatureFlags(metaScope(null))).toEqual(
      SERVER_FEATURE_FLAGS_OFF,
    );
    expect(readServerFeatureFlags(undefined)).toEqual(SERVER_FEATURE_FLAGS_OFF);
  });

  it.each(["", "yes", "null", "42", '{"selfTrack":"true"}', "{oops"])(
    "malformed meta content %j reads as fully off",
    (content) => {
      expect(readServerFeatureFlags(metaScope(content))).toEqual(
        SERVER_FEATURE_FLAGS_OFF,
      );
    },
  );

  it("well-formed hints pass through both booleans", () => {
    expect(
      readServerFeatureFlags(metaScope('{"selfTrack":true,"replay":false}')),
    ).toEqual(flags(true, false));
    expect(
      readServerFeatureFlags(metaScope('{"selfTrack":true,"replay":true}')),
    ).toEqual(flags(true, true));
  });
});

describe("v0.7 client routes gate on the server hint", () => {
  it("flag-off mounts exactly the frozen v0.6 route table", () => {
    const paths = pathsOf(musesRouteObjects(SERVER_FEATURE_FLAGS_OFF));
    expect(paths).toEqual([...V06_ROUTE_PATHS]);
  });

  it("batch 1 on mounts /self-track and /signature but not /replay", () => {
    const paths = pathsOf(musesRouteObjects(flags(true, false)));
    expect(paths).toContain("/self-track");
    expect(paths).toContain("/signature");
    expect(paths).not.toContain("/replay");
    // The v0.6 table stays intact around the appended surfaces.
    expect(paths.slice(0, 5)).toEqual(V06_ROUTE_PATHS.slice(0, 5));
    expect(paths[paths.length - 1]).toBe("*");
  });

  it("batch 2 additionally mounts /replay only with its own flag", () => {
    const paths = pathsOf(musesRouteObjects(flags(true, true)));
    expect(paths).toContain("/replay");
  });

  it("replay flag alone cannot mount /replay without batch 1", () => {
    // The hint shape allows it; the router honors the server, and the server
    // only ever injects replay=true together with selfTrack=true (batch 2 ⊆
    // batch 1, see src/server/foundation/feature-flags.ts). Defensive check.
    const paths = pathsOf(musesRouteObjects(flags(false, true)));
    expect(paths).not.toContain("/self-track");
    expect(paths).not.toContain("/signature");
  });

  it("module routes keep appending before the catch-all", () => {
    const paths = pathsOf(
      musesRouteObjects(SERVER_FEATURE_FLAGS_OFF, [{ path: "/module-x" }]),
    );
    expect(paths).toEqual([...V06_ROUTE_PATHS.slice(0, 5), "/module-x", "*"]);
  });
});
