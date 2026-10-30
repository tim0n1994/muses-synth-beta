import { describe, expect, it } from "vitest";

import {
  readLlmEnvironment,
  resolveLlmCapability,
  type LlmEnvironment,
  type LlmEnvironmentSource,
} from "../capability.js";

const VALID_BASE_URL = "http://gateway.internal.test:9000/v1";
const VALID_API_KEY = "key-value";

const environment = (
  overrides: Record<string, string | undefined> = {},
): LlmEnvironmentSource => ({
  LLM_BASE_URL: VALID_BASE_URL,
  LLM_API_KEY: VALID_API_KEY,
  ...overrides,
});

describe("readLlmEnvironment", () => {
  it("returns both required factors and the optional model", () => {
    expect(
      readLlmEnvironment(environment({ LLM_MODEL: "vendor/model-a" })),
    ).toEqual({
      baseUrl: VALID_BASE_URL,
      apiKey: VALID_API_KEY,
      model: "vendor/model-a",
    });
  });

  it("treats a missing or blank model as null and strips a trailing slash", () => {
    expect(readLlmEnvironment(environment())).toEqual({
      baseUrl: VALID_BASE_URL,
      apiKey: VALID_API_KEY,
      model: null,
    });
    expect(readLlmEnvironment(environment({ LLM_MODEL: "   " }))).toMatchObject(
      { model: null },
    );
    expect(
      readLlmEnvironment(
        environment({ LLM_BASE_URL: "http://gateway.internal.test:9000/v1/" }),
      ),
    ).toMatchObject({ baseUrl: "http://gateway.internal.test:9000/v1" });
    expect(
      readLlmEnvironment(
        environment({ LLM_BASE_URL: "http://gateway.internal.test:9000" }),
      ),
    ).toMatchObject({ baseUrl: "http://gateway.internal.test:9000" });
  });

  it("returns null when either required factor is missing", () => {
    expect(readLlmEnvironment({})).toBeNull();
    expect(
      readLlmEnvironment(environment({ LLM_API_KEY: undefined })),
    ).toBeNull();
    expect(
      readLlmEnvironment(environment({ LLM_BASE_URL: undefined })),
    ).toBeNull();
    expect(
      readLlmEnvironment({ LLM_API_KEY: VALID_API_KEY, LLM_MODEL: "m" }),
    ).toBeNull();
  });

  it("returns null for malformed URLs without ever throwing", () => {
    const malformed = [
      "not a url",
      "ftp://gateway.internal.test/v1",
      "http://user:pass@gateway.internal.test:9000/v1",
      "http://gateway.internal.test:9000/v1?token=x",
      "http://gateway.internal.test:9000/v1#section",
      "",
      "   ",
    ];
    for (const baseUrl of malformed) {
      expect(
        readLlmEnvironment(environment({ LLM_BASE_URL: baseUrl })),
      ).toBeNull();
    }
  });

  it("returns null for overlong values instead of throwing or echoing them", () => {
    expect(
      readLlmEnvironment(
        environment({ LLM_BASE_URL: `http://g.test/${"x".repeat(600)}` }),
      ),
    ).toBeNull();
    expect(
      readLlmEnvironment(environment({ LLM_API_KEY: "k".repeat(513) })),
    ).toBeNull();
    expect(
      readLlmEnvironment(environment({ LLM_MODEL: "m".repeat(129) })),
    ).toBeNull();
    // The blank-key / empty-base cases fall through to null as well.
    expect(readLlmEnvironment(environment({ LLM_API_KEY: "" }))).toBeNull();
  });
});

describe("resolveLlmCapability", () => {
  const env: LlmEnvironment = {
    baseUrl: VALID_BASE_URL,
    apiKey: VALID_API_KEY,
    model: null,
  };
  const now = Date.parse("2026-10-19T12:00:00.000Z");

  const settings = (llm: { enabled: boolean; model: string }) => ({ llm });

  it("reports unconfigured first, whatever settings say", () => {
    const capability = resolveLlmCapability({
      env: null,
      settings: settings({ enabled: true, model: "custom-model" }),
      cooldownUntil: null,
      now,
    });
    expect(capability).toEqual({
      available: false,
      enabled: true,
      configured: false,
      model: "custom-model",
      reason: "unconfigured",
    });
  });

  it("reports disabled before cooldown when configured but switched off", () => {
    const capability = resolveLlmCapability({
      env,
      settings: settings({ enabled: false, model: "auto" }),
      cooldownUntil: now + 60_000,
      now,
    });
    expect(capability).toEqual({
      available: false,
      enabled: false,
      configured: true,
      model: "auto",
      reason: "disabled",
    });
  });

  it("treats cooldown as transient: available stays true with reason cooldown", () => {
    const capability = resolveLlmCapability({
      env,
      settings: settings({ enabled: true, model: "auto" }),
      cooldownUntil: now + 120_000,
      now,
    });
    expect(capability.available).toBe(true);
    expect(capability.reason).toBe("cooldown");
    expect(capability.configured).toBe(true);
    expect(capability.enabled).toBe(true);
  });

  it("clears the cooldown reason once the deadline has passed", () => {
    const capability = resolveLlmCapability({
      env,
      settings: settings({ enabled: true, model: "auto" }),
      cooldownUntil: now,
      now,
    });
    expect(capability).toEqual({
      available: true,
      enabled: true,
      configured: true,
      model: "auto",
      reason: "ready",
    });
  });

  it("resolves the effective model with settings winning over env over auto", () => {
    const explicit = resolveLlmCapability({
      env,
      settings: settings({ enabled: true, model: "custom-model" }),
      cooldownUntil: null,
      now,
    });
    expect(explicit.model).toBe("custom-model");

    const fromEnv = resolveLlmCapability({
      env: { ...env, model: "env-model" },
      settings: settings({ enabled: true, model: "auto" }),
      cooldownUntil: null,
      now,
    });
    expect(fromEnv.model).toBe("env-model");

    const fallback = resolveLlmCapability({
      env,
      settings: settings({ enabled: true, model: "auto" }),
      cooldownUntil: null,
      now,
    });
    expect(fallback.model).toBe("auto");
  });
});
