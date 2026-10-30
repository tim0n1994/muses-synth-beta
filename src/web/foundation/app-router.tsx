import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { AdminUsersRoute, LoginRoute, RegisterRoute } from "../auth/routes.js";
import { selfTrackPlayerRoutes } from "../player/route.js";
import { replayRoutes } from "../replay/route.js";
import { signatureRoutes } from "../signature/index.js";
import { DashboardRoute } from "../dashboard/route.js";
import { SettingsRoute } from "../settings/route.js";
import { FoundationStatusPage } from "./foundation-status-page.js";
import {
  readServerFeatureFlags,
  type ServerFeatureFlags,
} from "./feature-flags.js";

export type MusesRouter = ReturnType<typeof createBrowserRouter>;

export interface CreateMusesRouterOptions {
  /**
   * Server-provided feature flags; defaults to the hint injected into the
   * HTML shell (the muses-features meta tag, fail-closed to off when
   * absent — see feature-flags.ts). Tests inject explicit values.
   */
  readonly features?: ServerFeatureFlags;
}

/** The frozen v0.6 route set — everything below mounts unconditionally. */
export const V06_ROUTE_PATHS: readonly string[] = [
  "/",
  "/settings",
  "/login",
  "/register",
  "/admin/users",
  "*",
];

/**
 * Pure route-table builder so the flag-off/flag-on surface is testable
 * without a browser: the v0.7 routes (self-track player + signature panel
 * under batch 1, replay under batch 2) are appended ONLY when the server
 * hint says so. Flag-off therefore produces exactly the v0.6 table — the
 * unknown URLs /self-track, /signature and /replay land on the same
 * foundation catch-all v0.6 served, never on half-registered error pages.
 */
export function musesRouteObjects(
  features: ServerFeatureFlags,
  moduleRoutes: readonly RouteObject[] = [],
): RouteObject[] {
  return [
    {
      element: <DashboardRoute />,
      path: "/",
    },
    {
      element: <SettingsRoute />,
      path: "/settings",
    },
    {
      element: <LoginRoute />,
      path: "/login",
    },
    {
      element: <RegisterRoute />,
      path: "/register",
    },
    {
      element: <AdminUsersRoute />,
      path: "/admin/users",
    },
    // v0.7 surfaces, all route-level code-split (first-screen budget) and
    // gated on the SERVER-provided feature hint (V11): the routes exist
    // client-side only while the server-side switches are on. The hint is a
    // meta tag injected into index.html at serve time; absent hint =
    // flag-off = the v0.6 route table exactly.
    ...(features.selfTrack
      ? [...selfTrackPlayerRoutes(), ...signatureRoutes()]
      : []),
    ...(features.replay ? replayRoutes() : []),
    ...moduleRoutes,
    {
      element: <FoundationStatusPage />,
      path: "*",
    },
  ];
}

export function createMusesRouter(
  moduleRoutes: readonly RouteObject[] = [],
  options: CreateMusesRouterOptions = {},
): MusesRouter {
  return createBrowserRouter(
    musesRouteObjects(
      options.features ?? readServerFeatureFlags(),
      moduleRoutes,
    ),
  );
}
