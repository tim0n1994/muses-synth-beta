import { useMemo } from "react";
import { RegistryErrorBoundary } from "./RegistryErrorBoundary";
import { SafeFallback } from "./SafeFallback";
import { validateDashboardConfig } from "./validate";
import type {
  DashboardSectionStyle,
  RegistryAction,
  RegistryCapability,
  RegistryRuntimeContext,
  ValidatedDashboardConfig,
  ValidatedDashboardSection,
} from "./types";

export interface DashboardRendererProps {
  readonly config: unknown;
  readonly capabilities: readonly RegistryCapability[];
  readonly onAction?: (action: RegistryAction) => void;
  readonly onComponentError?: (componentId: string, error: Error) => void;
}

function sectionStyle(
  section: ValidatedDashboardSection,
): DashboardSectionStyle {
  return {
    "--muses-col-sm": section.layout.columnSpan.sm,
    "--muses-col-md": section.layout.columnSpan.md,
    "--muses-col-lg": section.layout.columnSpan.lg,
    "--muses-order": section.layout.order ?? 0,
  };
}

interface ValidatedRendererProps {
  readonly config: ValidatedDashboardConfig;
  readonly runtime: RegistryRuntimeContext;
  readonly onComponentError?: (componentId: string, error: Error) => void;
}

function ValidatedDashboardRenderer({
  config,
  onComponentError,
  runtime,
}: ValidatedRendererProps) {
  return (
    <section
      aria-label={config.title ?? "Muses dashboard"}
      data-dashboard-id={config.dashboardId}
    >
      {config.title !== undefined && <h1>{config.title}</h1>}
      <div className="muses-dashboard-grid">
        {config.sections.map((section) => {
          if (section.kind === "fallback") {
            return (
              <div
                className="muses-dashboard-section"
                key={section.id}
                style={sectionStyle(section)}
              >
                <SafeFallback
                  id={section.id}
                  reason={section.reason}
                  requestedType={section.requestedType}
                />
              </div>
            );
          }

          const Component = section.descriptor.render;
          return (
            <div
              className="muses-dashboard-section"
              key={section.id}
              style={sectionStyle(section)}
            >
              <RegistryErrorBoundary
                componentId={section.id}
                onError={(error) => onComponentError?.(section.id, error)}
                requestedType={section.descriptor.type}
              >
                <Component
                  id={section.id}
                  props={section.props}
                  runtime={runtime}
                />
              </RegistryErrorBoundary>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardRenderer({
  capabilities,
  config,
  onAction,
  onComponentError,
}: DashboardRendererProps) {
  const capabilitySet = useMemo(
    () => new Set<RegistryCapability>(capabilities),
    [capabilities],
  );
  const validation = useMemo(
    () => validateDashboardConfig(config, capabilitySet),
    [capabilitySet, config],
  );
  const runtime = useMemo<RegistryRuntimeContext>(
    () =>
      onAction === undefined
        ? { capabilities: capabilitySet }
        : { capabilities: capabilitySet, onAction },
    [capabilitySet, onAction],
  );

  if (!validation.ok) {
    return <SafeFallback id="dashboard" reason={validation.reason} />;
  }

  return onComponentError === undefined ? (
    <ValidatedDashboardRenderer config={validation.value} runtime={runtime} />
  ) : (
    <ValidatedDashboardRenderer
      config={validation.value}
      onComponentError={onComponentError}
      runtime={runtime}
    />
  );
}
