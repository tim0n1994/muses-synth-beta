import type {
  RegistryComponent,
  RegistryComponentType,
  RegistryDescriptor,
} from "./types";
import { REGISTRY_SCHEMA_VERSION, registryComponentTypes } from "./types";
import {
  audioControlSchema,
  beliefDistributionSchema,
  decisionCardSchema,
  eventsTimelineSchema,
  evidenceListSchema,
  llmNarrationSchema,
  metricsGridSchema,
  privacyStatusSchema,
  stateHeroSchema,
} from "./schemas";
import { AudioControl } from "./components/AudioControl";
import { BeliefDistribution } from "./components/BeliefDistribution";
import { DecisionCard } from "./components/DecisionCard";
import { EventsTimeline } from "./components/EventsTimeline";
import { EvidenceList } from "./components/EvidenceList";
import { LlmNarration } from "./components/LlmNarration";
import { MetricsGrid } from "./components/MetricsGrid";
import { PrivacyStatus } from "./components/PrivacyStatus";
import { StateHero } from "./components/StateHero";

const descriptors = {
  "state.hero": {
    type: "state.hero",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: stateHeroSchema,
    requiredCapabilities: ["belief:read"],
    render: StateHero,
  },
  "belief.distribution": {
    type: "belief.distribution",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: beliefDistributionSchema,
    requiredCapabilities: ["belief:read"],
    render: BeliefDistribution,
  },
  "evidence.list": {
    type: "evidence.list",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: evidenceListSchema,
    requiredCapabilities: ["evidence:read"],
    render: EvidenceList,
  },
  "events.timeline": {
    type: "events.timeline",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: eventsTimelineSchema,
    requiredCapabilities: ["events:read"],
    render: EventsTimeline,
  },
  "decision.card": {
    type: "decision.card",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: decisionCardSchema,
    requiredCapabilities: ["decision:read"],
    render: DecisionCard,
  },
  "audio.control": {
    type: "audio.control",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: audioControlSchema,
    requiredCapabilities: ["effect.audio:read", "effect.audio:write"],
    render: AudioControl,
  },
  "metrics.grid": {
    type: "metrics.grid",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: metricsGridSchema,
    requiredCapabilities: ["metrics:read"],
    render: MetricsGrid,
  },
  "privacy.status": {
    type: "privacy.status",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: privacyStatusSchema,
    requiredCapabilities: ["privacy:read"],
    render: PrivacyStatus,
  },
  "llm.narration": {
    type: "llm.narration",
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    schema: llmNarrationSchema,
    requiredCapabilities: ["llm:read"],
    render: LlmNarration,
  },
} satisfies Record<RegistryComponentType, RegistryDescriptor>;

export const componentRegistry: Readonly<
  Record<RegistryComponentType, RegistryDescriptor>
> = descriptors;

export function isRegistryComponentType(
  value: string,
): value is RegistryComponentType {
  return (registryComponentTypes as readonly string[]).includes(value);
}

export function getRegistryDescriptor(
  type: RegistryComponentType,
): RegistryDescriptor {
  return componentRegistry[type];
}

export function listRegistryComponents(): readonly RegistryComponentType[] {
  return registryComponentTypes;
}

export function replaceRegistryComponentForTest(
  descriptor: RegistryDescriptor,
  render: RegistryComponent,
): RegistryDescriptor {
  return { ...descriptor, render };
}
