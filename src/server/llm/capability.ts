import type { LlmCapability } from "./contracts.js";

/**
 * The two environment facts the optional LLM layer needs. `model` is the
 * deployment-level default alias; `null` means "defer to settings/auto".
 * The base URL and API key intentionally have no settings-document mirror:
 * MODULE-03 forbids remote URLs and credentials there, and the canonical
 * settings bytes flow into release history and audit events.
 */
export interface LlmEnvironment {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string | null;
}

const BASE_URL_MAX_LENGTH = 512;
const API_KEY_MAX_LENGTH = 512;
const MODEL_MAX_LENGTH = 128;

/** Anything that can supply the three LLM variables — process.env or a
 * filtered copy. Structural on purpose so config.ts can pass its schema
 * projection without a cast. */
export interface LlmEnvironmentSource {
  readonly LLM_BASE_URL?: string | undefined;
  readonly LLM_API_KEY?: string | undefined;
  readonly LLM_MODEL?: string | undefined;
}

/**
 * Parses LLM_BASE_URL / LLM_API_KEY / LLM_MODEL.
 *
 * Returns `null` — never throws, never logs — when either required factor is
 * missing or anything is malformed. LLM is an optional enhancement: a broken
 * environment must not be able to keep the process from starting (B1), and
 * misconfiguration surfaces to users through capability.reason =
 * "unconfigured" instead of an error message. Violation messages are not a
 * concern because no message is ever produced; in particular the offending
 * values are never echoed anywhere.
 *
 * The URL path is deliberately *not* validated: a wrong path is a runtime
 * concern and surfaces as LLM_GATEWAY_ERROR on first use, not a boot failure.
 */
export function readLlmEnvironment(
  env: LlmEnvironmentSource,
): LlmEnvironment | null {
  const rawBaseUrl = env.LLM_BASE_URL?.trim() ?? "";
  const rawApiKey = env.LLM_API_KEY?.trim() ?? "";
  const rawModel = env.LLM_MODEL?.trim() ?? "";

  if (rawBaseUrl === "" || rawApiKey === "") {
    return null;
  }
  if (
    rawBaseUrl.length > BASE_URL_MAX_LENGTH ||
    rawApiKey.length > API_KEY_MAX_LENGTH ||
    (rawModel !== "" && rawModel.length > MODEL_MAX_LENGTH)
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.username !== "" || url.password !== "") {
    return null;
  }
  if (url.search !== "" || url.hash !== "") {
    return null;
  }

  return {
    baseUrl: url.href.endsWith("/") ? url.href.slice(0, -1) : url.href,
    apiKey: rawApiKey,
    model: rawModel === "" ? null : rawModel,
  };
}

export interface ResolveLlmCapabilityArgs {
  readonly env: LlmEnvironment | null;
  readonly settings: Readonly<{
    llm: Readonly<{ enabled: boolean; model: string }>;
  }>;
  readonly cooldownUntil: number | null;
  readonly now: number;
}

/**
 * Pure local capability derivation — no IO, no gateway probing (probing would
 * give bootstrap a network failure surface for zero benefit).
 *
 * Gate order is fixed and shared with the service gate (N2): configured
 * before enabled before cooldown. `available` deliberately excludes cooldown:
 * cooldown is a short transient (<= 5min) during which the panel stays
 * visible with a disabled button, while disabled/unconfigured are persistent
 * states that hide the panel entirely.
 */
export function resolveLlmCapability(
  args: ResolveLlmCapabilityArgs,
): LlmCapability {
  const configured = args.env !== null;
  const enabled = args.settings.llm.enabled;
  const model =
    args.settings.llm.model !== "auto"
      ? args.settings.llm.model
      : (args.env?.model ?? "auto");

  const inCooldown =
    args.cooldownUntil !== null && args.now < args.cooldownUntil;

  let reason: LlmCapability["reason"];
  if (!configured) {
    reason = "unconfigured";
  } else if (!enabled) {
    reason = "disabled";
  } else if (inCooldown) {
    reason = "cooldown";
  } else {
    reason = "ready";
  }

  return {
    available: enabled && configured,
    enabled,
    configured,
    model,
    reason,
  };
}
