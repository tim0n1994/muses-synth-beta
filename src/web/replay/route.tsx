import { Suspense, lazy } from "react";
import type { RouteObject } from "react-router-dom";

// Route-level code splitting (batch-2 first-screen budget): the replay page
// ships in its own chunk, so a switched-off or unused replay surface costs
// the main bundle nothing (see scripts/check-bundle-budget.mjs).
const ReplayPage = lazy(() => import("./ReplayPage.js"));

export function replayRoutes(): RouteObject[] {
  return [
    {
      path: "/replay",
      element: (
        <Suspense fallback={null}>
          <ReplayPage />
        </Suspense>
      ),
    },
  ];
}
