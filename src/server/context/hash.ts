import { createHash } from "node:crypto";
import type { CloudEventInput, JsonValue } from "./model.js";

export const hashCloudEvent = (event: CloudEventInput): string => {
  const canonical = stableStringify({
    specversion: event.specversion,
    id: event.id,
    source: event.source,
    type: event.type,
    subject: event.subject ?? null,
    time: event.time ?? null,
    datacontenttype: event.datacontenttype ?? null,
    dataschema: event.dataschema ?? null,
    data: event.data ?? null,
    ttlSeconds: event.ttlSeconds ?? null,
    extensions: event.extensions,
  });
  return createHash("sha256").update(canonical).digest("hex");
};

export const stableStringify = (
  value: JsonValue | Readonly<Record<string, JsonValue>>,
): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const entries: readonly JsonValue[] = value;
    return `[${entries.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, JsonValue>>;
  const entries = Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify(record[key] ?? null)}`,
    );
  return `{${entries.join(",")}}`;
};
