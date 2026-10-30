import type { ComponentType, CSSProperties } from "react";
import type { TSchema } from "@sinclair/typebox";

export const REGISTRY_SCHEMA_VERSION = "1.0" as const;

export const registryComponentTypes = [
  "state.hero",
  "belief.distribution",
  "evidence.list",
  "events.timeline",
  "decision.card",
  "audio.control",
  "metrics.grid",
  "privacy.status",
  "llm.narration",
] as const;

export type RegistryComponentType = (typeof registryComponentTypes)[number];

export const registryCapabilities = [
  "belief:read",
  "evidence:read",
  "events:read",
  "decision:read",
  "effect.audio:read",
  "effect.audio:write",
  "metrics:read",
  "privacy:read",
  "llm:read",
] as const;

export type RegistryCapability = (typeof registryCapabilities)[number];

export type RegistryActionName =
  | "decision.undo"
  | "audio.play"
  | "audio.pause"
  | "audio.mute"
  | "audio.unmute"
  | "audio.volume"
  | "llm.narrate"
  | "llm.summarize";

export interface RegistryAction {
  readonly componentId: string;
  readonly name: RegistryActionName;
  readonly payload?: unknown;
}

/**
 * Lifecycle of one user-triggered LLM generation (narration or summary).
 * `text` is untrusted model output: it may only ever reach a React text
 * node — never belief, policy, or effect state.
 */
export interface RegistryLlmGeneration {
  readonly status: "idle" | "loading" | "error" | "done";
  readonly text: string | null;
  readonly model: string | null;
  readonly error: string | null;
  readonly generatedAt: string | null;
}

export interface RegistryRuntimeContext {
  readonly capabilities: ReadonlySet<RegistryCapability>;
  readonly onAction?: (action: RegistryAction) => void;
  /**
   * Present only when the shell mounts the optional LLM generation layer.
   * Other components ignore it; `LlmNarration` renders nothing without it.
   */
  readonly llm?: {
    readonly narration: RegistryLlmGeneration;
    readonly summary: RegistryLlmGeneration;
  };
}

export interface RegistryRenderEnvelope {
  readonly id: string;
  readonly props: unknown;
  readonly runtime: RegistryRuntimeContext;
}

export type RegistryComponent = ComponentType<RegistryRenderEnvelope>;

export interface RegistryDescriptor {
  readonly type: RegistryComponentType;
  readonly schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  readonly schema: TSchema;
  readonly requiredCapabilities: readonly RegistryCapability[];
  readonly render: RegistryComponent;
}

export interface DashboardSectionLayout {
  readonly columnSpan: {
    readonly sm: 1 | 2 | 3 | 4;
    readonly md: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    readonly lg: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  };
  readonly order?: number;
}

export interface DashboardSectionInput {
  readonly id: string;
  readonly type: string;
  readonly schemaVersion: string;
  readonly props: unknown;
  readonly layout: DashboardSectionLayout;
}

export interface DashboardConfigInput {
  readonly schemaVersion: string;
  readonly dashboardId: string;
  readonly title?: string;
  readonly sections: readonly DashboardSectionInput[];
}

export interface DashboardSectionStyle extends CSSProperties {
  readonly "--muses-col-sm": number;
  readonly "--muses-col-md": number;
  readonly "--muses-col-lg": number;
  readonly "--muses-order": number;
}

export type RegistryFallbackReason =
  | "dashboard.invalid"
  | "dashboard.schema-version"
  | "component.unknown-type"
  | "component.invalid-props"
  | "component.schema-version"
  | "component.missing-capability"
  | "component.render-error";

export interface ValidationIssue {
  readonly path: string;
  readonly reason: RegistryFallbackReason;
  readonly message: string;
}

export interface ValidatedRenderableSection {
  readonly kind: "renderable";
  readonly id: string;
  readonly descriptor: RegistryDescriptor;
  readonly props: unknown;
  readonly layout: DashboardSectionLayout;
}

export interface ValidatedFallbackSection {
  readonly kind: "fallback";
  readonly id: string;
  readonly requestedType: string;
  readonly reason: Exclude<
    RegistryFallbackReason,
    "dashboard.invalid" | "dashboard.schema-version" | "component.render-error"
  >;
  readonly layout: DashboardSectionLayout;
}

export type ValidatedDashboardSection =
  ValidatedRenderableSection | ValidatedFallbackSection;

export const validatedDashboardBrand: unique symbol = Symbol(
  "muses.validated-dashboard",
);

export interface ValidatedDashboardConfig {
  readonly [validatedDashboardBrand]: true;
  readonly schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  readonly dashboardId: string;
  readonly title?: string;
  readonly sections: readonly ValidatedDashboardSection[];
  readonly issues: readonly ValidationIssue[];
}

export type DashboardValidationResult =
  | {
      readonly ok: true;
      readonly value: ValidatedDashboardConfig;
    }
  | {
      readonly ok: false;
      readonly reason: "dashboard.invalid" | "dashboard.schema-version";
      readonly issues: readonly ValidationIssue[];
    };
