import { Suspense, lazy } from "react";
import type { RouteObject } from "react-router-dom";

// Route-level code splitting: the player page (and everything it pulls in)
// ships in its own chunk, keeping the first-screen payload of the main app
// untouched. See scripts/check-bundle-budget.mjs for the enforced budget.
const SelfTrackPlayerPage = lazy(() => import("./SelfTrackPlayerPage.js"));

export function selfTrackPlayerRoutes(): RouteObject[] {
  return [
    {
      path: "/self-track",
      element: (
        <Suspense fallback={null}>
          <SelfTrackPlayerPage />
        </Suspense>
      ),
    },
  ];
}
