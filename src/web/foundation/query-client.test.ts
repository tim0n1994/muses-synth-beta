// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { ApiClientError } from "./api-client.js";
import { createQueryClient, shouldRetryQuery } from "./query-client.js";

describe("query client policy", () => {
  it("does not retry validation failures", () => {
    const error = new ApiClientError(400, {
      code: "VALIDATION_FAILED",
      message: "Invalid",
    });
    expect(shouldRetryQuery(0, error)).toBe(false);
  });

  it("retries transient local-authority failures at most twice", () => {
    const error = new ApiClientError(503, {
      code: "UNAVAILABLE",
      message: "Unavailable",
    });
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });

  it("disables mutation retries by default", () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    client.clear();
  });
});
