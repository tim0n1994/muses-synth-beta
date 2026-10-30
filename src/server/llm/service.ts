import type { BeliefSnapshot } from "../belief/model.js";
import type { LanguageCode, SettingsDocument } from "../settings/schema.js";
import {
  llmCooldown,
  llmDisabled,
  llmInvalidResponse,
  llmNotConfigured,
  sanitizeLlmText,
  type LlmCapability,
  type LlmEventCounts,
  type LlmTextResponse,
} from "./contracts.js";
import { resolveLlmCapability, type LlmEnvironment } from "./capability.js";
import type { LlmGatewayClient } from "./gateway-client.js";
import { buildNarrationPrompt, buildSummaryPrompt } from "./prompt.js";

/**
 * The LLM service facade: capability derivation plus the two explicitly
 * triggered generations. It is the gatekeeper for the fixed order
 * configured -> enabled -> cooldown (N2), checked *before* any prompt is
 * assembled — a rejected request costs no local projection and, more
 * importantly, no gateway quota. Model output leaves here only as sanitized
 * display text; it never flows toward belief, policy or effects.
 */

const NARRATION_MAX_TOKENS = 300;
const SUMMARY_MAX_TOKENS = 600;

const DEFAULT_WINDOW_MINUTES = 60;
const MINIMUM_WINDOW_MINUTES = 15;
const MAXIMUM_WINDOW_MINUTES = 240;

export interface LlmServiceOptions {
  readonly env: LlmEnvironment | null;
  /** Null exactly when env is null — the whole layer is unconfigured then. */
  readonly client: LlmGatewayClient | null;
  /** Reads the published settings document; publish takes effect instantly. */
  readonly getSettings: () => SettingsDocument;
  /**
   * Belief projection for the requesting user's stream (v0.6); null is the
   * legacy global stream. Ignoring the argument reproduces the pre-v0.6
   * single-stream behavior, which is what unscoped tests do.
   */
  readonly getBelief: (userId?: string | null) => Promise<BeliefSnapshot>;
  /**
   * Event-window counts for the requesting user's stream (v0.6); null is the
   * legacy global stream.
   */
  readonly getEventCounts: (
    sinceIso: string,
    untilIso: string,
    userId?: string | null,
  ) => Promise<LlmEventCounts>;
  readonly now?: () => number;
}

/**
 * Per-request generation context (v0.6): which user's shard to narrate and
 * which language to answer in. `language` overrides the published settings
 * document's appearance.language — the routes resolve the per-user
 * preference and fall back to the global setting before calling in.
 */
export interface LlmRequestContext {
  readonly userId?: string | null;
  readonly language?: LanguageCode;
}

export class LlmService {
  private readonly env: LlmEnvironment | null;
  private readonly client: LlmGatewayClient | null;
  private readonly getSettings: () => SettingsDocument;
  private readonly getBelief: LlmServiceOptions["getBelief"];
  private readonly getEventCounts: LlmServiceOptions["getEventCounts"];
  private readonly now: () => number;

  public constructor(options: LlmServiceOptions) {
    this.env = options.env;
    this.client = options.client;
    this.getSettings = options.getSettings;
    this.getBelief = options.getBelief;
    this.getEventCounts = options.getEventCounts;
    this.now = options.now ?? Date.now;
  }

  /** Pure local, synchronous; never probes the gateway. */
  public capability(): LlmCapability {
    return resolveLlmCapability({
      env: this.env,
      settings: this.getSettings(),
      cooldownUntil: this.client?.cooldownUntil() ?? null,
      now: this.now(),
    });
  }

  public async narrate(
    context: LlmRequestContext = {},
  ): Promise<LlmTextResponse> {
    const capability = this.gate();
    const prompt = buildNarrationPrompt(
      await this.getBelief(context.userId ?? null),
      context.language ?? this.getSettings().appearance.language,
    );
    return this.generate(capability.model, prompt, NARRATION_MAX_TOKENS);
  }

  public async summarize(
    request: Readonly<{ windowMinutes?: number }> & LlmRequestContext = {},
  ): Promise<LlmTextResponse> {
    const capability = this.gate();
    const windowMinutes = clampWindowMinutes(request.windowMinutes);
    const nowMs = this.now();
    const until = new Date(nowMs).toISOString();
    const since = new Date(nowMs - windowMinutes * 60_000).toISOString();
    const [snapshot, counts] = await Promise.all([
      this.getBelief(request.userId ?? null),
      this.getEventCounts(since, until, request.userId ?? null),
    ]);
    const prompt = buildSummaryPrompt(
      snapshot,
      {
        windowMinutes,
        total: counts.total,
        groups: counts.groups,
      },
      request.language ?? this.getSettings().appearance.language,
    );
    return this.generate(capability.model, prompt, SUMMARY_MAX_TOKENS);
  }

  /**
   * Runs the capability gate in the canonical order. `client === null` is
   * folded into "not configured": the two are wired together and the extra
   * check keeps a miswired runtime from dereferencing a missing client.
   */
  private gate(): LlmCapability {
    const capability = this.capability();
    if (!capability.configured || this.client === null) {
      throw llmNotConfigured();
    }
    if (!capability.enabled) {
      throw llmDisabled();
    }
    if (capability.reason === "cooldown") {
      const cooldownUntil = this.client.cooldownUntil();
      const retryAfterSeconds =
        cooldownUntil === null
          ? 1
          : Math.max(1, Math.ceil((cooldownUntil - this.now()) / 1_000));
      throw llmCooldown(retryAfterSeconds);
    }
    return capability;
  }

  private async generate(
    model: string,
    prompt: Readonly<{ system: string; user: string }>,
    maxTokens: number,
  ): Promise<LlmTextResponse> {
    const client = this.client;
    if (client === null) {
      throw llmNotConfigured();
    }
    const completion = await client.complete({
      model,
      system: prompt.system,
      user: prompt.user,
      maxTokens,
    });
    const text = sanitizeLlmText(completion.text);
    if (text === "") {
      throw llmInvalidResponse();
    }
    return {
      text,
      model: completion.model,
      generatedAt: new Date(this.now()).toISOString(),
    };
  }
}

const clampWindowMinutes = (value: number | undefined): number => {
  const resolved = value ?? DEFAULT_WINDOW_MINUTES;
  if (!Number.isFinite(resolved)) {
    return DEFAULT_WINDOW_MINUTES;
  }
  return Math.min(
    MAXIMUM_WINDOW_MINUTES,
    Math.max(MINIMUM_WINDOW_MINUTES, Math.round(resolved)),
  );
};
