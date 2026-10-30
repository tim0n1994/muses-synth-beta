import {
  createTranslator,
  DEFAULT_LANGUAGE,
  type MessageKey,
  type Translator,
} from "../i18n";
import type {
  DashboardRegistryBlock,
  DashboardSnapshot,
  EventsTimelineData,
  JsonValue,
  SurfaceWidget,
} from "./types";

export type SurfaceRegion = "primary" | "rail";

export interface SurfaceSlot {
  readonly key: string;
  readonly title: string;
  readonly region: SurfaceRegion;
  readonly block: DashboardRegistryBlock;
}

/**
 * Types that belong in the narrow rail rather than the main column. This is a
 * layout decision, not a configuration one: the published document controls
 * *which* components exist and in what order, while the shell decides which of
 * its two responsive regions each type reads best in.
 */
const RAIL_TYPES = new Set([
  "audio.control",
  "metrics.grid",
  "privacy.status",
  "llm.narration",
]);

/** Catalog keys; the shell translates when it builds the slot list. */
export const SURFACE_TITLE_KEYS: Readonly<Record<string, MessageKey>> = {
  "state.hero": "dashboard.surface.state.hero",
  "belief.distribution": "dashboard.surface.belief.distribution",
  "evidence.list": "dashboard.surface.evidence.list",
  "events.timeline": "dashboard.surface.events.timeline",
  "decision.card": "dashboard.surface.decision.card",
  "audio.control": "dashboard.surface.audio.control",
  "metrics.grid": "dashboard.surface.metrics.grid",
  "privacy.status": "dashboard.surface.privacy.status",
  "llm.narration": "dashboard.surface.llm.narration",
};

function readNumber(
  props: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback: number,
): number {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(
  props: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = props[key];
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(
  props: Readonly<Record<string, JsonValue>>,
  key: string,
): readonly string[] | null {
  const value = props[key];
  return Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === "string")
    ? value
    : null;
}

/**
 * Turns the published `settings.surface.widgets` list into the ordered blocks
 * the shell renders, applying each widget's own props to the data it receives.
 *
 * This is what makes the dashboard genuinely server-configured: publishing a
 * different widget list, a different order, or a different `limit` changes what
 * is on screen. A widget whose data slice is absent this tick is dropped rather
 * than rendered empty; an unknown type is passed through so the registry shows
 * its documented fallback.
 */
export function buildSurfaceSlots(
  snapshot: DashboardSnapshot,
  timeline: EventsTimelineData,
  t: Translator = createTranslator(DEFAULT_LANGUAGE),
): readonly SurfaceSlot[] {
  return snapshot.widgets.flatMap((widget): SurfaceSlot[] => {
    const block = buildBlock(widget, snapshot, timeline);
    if (block === null) {
      return [];
    }
    const titleKey = SURFACE_TITLE_KEYS[widget.type];
    return [
      {
        key: widget.id,
        title: titleKey === undefined ? widget.type : t(titleKey),
        region: RAIL_TYPES.has(widget.type) ? "rail" : "primary",
        block,
      },
    ];
  });
}

function buildBlock(
  widget: SurfaceWidget,
  snapshot: DashboardSnapshot,
  timeline: EventsTimelineData,
): DashboardRegistryBlock | null {
  const { props } = widget;
  switch (widget.type) {
    case "state.hero": {
      if (snapshot.state === null) {
        return null;
      }
      const showUnknownReason = readBoolean(props, "showUnknownReason", true);
      return {
        type: "state.hero",
        data: {
          ...snapshot.state,
          confidence: readBoolean(props, "showConfidence", true)
            ? snapshot.state.confidence
            : 0,
          ...(showUnknownReason
            ? {}
            : { unknownReason: undefined as string | undefined }),
        },
      };
    }
    case "belief.distribution": {
      if (snapshot.belief === null) {
        return null;
      }
      const maxStates = readNumber(props, "maxStates", 5);
      return {
        type: "belief.distribution",
        data: {
          ...snapshot.belief,
          factors: snapshot.belief.factors.slice(0, Math.max(1, maxStates)),
        },
      };
    }
    case "evidence.list": {
      const limit = readNumber(props, "limit", 10);
      const showSource = readBoolean(props, "showSource", true);
      return {
        type: "evidence.list",
        data: {
          total: snapshot.evidence.total,
          items: snapshot.evidence.items
            .slice(0, Math.max(1, limit))
            .map((item) =>
              showSource ? item : { ...item, sourceLabel: "", sourceType: "" },
            ),
        },
      };
    }
    case "events.timeline": {
      const limit = readNumber(props, "limit", 50);
      const showPayloadSummary = readBoolean(props, "showPayloadSummary", true);
      const items = timeline.items
        .slice(0, Math.max(1, limit))
        .map((item) => (showPayloadSummary ? item : { ...item, detail: "" }));
      return {
        type: "events.timeline",
        data: { ...timeline, items, totalLoaded: items.length },
      };
    }
    case "decision.card": {
      if (snapshot.decision === null) {
        return null;
      }
      // `showNoAction: false` is how a user opts out of seeing the engine
      // decline; NO_ACTION stays first-class on the server either way.
      if (
        snapshot.decision.kind === "NO_ACTION" &&
        !readBoolean(props, "showNoAction", true)
      ) {
        return null;
      }
      return {
        type: "decision.card",
        data: readBoolean(props, "showUndoAvailability", true)
          ? snapshot.decision
          : { ...snapshot.decision, undoAvailable: false },
      };
    }
    case "audio.control": {
      if (snapshot.audio === null) {
        return null;
      }
      const allowManualOverride = readBoolean(
        props,
        "allowManualOverride",
        true,
      );
      return {
        type: "audio.control",
        data: {
          ...snapshot.audio,
          canPlay: snapshot.audio.canPlay && allowManualOverride,
          canPause: snapshot.audio.canPause && allowManualOverride,
          canAdjustVolume:
            snapshot.audio.canAdjustVolume &&
            allowManualOverride &&
            readBoolean(props, "showMasterVolume", true),
        },
      };
    }
    case "metrics.grid": {
      if (snapshot.metrics === null) {
        return null;
      }
      const selected = readStringArray(props, "metrics");
      if (selected === null) {
        return { type: "metrics.grid", data: snapshot.metrics };
      }
      // Ids match exactly against the published enum; a selection that leaves
      // nothing drops the widget rather than rendering an empty grid.
      const items = snapshot.metrics.items.filter((item) =>
        selected.includes(item.id),
      );
      if (items.length === 0) {
        return null;
      }
      return { type: "metrics.grid", data: { ...snapshot.metrics, items } };
    }
    case "privacy.status": {
      if (snapshot.privacy === null) {
        return null;
      }
      const showExcluded = readBoolean(props, "showExcludedApplications", true);
      return {
        type: "privacy.status",
        data: {
          ...snapshot.privacy,
          ...(readBoolean(props, "showRetention", true)
            ? {}
            : { retentionLabel: "hidden" }),
          capabilities: showExcluded
            ? snapshot.privacy.capabilities
            : snapshot.privacy.capabilities.filter(
                (capability) => !capability.id.includes("excluded"),
              ),
        },
      };
    }
    case "llm.narration": {
      // Persistent unavailability (unconfigured/disabled) hides the widget
      // entirely — the optional enhancement must be invisible when off, not
      // greyed out with an error. A cooldown keeps `available` true, so the
      // panel stays and explains itself (rev3 final-review correction).
      if (snapshot.llm === null || !snapshot.llm.available) {
        return null;
      }
      // The registry props schema is the closed {available, model, reason};
      // widget display flags are folded into data here exactly like
      // privacy's `retentionLabel: "hidden"`. The component treats the
      // sentinel as "do not show the generated-by line".
      const showModel = readBoolean(props, "showModel", true);
      return {
        type: "llm.narration",
        data: {
          ...snapshot.llm,
          model: showModel ? snapshot.llm.model : "hidden",
        },
      };
    }
    default:
      // Unknown type: hand it to the registry, which renders its isolated
      // diagnostic fallback (PRD-v0.1 §6).
      return {
        type: widget.type,
        data: widget.props,
      } as unknown as DashboardRegistryBlock;
  }
}
