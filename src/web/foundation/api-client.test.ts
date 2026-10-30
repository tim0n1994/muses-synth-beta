// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { ApiClientError, createApiClient } from "./api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("createApiClient", () => {
  it("returns typed JSON responses", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: "ok" }),
    );
    const client = createApiClient({ fetchImplementation });

    await expect(
      client.get<{ status: string }>("/api/health"),
    ).resolves.toEqual({ status: "ok" });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("sends JSON for mutation methods", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({ saved: true }),
    );
    const client = createApiClient({ fetchImplementation });

    await client.request("/api/settings/draft", {
      body: { enabled: true },
      method: "PUT",
    });

    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(request?.body).toBe(JSON.stringify({ enabled: true }));
  });

  it("converts structured server errors into ApiClientError", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION_FAILED",
            issues: [{ message: "Required", path: "/name" }],
            message: "Configuration is invalid",
            requestId: "req_123",
          },
        },
        400,
      ),
    );
    const client = createApiClient({ fetchImplementation });

    const result = client.get("/api/failure");
    await expect(result).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      requestId: "req_123",
      status: 400,
    });
    await expect(result).rejects.toBeInstanceOf(ApiClientError);
  });

  it("rejects relative paths without a leading slash", async () => {
    const fetchImplementation: typeof fetch = async () => jsonResponse({});
    const client = createApiClient({ fetchImplementation });
    await expect(client.get("api/health")).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });
});
