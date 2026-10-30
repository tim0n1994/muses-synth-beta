import { describe, expect, it } from "vitest";

import { buildSurfaceSlots } from "../surface";
import type { DashboardSnapshot, EventsTimelineData } from "../types";
import {
  llmCooldownCapability,
  llmDisabledCapability,
  llmReadyCapability,
  llmUnconfiguredCapability,
  serverSnapshotFixture,
} from "./fixtures";

const emptyTimeline: EventsTimelineData = {
  items: [],
  totalLoaded: 0,
  hasMore: false,
  nextCursor: null,
};

function withWidgets(widgets: DashboardSnapshot["widgets"]): DashboardSnapshot {
  return { ...serverSnapshotFixture, widgets };
}

describe("buildSurfaceSlots", () => {
  it("renders the published widgets in published order", () => {
    const slots = buildSurfaceSlots(
      withWidgets([
        { id: "b", type: "evidence.list", props: { limit: 10 } },
        { id: "a", type: "state.hero", props: {} },
      ]),
      emptyTimeline,
    );

    expect(slots.map((slot) => slot.key)).toEqual(["b", "a"]);
  });

  it("renders nothing when the published surface is empty", () => {
    expect(buildSurfaceSlots(withWidgets([]), emptyTimeline)).toEqual([]);
  });

  it("honours a widget's own limit instead of a hardcoded one", () => {
    const [slot] = buildSurfaceSlots(
      withWidgets([{ id: "e", type: "evidence.list", props: { limit: 1 } }]),
      emptyTimeline,
    );

    if (slot?.block.type !== "evidence.list") {
      throw new Error("expected an evidence.list block");
    }
    expect(slot.block.data.items).toHaveLength(1);
    // The total still reports what the server holds, so "1 of N" stays honest.
    expect(slot.block.data.total).toBe(serverSnapshotFixture.evidence.total);
  });

  it("drops a widget whose data slice is absent this tick", () => {
    const snapshot = { ...withWidgets([]), decision: null };
    const slots = buildSurfaceSlots(
      { ...snapshot, widgets: [{ id: "d", type: "decision.card", props: {} }] },
      emptyTimeline,
    );

    expect(slots).toEqual([]);
  });

  it("hides NO_ACTION decisions only when the widget opts out", () => {
    const noAction = {
      ...serverSnapshotFixture,
      decision: {
        ...serverSnapshotFixture.decision,
        kind: "NO_ACTION" as const,
      },
    } as DashboardSnapshot;
    const widget = { id: "d", type: "decision.card", props: {} };

    expect(
      buildSurfaceSlots({ ...noAction, widgets: [widget] }, emptyTimeline),
    ).toHaveLength(1);
    expect(
      buildSurfaceSlots(
        {
          ...noAction,
          widgets: [{ ...widget, props: { showNoAction: false } }],
        },
        emptyTimeline,
      ),
    ).toHaveLength(0);
  });

  it("revokes transport affordances when manual override is disallowed", () => {
    const [slot] = buildSurfaceSlots(
      withWidgets([
        {
          id: "a",
          type: "audio.control",
          props: { allowManualOverride: false, showMasterVolume: true },
        },
      ]),
      emptyTimeline,
    );

    if (slot?.block.type !== "audio.control") {
      throw new Error("expected an audio.control block");
    }
    expect(slot.block.data.canPlay).toBe(false);
    expect(slot.block.data.canPause).toBe(false);
    expect(slot.block.data.canAdjustVolume).toBe(false);
  });

  it("routes rail types to the rail and everything else to the main column", () => {
    const slots = buildSurfaceSlots(
      withWidgets([
        { id: "hero", type: "state.hero", props: {} },
        { id: "metrics", type: "metrics.grid", props: {} },
      ]),
      emptyTimeline,
    );

    expect(slots.map((slot) => slot.region)).toEqual(["primary", "rail"]);
  });

  it("passes an unknown type through so the registry can show its fallback", () => {
    const slots = buildSurfaceSlots(
      withWidgets([{ id: "x", type: "not.a.widget", props: {} }]),
      emptyTimeline,
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]?.block.type).toBe("not.a.widget");
  });

  it("hides the AI narration widget whenever the enhancement is persistently unavailable", () => {
    const widget = { id: "llm", type: "llm.narration", props: {} };
    // Absent section, unconfigured, and disabled all hide the widget — the
    // optional enhancement is invisible when off, never greyed out.
    for (const llm of [
      null,
      llmUnconfiguredCapability,
      llmDisabledCapability,
    ]) {
      expect(
        buildSurfaceSlots(
          { ...serverSnapshotFixture, llm, widgets: [widget] },
          emptyTimeline,
        ),
      ).toEqual([]);
    }
  });

  it("keeps the AI narration panel during a cooldown and honours showModel", () => {
    const widget = { id: "llm", type: "llm.narration", props: {} };

    const [cooldownSlot] = buildSurfaceSlots(
      {
        ...serverSnapshotFixture,
        llm: llmCooldownCapability,
        widgets: [widget],
      },
      emptyTimeline,
    );
    if (cooldownSlot?.block.type !== "llm.narration") {
      throw new Error("expected an llm.narration block");
    }
    expect(cooldownSlot.region).toBe("rail");
    expect(cooldownSlot.title).toBe("AI narration");
    expect(cooldownSlot.block.data.reason).toBe("cooldown");
    expect(cooldownSlot.block.data.model).toBe("auto");

    // The registry props schema is closed, so the showModel display flag
    // rides the model slot as the "hidden" sentinel (privacy retentionLabel
    // precedent); the component reads it back to suppress the byline.
    const [croppedSlot] = buildSurfaceSlots(
      {
        ...serverSnapshotFixture,
        llm: llmReadyCapability,
        widgets: [{ ...widget, props: { showModel: false } }],
      },
      emptyTimeline,
    );
    if (croppedSlot?.block.type !== "llm.narration") {
      throw new Error("expected an llm.narration block");
    }
    expect(croppedSlot.block.data.model).toBe("hidden");
  });
});
