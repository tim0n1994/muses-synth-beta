import type {
  ManualOverrideReason,
  EffectOutcome,
  EffectRequest,
} from "../../server/effects/contracts.js";
import type { AudioProfileId } from "../../server/policy/contracts.js";
import type { AudioFacade } from "./contracts.js";
import { AudioEffectExecutor } from "./executor.js";
import { getAudioProfile } from "./profiles.js";
import { WebAudioFacade } from "./web-audio-facade.js";

const DEFAULT_MANUAL_COOLDOWN_MS = 120_000;

export type ManualCommand = "play" | "pause" | "set-volume" | "undo-decision";

export interface AudioRuntimeOptions {
  readonly manualCooldownMs?: number;
  readonly facade?: AudioFacade;
}

export interface AudioRuntimeSnapshot {
  readonly started: boolean;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly currentProfile: AudioProfileId | null;
  readonly desiredGain: number;
  readonly manualCooldownUntil: string | null;
}

/**
 * The seam between the dashboard and the audio engine.
 *
 * Until v0.2.1 nothing in the application ever constructed the executor or a
 * facade: the transport buttons posted an effect *outcome* for a sound that
 * was never produced. This owns the one executor instance for the page, turns
 * transport clicks into real audio, and reports every action back to the
 * server as an `EffectOutcome` — using the reserved manual reasons so the
 * policy engine can honour its cooldown.
 */
export class AudioRuntime {
  private readonly executor: AudioEffectExecutor;

  public constructor(options: AudioRuntimeOptions = {}) {
    const facade = options.facade ?? new WebAudioFacade();
    this.executor = new AudioEffectExecutor(facade, {
      manualCooldownMs: options.manualCooldownMs ?? DEFAULT_MANUAL_COOLDOWN_MS,
    });
  }

  public snapshot(): AudioRuntimeSnapshot {
    return this.executor.snapshot();
  }

  public subscribe(listener: () => void): () => void {
    return this.executor.subscribe(listener);
  }

  public cancelPendingStart(): void {
    this.executor.cancelPendingStart();
  }

  /**
   * Runs a server-issued effect through the executor and returns the outcome
   * the caller should post back. This is the automatic path: belief -> policy
   * -> effect -> sound -> outcome.
   */
  public async applyIssuedEffect(
    request: EffectRequest,
  ): Promise<EffectOutcome> {
    return this.executor.execute(request);
  }

  /**
   * Runs a user-driven transport command. Browsers gate autoplay, so `play` is
   * the explicit start gesture PRD-v0.1 §5.2 requires; everything else assumes
   * the context already exists and degrades to a `skipped` outcome if not.
   */
  public async runManualCommand(
    command: ManualCommand,
    input: {
      effectId: string;
      profile?: AudioProfileId | undefined;
      volume?: number | undefined;
    },
  ): Promise<EffectOutcome> {
    const observedAt = new Date().toISOString();
    try {
      switch (command) {
        case "play": {
          const profile = input.profile ?? "flow";
          await this.executor.start(
            profile,
            input.volume ?? getAudioProfile(profile).defaultGain,
          );
          return outcome(
            input.effectId,
            "applied",
            "MANUAL_START",
            new Date().toISOString(),
          );
        }
        case "pause": {
          await this.executor.pause();
          return outcome(
            input.effectId,
            "skipped",
            "MANUAL_PAUSE",
            new Date().toISOString(),
          );
        }
        case "set-volume": {
          const volume = input.volume ?? 0;
          await this.executor.setGain(volume);
          return outcome(
            input.effectId,
            "applied",
            "MANUAL_VOLUME",
            observedAt,
            `targetGain ${volume}`,
          );
        }
        case "undo-decision": {
          // Reverting the active decision means silencing what it started.
          // The ledger keeps the request, so the audit trail survives.
          await this.executor.pause();
          return outcome(
            input.effectId,
            "reverted",
            "MANUAL_REVERT",
            observedAt,
          );
        }
        default: {
          const exhaustive: never = command;
          return exhaustive;
        }
      }
    } catch (error: unknown) {
      // Audio failure must never break the dashboard (PRD-v0.1 §5.2). The
      // executor already failed closed to silence; report it honestly.
      return outcome(
        input.effectId,
        "failed",
        reasonForCommand(command),
        observedAt,
        error instanceof Error ? error.message.slice(0, 1_000) : null,
      );
    }
  }

  public async dispose(): Promise<void> {
    await this.executor.dispose();
  }
}

function reasonForCommand(command: ManualCommand): ManualOverrideReason {
  switch (command) {
    case "play":
      return "MANUAL_START";
    case "pause":
      return "MANUAL_PAUSE";
    case "set-volume":
      return "MANUAL_VOLUME";
    case "undo-decision":
      return "MANUAL_REVERT";
  }
}

function outcome(
  effectId: string,
  status: EffectOutcome["status"],
  reason: ManualOverrideReason,
  observedAt: string,
  detail: string | null = null,
): EffectOutcome {
  return {
    outcomeId: `outcome_${observedAt}_${reason}`.slice(0, 128),
    effectId,
    status,
    reason,
    detail,
    observedAt,
  };
}
