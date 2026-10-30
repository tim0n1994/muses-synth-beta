import { useState } from "react";
import { DesignSystemProvider } from "../../design-system";
import { DashboardRenderer } from "../DashboardRenderer";
import {
  allRegistryCapabilities,
  representativeDashboardConfig,
} from "../fixtures";
import type { RegistryAction } from "../types";

export function RegistryHarness() {
  const [lastAction, setLastAction] = useState<RegistryAction | undefined>();

  return (
    <DesignSystemProvider theme="system">
      <main className="muses-page">
        <DashboardRenderer
          capabilities={allRegistryCapabilities}
          config={representativeDashboardConfig}
          onAction={setLastAction}
        />
        <output aria-live="polite">
          {lastAction === undefined
            ? "No action requested."
            : `Last action: ${lastAction.name}`}
        </output>
      </main>
    </DesignSystemProvider>
  );
}
