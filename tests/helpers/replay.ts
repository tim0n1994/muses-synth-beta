import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { postJson } from "./api-client.js";
import type { JsonValue } from "./types.js";

export interface ReplayJsonLinesOptions {
  /**
   * When true, the CloudEvent `time` of each replayed line is rewritten to the
   * moment just before the request fires so the belief projector treats the
   * events as fresh. Use this when fixture history would otherwise be
   * discarded as stale.
   */
  readonly anchorToNow?: boolean;
  /**
   * Prefix added to each CloudEvent `id`. Ingestion is idempotent by
   * (source, id), so replaying the same fixture twice is a no-op unless the
   * ids differ. Use this when a test needs a second, distinct wave of the
   * same evidence.
   */
  readonly idPrefix?: string;
}

export async function replayJsonLines(
  relativePath: string,
  options: ReplayJsonLinesOptions = {},
): Promise<number> {
  const content = await readFile(resolve(process.cwd(), relativePath), "utf8");
  const anchorNow = options.anchorToNow === true;
  const baseMs = Date.now();
  const replayLines = content.split(/\r?\n/u).filter((rawLine) => {
    const line = rawLine.trim();
    return line.length > 0 && !line.startsWith("#");
  });
  let accepted = 0;
  for (const [index, line] of replayLines.entries()) {
    let event = JSON.parse(line) as JsonValue;
    if (anchorNow && typeof event === "object" && event !== null) {
      const envelope = event as Record<string, unknown>;
      // Space the fixture's `time` fields a second apart and place the last
      // one a beat before "now" so the projector sees fresh evidence.
      envelope.time = new Date(
        baseMs - replayLines.length * 1_000 + index * 1_000,
      ).toISOString();
      event = envelope as JsonValue;
    }
    if (
      options.idPrefix !== undefined &&
      typeof event === "object" &&
      event !== null
    ) {
      const envelope = event as Record<string, unknown>;
      envelope.id = `${options.idPrefix}-${String(envelope.id ?? index)}`;
      event = envelope as JsonValue;
    }
    const response = await postJson("/api/v1/context/events", event, {
      "x-muses-replay": "module-09",
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `MUSES_HOOK_MISSING: POST /api/v1/context/events rejected replay line ${index + 1}: ${response.status} ${response.text}`,
      );
    }
    accepted += 1;
  }
  return accepted;
}
