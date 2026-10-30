import { getBaseUrl, getOrigin } from "./test-config.js";
import type { ApiResponse, JsonValue } from "./types.js";

function parseJson(text: string): unknown {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function apiRequest(
  path: string,
  init: RequestInit = {},
  baseUrl: string = getBaseUrl(),
): Promise<ApiResponse> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  if (
    (method === "POST" ||
      method === "PUT" ||
      method === "PATCH" ||
      method === "DELETE") &&
    !headers.has("origin")
  ) {
    headers.set("origin", getOrigin());
  }
  const response = await fetch(
    `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
    {
      ...init,
      headers,
    },
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    json: parseJson(text),
  };
}

function jsonHeaders(input: HeadersInit): Headers {
  const headers = new Headers(input);
  if (!headers.has("content-type"))
    headers.set("content-type", "application/json");
  return headers;
}

export async function postJson(
  path: string,
  body: JsonValue,
  headers: HeadersInit = {},
): Promise<ApiResponse> {
  return await apiRequest(path, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify(body),
  });
}

export async function putJson(
  path: string,
  body: JsonValue,
  headers: HeadersInit = {},
): Promise<ApiResponse> {
  return await apiRequest(path, {
    method: "PUT",
    headers: jsonHeaders(headers),
    body: JSON.stringify(body),
  });
}

export function asRecord(
  value: unknown,
  label = "value",
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function successData(value: unknown): unknown {
  const envelope = asRecord(value, "API envelope");
  if (envelope.ok !== true || !("data" in envelope)) {
    throw new Error(
      `Expected success envelope, received ${JSON.stringify(value)}`,
    );
  }
  return envelope.data;
}

export function errorCode(value: unknown): string {
  const envelope = asRecord(value, "API envelope");
  // Server error envelopes come in two shapes:
  //   Foundation + module routes: { error: { code, message, requestId } }
  //   Settings plugin errors:     { code, message, details? }  (flat)
  const error =
    envelope.error !== undefined
      ? asRecord(envelope.error, "API error")
      : envelope;
  if (typeof error.code !== "string")
    throw new Error("API error code must be a string.");
  return error.code;
}
