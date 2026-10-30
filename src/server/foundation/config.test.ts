import { describe, expect, it } from "vitest";

import { ConfigurationError, loadRuntimeConfig } from "./config.js";

describe("loadRuntimeConfig", () => {
  it("creates loopback-only development defaults", () => {
    const config = loadRuntimeConfig({ NODE_ENV: "development" });

    expect(config).toMatchObject({
      bodyLimitBytes: 1_048_576,
      host: "127.0.0.1",
      mode: "development",
      port: 3001,
      serveStatic: false,
    });
    expect(config.allowedOrigins).toContain("http://127.0.0.1:5173");
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("parses explicit values and removes duplicate origins", () => {
    const config = loadRuntimeConfig({
      MUSES_ALLOWED_ORIGINS: "http://127.0.0.1:4173,http://127.0.0.1:4173",
      MUSES_BODY_LIMIT_BYTES: "2048",
      MUSES_PORT: "4173",
      MUSES_SERVE_STATIC: "true",
      NODE_ENV: "test",
    });

    expect(config.allowedOrigins).toEqual(["http://127.0.0.1:4173"]);
    expect(config.bodyLimitBytes).toBe(2048);
    expect(config.port).toBe(4173);
    expect(config.serveStatic).toBe(true);
  });

  it("rejects a non-loopback bind", () => {
    expect(() => loadRuntimeConfig({ MUSES_HOST: "0.0.0.0" })).toThrowError(
      ConfigurationError,
    );
  });

  it("rejects a non-loopback allowed origin", () => {
    expect(() =>
      loadRuntimeConfig({ MUSES_ALLOWED_ORIGINS: "https://example.com" }),
    ).toThrowError(/loopback-only/);
  });

  it("rejects an out-of-range body limit after schema validation", () => {
    expect(() =>
      loadRuntimeConfig({ MUSES_BODY_LIMIT_BYTES: "100" }),
    ).toThrowError(/Runtime configuration is invalid/);
  });

  it("parses a valid LLM environment into the derived config", () => {
    const config = loadRuntimeConfig({
      LLM_API_KEY: "key-value",
      LLM_BASE_URL: "http://gateway.internal.test:9000/v1/",
      LLM_MODEL: "vendor/model-a",
      NODE_ENV: "test",
    });

    expect(config.llm).toEqual({
      // Trailing slash stripped; the client appends /chat/completions.
      baseUrl: "http://gateway.internal.test:9000/v1",
      apiKey: "key-value",
      model: "vendor/model-a",
    });
  });

  it("treats the LLM layer as unconfigured when either factor is missing", () => {
    expect(loadRuntimeConfig({ NODE_ENV: "test" }).llm).toBeNull();
    expect(
      loadRuntimeConfig({
        LLM_BASE_URL: "http://gateway.internal.test:9000/v1",
        NODE_ENV: "test",
      }).llm,
    ).toBeNull();
    expect(
      loadRuntimeConfig({ LLM_API_KEY: "key-value", NODE_ENV: "test" }).llm,
    ).toBeNull();
  });

  it("nulls an invalid LLM environment without failing startup (B1)", () => {
    const invalid: ReadonlyArray<Record<string, string>> = [
      { LLM_API_KEY: "key-value", LLM_BASE_URL: "not a url" },
      {
        LLM_API_KEY: "key-value",
        LLM_BASE_URL: "ftp://gateway.internal.test:9000/v1",
      },
      {
        LLM_API_KEY: "key-value",
        LLM_BASE_URL: "http://user:pass@gateway.internal.test:9000/v1",
      },
      {
        LLM_API_KEY: "key-value",
        LLM_BASE_URL: `http://gateway.internal.test:9000/${"x".repeat(600)}`,
      },
      {
        LLM_API_KEY: "k".repeat(513),
        LLM_BASE_URL: "http://gateway.internal.test:9000/v1",
      },
      {
        LLM_API_KEY: "key-value",
        LLM_BASE_URL: "http://gateway.internal.test:9000/v1",
        LLM_MODEL: "m".repeat(129),
      },
    ];

    for (const environment of invalid) {
      // B1 acceptance: no ConfigurationError is thrown — there is no message
      // that could echo the offending values — and every other field stays
      // intact, so the process starts exactly as it would without LLM.
      const config = loadRuntimeConfig({ ...environment, NODE_ENV: "test" });
      expect(config.llm).toBeNull();
      expect(config.port).toBe(3001);
      expect(config.host).toBe("127.0.0.1");
    }
  });
});
