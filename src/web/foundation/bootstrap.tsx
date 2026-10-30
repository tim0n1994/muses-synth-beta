import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RouteObject } from "react-router-dom";

import { AppProviders } from "./app-providers.js";
import { createMusesRouter } from "./app-router.js";
import {
  resolveServerFeatureFlags,
  setActiveServerFeatureFlags,
  type ServerFeatureFlags,
} from "./feature-flags.js";
import { createQueryClient } from "./query-client.js";

export interface BootstrapOptions {
  readonly routes?: readonly RouteObject[];
  /** Explicit flags (tests); default resolves hint → session API → off. */
  readonly features?: ServerFeatureFlags;
}

export async function bootstrapApplication(
  element: HTMLElement,
  options: BootstrapOptions = {},
): Promise<Root> {
  // The v0.7 client routes are decided once, here, from the server's answer
  // for THIS visitor (Round-2 per-user allowlist): an injected shell hint
  // when present, otherwise the stored session asks /api/v1/features, and a
  // signed-out visitor boots the v0.6 table without a round trip.
  const features = options.features ?? (await resolveServerFeatureFlags());
  setActiveServerFeatureFlags(features);
  const queryClient = createQueryClient();
  const router = createMusesRouter(options.routes ?? [], { features });
  const root = createRoot(element);

  root.render(
    <StrictMode>
      <AppProviders queryClient={queryClient} router={router} />
    </StrictMode>,
  );

  return root;
}
