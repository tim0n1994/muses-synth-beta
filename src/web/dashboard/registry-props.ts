import { describeBeliefState } from "../../server/belief/vocabulary";
import { gainToPercent } from "../audio/volume";
import type { DashboardRegistryBlock, DecisionKind } from "./types";

/**
 * Translates a dashboard data block into the props its registry component
 * declares.
 *
 * These are two deliberately different shapes: the dashboard block carries what
 * the server reported, the registry props carry what a component renders. v0.1
 * passed the former straight into the latter, so `state.hero` received
 * `{ code, label, observedAt }` while reading `{ status, title, updatedAt }` —
 * every field came back `undefined` and the hero rendered an empty badge.
 * `registry-props.contract.test.ts` validates every output here against the
 * registry's own JSON Schemas, so the two can no longer drift silently.
 */
export function toRegistryProps(
  block: DashboardRegistryBlock,
): Record<string, unknown> {
  switch (block.type) {
    case "state.hero": {
      const descriptor = describeBeliefState(block.data.code);
      return {
        status: descriptor.state,
        statusLabel: block.data.label,
        confidence: clampUnit(block.data.confidence),
        summary: truncate(block.data.summary, 240) || descriptor.description,
        updatedAt: block.data.observedAt,
        ...(block.data.unknownReason === undefined
          ? {}
          : { unknownReason: truncate(block.data.unknownReason, 240) }),
      };
    }
    case "belief.distribution":
      return {
        factors: block.data.factors.slice(0, 12).map((factor) => ({
          id: factor.id,
          label: truncate(factor.label, 80),
          probability: clampUnit(factor.probability),
          direction:
            factor.direction === "positive"
              ? 1
              : factor.direction === "negative"
                ? -1
                : 0,
          evidenceCount: Math.max(0, Math.round(factor.evidenceCount)),
        })),
      };
    case "evidence.list":
      return {
        evidence: block.data.items.slice(0, 24).map((item) => ({
          id: item.id,
          label: truncate(item.title, 240),
          source: truncate(item.sourceLabel, 80) || "local",
          weight: Math.max(-1, Math.min(1, item.weight)),
          observedAt: item.observedAt,
          ...(item.detail.length === 0
            ? {}
            : { explanation: truncate(item.detail, 240) }),
        })),
      };
    case "events.timeline":
      return {
        events: block.data.items.slice(0, 50).map((event) => ({
          id: event.id,
          kind: truncate(event.type, 80),
          title: truncate(event.title, 240),
          occurredAt: event.occurredAt,
          ...(event.detail.length === 0
            ? {}
            : { summary: truncate(event.detail, 240) }),
        })),
      };
    case "decision.card":
      return {
        decision: toRegistryDecision(block.data.kind),
        confidence: clampUnit(block.data.confidence),
        rationale:
          truncate(block.data.rationale, 240) ||
          block.data.noActionReason ||
          "No rationale was recorded.",
        reversible: block.data.reversible,
        ...(block.data.undoUntil === undefined
          ? {}
          : { expiresAt: block.data.undoUntil }),
      };
    case "audio.control":
      // Dashboard projects the current tab's runtime onto this block first;
      // a shared historical effect receipt is not a live playback signal.
      return {
        playing: block.data.status === "playing",
        muted: block.data.status === "paused",
        volume: gainToPercent(block.data.volume),
        ...(block.data.title === undefined
          ? {}
          : { trackTitle: truncate(block.data.title, 80) }),
        ...(block.data.canPlay
          ? {}
          : {
              disabledReason:
                block.data.effectId === undefined
                  ? "Waiting for an audio suggestion from the current state."
                  : "Audio automation is disabled in the published settings.",
            }),
      };
    case "metrics.grid":
      return {
        metrics: block.data.items.slice(0, 16).map((item) => ({
          id: item.id,
          label: truncate(item.label, 80),
          value: truncate(item.displayValue, 48) || "—",
          trend: item.trend ?? "unknown",
        })),
      };
    case "privacy.status":
      return {
        localOnly: block.data.localOnly,
        sensors: [
          ...new Set(
            block.data.capabilities
              .filter((capability) => capability.enabled)
              .map((capability) => truncate(capability.label, 80)),
          ),
        ].slice(0, 24),
        retention: truncate(block.data.retentionLabel, 80),
        pendingDeletionCount: 0,
      };
    case "llm.narration":
      return {
        available: block.data.available,
        model: truncate(block.data.model, 80),
        reason: truncate(block.data.reason, 240),
      };
    default:
      // Unknown block type: hand the raw data through so the registry renders
      // its documented diagnostic fallback rather than crashing.
      return block;
  }
}

/**
 * The registry's decision vocabulary predates the policy engine's and is a
 * UI-affordance list ("what is the card offering"), not the engine's decision
 * kinds. Anything the registry cannot name renders as UNKNOWN rather than
 * being silently dropped.
 */
function toRegistryDecision(
  kind: DecisionKind,
): "NO_ACTION" | "SUGGEST_AUDIO" | "PAUSE_AUDIO" | "ADJUST_VOLUME" | "UNKNOWN" {
  switch (kind) {
    case "NO_ACTION":
      return "NO_ACTION";
    case "PLAY_AUDIO":
      return "SUGGEST_AUDIO";
    case "PAUSE_AUDIO":
      return "PAUSE_AUDIO";
    case "ADJUST_AUDIO":
      return "ADJUST_VOLUME";
    default:
      return "UNKNOWN";
  }
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
