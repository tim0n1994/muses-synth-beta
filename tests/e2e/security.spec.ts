import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  apiRequest,
  asRecord,
  errorCode,
  putJson,
} from "../helpers/api-client.js";
import { getLogPath } from "../helpers/test-config.js";
import type { JsonValue } from "../helpers/types.js";

async function fixture(path: string): Promise<JsonValue> {
  return JSON.parse(await readFile(path, "utf8")) as JsonValue;
}

const MUSES_EVENTS_PATH = "/api/v1/context/events";

test("mutated Origin is rejected without reflective CORS", async () => {
  const response = await apiRequest(MUSES_EVENTS_PATH, {
    method: "POST",
    headers: {
      origin: "https://evil.invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      specversion: "1.0",
      id: "evt_origin_0001",
      source: "urn:muses:e2e-security",
      type: "muses.editor.activity",
      subject: "workspace:e2e",
      time: "2026-01-01T00:00:00.000Z",
      data: { action: "edit" },
    }),
  });
  expect(response.status).toBe(403);
  expect(response.headers.get("access-control-allow-origin")).not.toBe(
    "https://evil.invalid",
  );
  expect(errorCode(response.json)).toBe("ORIGIN_NOT_ALLOWED");
});

test("body limit fails closed at more than 1 MiB", async () => {
  const response = await apiRequest(MUSES_EVENTS_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(1_048_577) }),
  });
  expect(response.status).toBe(413);
  expect(errorCode(response.json)).toBe("BODY_TOO_LARGE");
});

test("executable configuration is rejected", async () => {
  // Read the current draft anchor to satisfy optimistic-concurrency.
  const before = await apiRequest("/api/settings/draft", {
    method: "GET",
    headers: { accept: "application/json" },
  });
  expect(before.status).toBe(200);
  const draft = asRecord(before.json, "settings draft anchor");
  const revision = draft.revision;
  if (typeof revision !== "number") throw new Error("draft.revision numeric");
  const response = await putJson("/api/settings/draft", {
    actor: "e2e-security",
    reason: "Executable-script props must be rejected by settings validation.",
    expectedRevision: revision,
    document: await fixture("tests/fixtures/settings/executable-config.json"),
  });
  // Server must fail closed: the body fails SettingsDocument schema (400 via
  // Fastify schema validation) before any domain rules fire; either failure
  // shape is acceptable so long as no executable configuration is persisted.
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  const code = errorCode(response.json);
  expect(["INVALID_REQUEST", "SETTINGS_VALIDATION_FAILED"]).toContain(code);
});

test("unknown component type is rejected", async () => {
  const before = await apiRequest("/api/settings/draft", {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const draft = asRecord(before.json, "settings draft anchor");
  const revision = draft.revision;
  if (typeof revision !== "number") throw new Error("draft.revision numeric");
  const response = await putJson("/api/settings/draft", {
    actor: "e2e-security",
    reason: "Unknown widget types must not be stored.",
    expectedRevision: revision,
    document: await fixture("tests/fixtures/settings/unknown-component.json"),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  const code = errorCode(response.json);
  expect(["INVALID_REQUEST", "SETTINGS_VALIDATION_FAILED"]).toContain(code);
});

test("malformed requests do not leak stack traces or filesystem paths", async () => {
  const response = await apiRequest(MUSES_EVENTS_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"invalid":',
  });
  expect(response.status).toBe(400);
  expect(response.text).not.toMatch(
    /node_modules|(?:file:\/\/|\/Users\/|\/home\/|[A-Z]:\\)|\bat\s+\w+\s*\(/iu,
  );
});

test("authorization and secret-shaped values are redacted from server logs", async () => {
  const secrets = {
    bearer: "sk-test-module09-DO-NOT-LOG",
    apiKey: "api_key_module09_DO_NOT_LOG",
    password: "password_module09_DO_NOT_LOG",
  };
  await apiRequest(MUSES_EVENTS_PATH, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secrets.bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      apiKey: secrets.apiKey,
      password: secrets.password,
    }),
  });
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 200));
  const logs = await readFile(getLogPath(), "utf8");
  expect(logs).not.toContain(secrets.bearer);
  expect(logs).not.toContain(secrets.apiKey);
  expect(logs).not.toContain(secrets.password);
});
