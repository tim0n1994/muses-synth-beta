import { createHash } from "node:crypto";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

export function canonicalizeJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not permit non-finite numbers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => {
        const entry = value[key];
        if (entry === undefined) {
          throw new TypeError(
            `Canonical JSON does not permit undefined at key ${key}`,
          );
        }
        return `${JSON.stringify(key)}:${canonicalizeJson(entry)}`;
      })
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function checksumJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeJson(value), "utf8")
    .digest("hex");
}

function escapePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export function diffJsonPointers(
  left: unknown,
  right: unknown,
  path = "",
): readonly string[] {
  if (valuesEqual(left, right)) {
    return [];
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const changes: string[] = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}/${index}`;
      if (index >= left.length || index >= right.length) {
        changes.push(childPath);
      } else {
        changes.push(...diffJsonPointers(left[index], right[index], childPath));
      }
    }
    return changes;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const changes: string[] = [];
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort();
    for (const key of keys) {
      const childPath = `${path}/${escapePointerToken(key)}`;
      if (!(key in left) || !(key in right)) {
        changes.push(childPath);
      } else {
        changes.push(...diffJsonPointers(left[key], right[key], childPath));
      }
    }
    return changes;
  }

  return [path || "/"];
}
