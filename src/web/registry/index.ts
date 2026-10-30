export {
  adaptM2DashboardEnvelope,
  type M2DashboardEnvelopeV1,
} from "./adapter";
export {
  DashboardRenderer,
  type DashboardRendererProps,
} from "./DashboardRenderer";
export { RegistryErrorBoundary } from "./RegistryErrorBoundary";
export { SafeFallback, type SafeFallbackProps } from "./SafeFallback";
export {
  componentRegistry,
  getRegistryDescriptor,
  isRegistryComponentType,
  listRegistryComponents,
} from "./registry";
export { validateDashboardConfig } from "./validate";
export {
  REGISTRY_SCHEMA_VERSION,
  registryCapabilities,
  registryComponentTypes,
  type DashboardConfigInput,
  type DashboardValidationResult,
  type RegistryAction,
  type RegistryActionName,
  type RegistryCapability,
  type RegistryComponentType,
  type RegistryFallbackReason,
  type ValidatedDashboardConfig,
  type ValidationIssue,
} from "./types";
