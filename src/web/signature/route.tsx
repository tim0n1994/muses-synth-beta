import { Suspense, lazy } from "react";
import type { RouteObject } from "react-router-dom";

// Route-level code splitting (batch-1 first-screen budget; see
// scripts/check-bundle-budget.mjs).
const SignaturePanelPage = lazy(() => import("./SignaturePanelPage.js"));

export function signatureRoutes(): RouteObject[] {
  return [
    {
      path: "/signature",
      element: (
        <Suspense fallback={null}>
          <SignaturePanelPage />
        </Suspense>
      ),
    },
  ];
}
