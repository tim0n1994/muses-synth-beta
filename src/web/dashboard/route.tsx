import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AudioRuntime } from "../audio/audio-runtime.js";
import { AuthChrome, resolveBrowserLanguage } from "../auth/index.js";
import { getRegistryDescriptor } from "../registry/registry.js";
import { dispatchRegistryAction } from "./registry-actions.js";
import { toRegistryProps } from "./registry-props.js";
import { registryCapabilities } from "../registry/types.js";
import {
  createDashboardApiClient,
  Dashboard,
  type DashboardRegistry,
  type DashboardRegistryBlock,
  type DashboardRegistryContext,
} from "./index.js";
import { I18nProvider } from "../i18n/index.js";

const FULL_CAPABILITIES = new Set(registryCapabilities);

/**
 * Composition root wiring the v0.2 registry components into the dashboard
 * shell. Block types are statically imported; the server only selects which
 * of the nine known blocks to render.
 */
function renderRegistryBlock(
  block: DashboardRegistryBlock,
  context: DashboardRegistryContext,
): ReactNode {
  const descriptor = getRegistryDescriptor(block.type);
  return (
    <descriptor.render
      id={block.type}
      props={toRegistryProps(block)}
      runtime={{
        capabilities: FULL_CAPABILITIES,
        onAction: (action) => dispatchRegistryAction(action, context.actions),
        llm: context.llm,
      }}
    />
  );
}

const staticRegistry: DashboardRegistry = { render: renderRegistryBlock };

export function DashboardRoute(): ReactNode {
  const api = useMemo(() => createDashboardApiClient(), []);
  const [audioRuntime, setAudioRuntime] = useState<AudioRuntime | null>(null);
  useEffect(() => {
    // Own the runtime per setup, not per render: StrictMode replays cleanup
    // and setup, so a memoized runtime would reuse a terminally disposed engine.
    const runtime = new AudioRuntime();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishes the newly acquired external audio resource.
    setAudioRuntime(runtime);
    return () => {
      void runtime.dispose().catch(() => {
        // The route is gone; disposal has already detached/stopped the graph.
      });
    };
  }, []);
  if (audioRuntime === null) return null;
  return (
    <I18nProvider lang={resolveBrowserLanguage()}>
      <AuthChrome>
        <Dashboard
          api={api}
          registry={staticRegistry}
          audioRuntime={audioRuntime}
        />
      </AuthChrome>
    </I18nProvider>
  );
}
