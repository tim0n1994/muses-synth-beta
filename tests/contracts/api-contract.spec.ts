import { describe, expect, test } from "vitest";
import {
  apiRequest,
  asRecord,
  postJson,
  successData,
} from "../helpers/api-client.js";
import { assertSchema, schemaNames } from "./schema-registry.js";

function contentType(response: { readonly headers: Headers }): string {
  return response.headers.get("content-type") ?? "";
}

describe("JSON Schema registry", () => {
  test("all contract schemas compile under strict Ajv", () => {
    expect(schemaNames).toHaveLength(10);
  });
});

describe("live API envelope contracts", () => {
  test("GET /v0/health returns strict success envelope and SQLite WAL status", async () => {
    const response = await apiRequest("/health");
    expect(response.status).toBe(200);
    expect(contentType(response)).toMatch(/^application\/json\b/u);
    assertSchema("api-success", response.json);
    assertSchema("health-data", successData(response.json));
  });

  test("POST /v0/events accepts deterministic public-ingest event", async () => {
    const request = {
      eventId: "evt_contract_0001",
      occurredAt: "2026-01-01T00:00:00.000Z",
      kind: "context.observation",
      source: { type: "test_replay", name: "module-09-contract" },
      payload: { factor: "task_engagement", value: 0.5, confidence: 0.8 },
    };
    assertSchema("event-ingest-request", request);
    const response = await postJson("/events", request);
    expect(response.status).toBe(202);
    assertSchema("api-success", response.json);
    assertSchema("event-ingest-data", successData(response.json));
  });

  test("malformed JSON returns strict error envelope without a success data field", async () => {
    const response = await apiRequest("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"broken":',
    });
    expect(response.status).toBe(400);
    assertSchema("api-error", response.json);
    expect(asRecord(response.json)).not.toHaveProperty("data");
  });
});
