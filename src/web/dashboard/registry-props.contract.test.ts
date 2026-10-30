import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import { getRegistryDescriptor } from "../registry/registry";
import { toRegistryProps } from "./registry-props";
import { buildSurfaceSlots } from "./surface";
import {
  llmSnapshotFixture,
  serverSnapshotFixture,
} from "./__tests__/fixtures";
import type { DashboardSnapshot, EventsTimelineData } from "./types";

const ajv = new Ajv({ allErrors: true, strict: true });

const timeline: EventsTimelineData = {
  items: [
    {
      id: "event-9",
      type: "muses.editor.activity",
      title: "Editor saved a file",
      detail: "src/server/policy/engine.ts",
      occurredAt: "2026-08-21T09:59:00.000Z",
      source: "urn:muses:local",
      metadata: {},
    },
  ],
  totalLoaded: 1,
  hasMore: false,
  nextCursor: null,
};

/**
 * The composition root feeds registry components with data that came from the
 * server. Their JSON Schemas are the contract, and v0.1 violated it for every
 * single component — nothing validated the props on the render path, so the
 * dashboard rendered structurally present but semantically empty panels.
 */
describe("dashboard block to registry props", () => {
  const snapshot: DashboardSnapshot = serverSnapshotFixture;

  it("produces schema-valid props for every published widget", () => {
    const slots = buildSurfaceSlots(snapshot, timeline);
    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const descriptor = getRegistryDescriptor(slot.block.type);
      const validate = ajv.compile(descriptor.schema);
      const props = toRegistryProps(slot.block);

      expect(
        validate(props),
        `${slot.block.type} props failed its registry schema: ${ajv.errorsText(
          validate.errors,
        )}`,
      ).toBe(true);
    }
  });

  it("produces schema-valid props for the optional AI narration widget too", () => {
    const slots = buildSurfaceSlots(llmSnapshotFixture, timeline);
    const llmSlot = slots.find((slot) => slot.block.type === "llm.narration");
    if (llmSlot === undefined) {
      throw new Error("expected the published llm.narration widget to build");
    }

    const descriptor = getRegistryDescriptor(llmSlot.block.type);
    const validate = ajv.compile(descriptor.schema);
    const props = toRegistryProps(llmSlot.block);

    expect(
      validate(props),
      `llm.narration props failed its registry schema: ${ajv.errorsText(
        validate.errors,
      )}`,
    ).toBe(true);
    expect(props).toEqual({
      available: true,
      model: "auto",
      reason: "ready",
    });
  });

  it("carries the belief state through as the engine reported it", () => {
    const props = toRegistryProps({
      type: "state.hero",
      data: { ...snapshot.state!, code: "BREAK", label: "Break" },
    });

    // v0.1 collapsed BREAK into "OTHER"/"Known" before the user ever saw it.
    expect(props.status).toBe("BREAK");
    expect(props.statusLabel).toBe("Break");
  });

  it("surfaces the unknown reason when the belief is UNKNOWN", () => {
    const props = toRegistryProps({
      type: "state.hero",
      data: {
        ...snapshot.state!,
        code: "UNKNOWN",
        label: "Unknown",
        unknownReason: "Conflicting test results in the last two minutes.",
      },
    });

    expect(props.unknownReason).toBe(
      "Conflicting test results in the last two minutes.",
    );
  });

  it("keeps NO_ACTION a first-class decision rather than an empty card", () => {
    const props = toRegistryProps({
      type: "decision.card",
      data: {
        ...snapshot.decision!,
        kind: "NO_ACTION",
        rationale: "",
        noActionReason: "Belief confidence is below the published threshold.",
      },
    });

    expect(props.decision).toBe("NO_ACTION");
    expect(props.rationale).toBe(
      "Belief confidence is below the published threshold.",
    );
  });
});
