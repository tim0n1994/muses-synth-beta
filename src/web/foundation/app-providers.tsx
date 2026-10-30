import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";

import type { MusesRouter } from "./app-router.js";
import { RootErrorBoundary } from "./root-error-boundary.js";

export interface AppProvidersProps {
  readonly queryClient: QueryClient;
  readonly router: MusesRouter;
}

export function AppProviders({
  queryClient,
  router,
}: AppProvidersProps): React.JSX.Element {
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}
