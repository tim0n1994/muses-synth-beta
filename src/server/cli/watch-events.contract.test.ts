import { describe, expect, it } from "vitest";

import { parseCloudEventInput } from "../context/parse.js";
import { buildEnvelope, WATCH_EVENT_SOURCE } from "./emitter.js";
import type { WatcherEmission } from "./watcher-state.js";

const OCCURRED_AT = new Date("2026-08-21T10:00:00.000Z");

/**
 * Every shape the watcher can emit, validated by the server's own ingestion
 * parser. Muses' recurring failure mode has been components that look right
 * and are never actually accepted by the other side; a producer is worth
 * nothing if ingestion rejects it, and finding that out at runtime means a
 * silent CLI and an empty dashboard.
 */
const EMISSIONS: readonly WatcherEmission[] = [
  { kind: "editor", action: "save" },
  { kind: "editor", action: "save", path: "src/server/policy/engine.ts" },
  { kind: "session", status: "active" },
  { kind: "session", status: "idle" },
  { kind: "session", status: "inactive" },
];

describe("muses watch event contract", () => {
  it.each(EMISSIONS)("ingestion accepts %j", (emission) => {
    const envelope = buildEnvelope(emission, 1, "workspace:muses", OCCURRED_AT);

    expect(() => parseCloudEventInput(envelope)).not.toThrow();
  });

  it("gives every event a unique id within a run", () => {
    // Ingestion is idempotent by (source, id): colliding ids would silently
    // drop evidence instead of recording it.
    const ids = new Set(
      EMISSIONS.map(
        (emission, index) =>
          buildEnvelope(emission, index + 1, "workspace:muses", OCCURRED_AT).id,
      ),
    );

    expect(ids.size).toBe(EMISSIONS.length);
  });

  it("stamps the watcher source so its events are attributable", () => {
    const envelope = buildEnvelope(
      { kind: "session", status: "active" },
      1,
      "workspace:muses",
      OCCURRED_AT,
    );

    expect(envelope.source).toBe(WATCH_EVENT_SOURCE);
    expect(envelope.time).toBe("2026-08-21T10:00:00.000Z");
  });

  it("emits the editor action the projector's editing rule counts", () => {
    // `sustainedEditing` only counts `edit` and `save`; any other action would
    // never move the belief to BUILD.
    const envelope = buildEnvelope(
      { kind: "editor", action: "save" },
      1,
      "workspace:muses",
      OCCURRED_AT,
    );

    expect(envelope.type).toBe("muses.editor.activity");
    expect(envelope.data.action).toBe("save");
  });

  it("carries no path unless one was opted in", () => {
    const envelope = buildEnvelope(
      { kind: "editor", action: "save" },
      1,
      "workspace:muses",
      OCCURRED_AT,
    );

    expect(envelope.data).toEqual({ action: "save" });
  });
});
