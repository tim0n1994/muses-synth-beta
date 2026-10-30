import { invalidEvent } from "./errors.js";
import type { CloudEventInput, JsonValue } from "./model.js";

const STANDARD_ATTRIBUTES = new Set([
  "specversion",
  "id",
  "source",
  "type",
  "subject",
  "time",
  "datacontenttype",
  "dataschema",
  "data",
]);

const EXTENSION_NAME_PATTERN = /^[a-z0-9]{1,20}$/u;

export const parseCloudEventInput = (value: unknown): CloudEventInput => {
  if (!isRecord(value)) {
    throw invalidEvent("CloudEvent body must be a JSON object.");
  }

  const specversion = readRequiredString(value, "specversion", 8);
  if (specversion !== "1.0") {
    throw invalidEvent("Only CloudEvents specversion 1.0 is supported.");
  }

  const id = readRequiredString(value, "id", 256);
  const source = readRequiredString(value, "source", 512);
  const type = readRequiredString(value, "type", 256);
  const subject = readOptionalString(value, "subject", 512);
  const time = readOptionalString(value, "time", 64);
  const datacontenttype = readOptionalString(value, "datacontenttype", 128);
  const dataschema = readOptionalString(value, "dataschema", 512);

  if (/\s/u.test(source) || /[\u0000-\u001f]/u.test(source)) {
    throw invalidEvent(
      "CloudEvents source must be a non-whitespace URI-reference string.",
    );
  }
  if (time !== undefined && !isRfc3339Timestamp(time)) {
    throw invalidEvent("CloudEvents time must be a valid RFC3339 timestamp.");
  }
  if (
    datacontenttype !== undefined &&
    !datacontenttype.toLowerCase().startsWith("application/json")
  ) {
    throw invalidEvent("Only JSON CloudEvent data is accepted.");
  }

  const data =
    value.data === undefined ? undefined : toJsonValue(value.data, "data", 0);
  const extensions: Record<string, JsonValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (STANDARD_ATTRIBUTES.has(key)) {
      continue;
    }
    if (!EXTENSION_NAME_PATTERN.test(key)) {
      throw invalidEvent(
        `CloudEvents extension attribute '${key}' is invalid.`,
      );
    }
    extensions[key] = toCloudEventExtensionValue(raw, key);
  }

  const ttlSeconds = parseTtlSeconds(extensions.ttlseconds);
  validateKnownEventData(type, data);

  return {
    specversion: "1.0",
    id,
    source,
    type,
    ...(subject === undefined ? {} : { subject }),
    ...(time === undefined ? {} : { time }),
    ...(datacontenttype === undefined ? {} : { datacontenttype }),
    ...(dataschema === undefined ? {} : { dataschema }),
    ...(data === undefined ? {} : { data }),
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    extensions,
  };
};

const toCloudEventExtensionValue = (value: unknown, key: string): JsonValue => {
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  throw invalidEvent(
    `CloudEvents extension attribute '${key}' must be a string, boolean, or safe integer.`,
  );
};

const validateKnownEventData = (
  type: string,
  data: JsonValue | undefined,
): void => {
  const record = asJsonRecord(data);
  switch (type) {
    case "muses.editor.activity": {
      const action = readJsonString(record, "action");
      if (
        action !== "edit" &&
        action !== "save" &&
        action !== "navigate" &&
        action !== "open"
      ) {
        throw invalidEvent(
          "muses.editor.activity data.action must be edit, save, navigate, or open.",
        );
      }
      return;
    }
    case "muses.test.run.completed": {
      const status = readJsonString(record, "status");
      if (
        status !== "passed" &&
        status !== "failed" &&
        status !== "cancelled"
      ) {
        throw invalidEvent(
          "muses.test.run.completed data.status must be passed, failed, or cancelled.",
        );
      }
      const total = readOptionalNonNegativeInteger(record, "total");
      const failed = readOptionalNonNegativeInteger(record, "failed");
      if (total !== undefined && failed !== undefined && failed > total) {
        throw invalidEvent(
          "muses.test.run.completed data.failed cannot exceed data.total.",
        );
      }
      return;
    }
    case "muses.review.activity": {
      const action = readJsonString(record, "action");
      if (
        action !== "diff-opened" &&
        action !== "commented" &&
        action !== "commit-inspected" &&
        action !== "approval-requested" &&
        action !== "review-completed"
      ) {
        throw invalidEvent(
          "muses.review.activity data.action is not recognized.",
        );
      }
      return;
    }
    case "muses.session.activity": {
      const status = readJsonString(record, "status");
      if (status !== "active" && status !== "idle" && status !== "inactive") {
        throw invalidEvent(
          "muses.session.activity data.status must be active, idle, or inactive.",
        );
      }
      return;
    }
    case "muses.process.activity": {
      const status = readJsonString(record, "status");
      if (
        status !== "started" &&
        status !== "waiting" &&
        status !== "completed" &&
        status !== "failed"
      ) {
        throw invalidEvent(
          "muses.process.activity data.status is not recognized.",
        );
      }
      return;
    }
    case "muses.environment.setup": {
      const action = readJsonString(record, "action");
      if (action === undefined || action.length > 128) {
        throw invalidEvent(
          "muses.environment.setup data.action must be a non-empty string up to 128 characters.",
        );
      }
      return;
    }
    default:
      return;
  }
};

const asJsonRecord = (
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : undefined;

const readJsonString = (
  record: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readOptionalNonNegativeInteger = (
  record: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
): number | undefined => {
  const value = record?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidEvent(
      `Known event data.${key} must be a non-negative integer when present.`,
    );
  }
  return value;
};

const parseTtlSeconds = (value: JsonValue | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidEvent(
      "CloudEvents ttlseconds extension must be a positive integer.",
    );
  }
  return value;
};

const readRequiredString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  maxLength: number,
): string => {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw invalidEvent(
      `CloudEvents ${key} must be a non-empty string up to ${maxLength} characters.`,
    );
  }
  return value;
};

const readOptionalString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  maxLength: number,
): string | undefined => {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw invalidEvent(
      `CloudEvents ${key} must be a non-empty string up to ${maxLength} characters.`,
    );
  }
  return value;
};

const toJsonValue = (
  value: unknown,
  path: string,
  depth: number,
): JsonValue => {
  if (depth > 32) {
    throw invalidEvent(
      `JSON value at ${path} exceeds the maximum nesting depth.`,
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidEvent(`JSON number at ${path} must be finite.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      toJsonValue(entry, `${path}[${index}]`, depth + 1),
    );
  }
  if (isRecord(value)) {
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = toJsonValue(entry, `${path}.${key}`, depth + 1);
    }
    return output;
  }
  throw invalidEvent(`Value at ${path} is not JSON-compatible.`);
};

const isRfc3339Timestamp = (value: string): boolean => {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
