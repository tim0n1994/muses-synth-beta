import type {
  EffectOutcome,
  EffectRequest,
} from "../../server/effects/contracts.js";
import type { AudioProfileId } from "../../server/policy/contracts.js";
import {
  BrowserAudioClock,
  type AudioClock,
  type AudioFacade,
  type ManualAudioAction,
  type ManualOverrideListener,
} from "./contracts.js";
import { getAudioProfile } from "./profiles.js";
import { MAX_GAIN } from "./volume.js";

const MIN_RAMP_MS = 250;
const MAX_RAMP_MS = 5000;
const SAFE_FAILURE_RAMP_MS = 300;

export interface AudioExecutorOptions {
  readonly manualCooldownMs: number;
  readonly onManualOverride?: ManualOverrideListener;
}

export class AudioEffectExecutor {
  private started = false;
  private paused = false;
  private muted = false;
  private desiredGain = 0;
  private currentProfile: AudioProfileId | null = null;
  private manualCooldownUntilMs = 0;
  private operation: Promise<void> = Promise.resolve();
  private startRevision = 0;
  private starting = false;
  private manualRevision = 0;
  private disposed = false;
  private disposal: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private cachedSnapshot: ReturnType<AudioEffectExecutor["snapshot"]> | null =
    null;

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publishSnapshot(): void {
    for (const listener of this.listeners) listener();
  }

  public constructor(
    private readonly facade: AudioFacade,
    private readonly options: AudioExecutorOptions,
    private readonly clock: AudioClock = new BrowserAudioClock(),
  ) {
    if (
      !Number.isInteger(options.manualCooldownMs) ||
      options.manualCooldownMs < 0
    ) {
      throw new RangeError("manualCooldownMs must be a non-negative integer.");
    }
  }

  public async start(
    profileId: AudioProfileId = "flow",
    targetGain = getAudioProfile(profileId).defaultGain,
  ): Promise<void> {
    if (this.disposed) throw new Error("Audio executor is disposed.");
    assertGain(targetGain);
    const revision = ++this.startRevision;
    this.starting = true;
    const activation = this.facade.start();
    void activation.catch(() => undefined);
    await this.enqueue(async () => {
      const profile = getAudioProfile(profileId);
      try {
        await activation;
        this.assertCurrentStart(revision);
        await this.facade.applyProfile(profile, profile.crossfadeMs);
        this.assertCurrentStart(revision);
        await this.facade.rampMasterGain(targetGain, profile.crossfadeMs);
        this.assertCurrentStart(revision);
        this.started = true;
        this.paused = false;
        this.muted = false;
        this.desiredGain = targetGain;
        this.currentProfile = profileId;
        this.recordManualOverride("start");
      } catch (error: unknown) {
        await this.failClosedToSilence();
        throw error;
      } finally {
        if (revision === this.startRevision) {
          this.starting = false;
        }
      }
    });
  }

  public cancelPendingStart(): void {
    if (this.disposed) return;
    if (!this.starting && (!this.started || this.paused)) {
      return;
    }
    this.startRevision += 1;
    this.starting = false;
    this.paused = true;
    void this.facade.pause(0).catch(() => undefined);
    this.publishSnapshot();
  }

  private assertCurrentStart(revision: number): void {
    if (this.disposed || revision !== this.startRevision) {
      throw new Error("Audio start was cancelled.");
    }
  }

  public async pause(rampMs = 500): Promise<void> {
    this.manualRevision += 1;
    this.cancelPendingStart();
    await this.enqueue(async () => {
      assertRamp(rampMs);
      if (!this.started || this.paused) {
        this.recordManualOverride("pause");
        return;
      }
      await this.facade.pause(rampMs);
      this.paused = true;
      this.recordManualOverride("pause");
    });
  }

  public async mute(rampMs = 350): Promise<void> {
    this.manualRevision += 1;
    await this.enqueue(async () => {
      assertRamp(rampMs);
      if (this.started && !this.paused) {
        await this.facade.rampMasterGain(0, rampMs);
      }
      this.muted = true;
      this.recordManualOverride("mute");
    });
  }

  public async unmute(rampMs = 350): Promise<void> {
    this.manualRevision += 1;
    await this.enqueue(async () => {
      assertRamp(rampMs);
      try {
        if (this.started && !this.paused) {
          await this.facade.rampMasterGain(this.desiredGain, rampMs);
        }
        this.muted = false;
        this.recordManualOverride("unmute");
      } catch (error: unknown) {
        await this.failClosedToSilence();
        throw error;
      }
    });
  }

  /**
   * Manual volume change. Distinct from `execute()` because it is a human
   * action: it re-arms the manual cooldown so automation stands down, and it
   * survives being called while muted (the gain is remembered and applied on
   * unmute).
   */
  public async setGain(targetGain: number, rampMs = 350): Promise<void> {
    this.manualRevision += 1;
    await this.enqueue(async () => {
      assertGain(targetGain);
      assertRamp(rampMs);
      try {
        this.desiredGain = targetGain;
        if (this.started && !this.paused && !this.muted) {
          await this.facade.rampMasterGain(targetGain, rampMs);
        }
        this.recordManualOverride("volume");
      } catch (error: unknown) {
        await this.failClosedToSilence();
        throw error;
      }
    });
  }

  public async execute(request: EffectRequest): Promise<EffectOutcome> {
    let outcome: EffectOutcome | null = null;
    await this.enqueue(async () => {
      outcome = await this.executeSerialized(request);
    });
    if (outcome === null) {
      throw new Error("Audio effect execution completed without an outcome.");
    }
    return outcome;
  }

  public dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal;
    this.disposed = true;
    this.startRevision += 1;
    this.manualRevision += 1;
    this.starting = false;
    this.paused = true;
    this.publishSnapshot();
    // Release now: waiting behind a profile fade lets an unmounted page keep
    // sounding, and a queued start must never resurrect the released facade.
    const release = this.facade.dispose();
    void release.catch(() => undefined);
    this.disposal = this.enqueue(async () => {
      await release;
      this.started = false;
      this.paused = false;
      this.muted = false;
      this.desiredGain = 0;
      this.currentProfile = null;
    });
    return this.disposal;
  }

  public snapshot(): Readonly<{
    started: boolean;
    paused: boolean;
    muted: boolean;
    currentProfile: AudioProfileId | null;
    desiredGain: number;
    manualCooldownUntil: string | null;
  }> {
    const next = Object.freeze({
      started: this.started,
      paused: this.paused,
      muted: this.muted,
      currentProfile: this.currentProfile,
      desiredGain: this.desiredGain,
      manualCooldownUntil:
        this.manualCooldownUntilMs === 0
          ? null
          : new Date(this.manualCooldownUntilMs).toISOString(),
    });
    const previous = this.cachedSnapshot;
    if (
      previous !== null &&
      Object.entries(next).every(
        ([key, value]) => previous[key as keyof typeof next] === value,
      )
    )
      return previous;
    this.cachedSnapshot = next;
    return next;
  }

  private async executeSerialized(
    request: EffectRequest,
  ): Promise<EffectOutcome> {
    if (this.disposed) {
      return this.outcome(request, "skipped", "AUDIO_DISPOSED", null);
    }
    if (
      request.actionId !== "audio.adjust" ||
      request.adjustment.actionId !== "audio.adjust"
    ) {
      return this.outcome(request, "failed", "ACTION_NOT_ALLOWED", null);
    }
    if (!this.started) {
      return this.outcome(request, "skipped", "EXPLICIT_START_REQUIRED", null);
    }
    if (this.paused) {
      return this.outcome(request, "skipped", "MANUALLY_PAUSED", null);
    }
    if (this.clock.now().getTime() < this.manualCooldownUntilMs) {
      return this.outcome(request, "skipped", "MANUAL_COOLDOWN", null);
    }

    const adjustment = request.adjustment;
    if (!isValidProfile(adjustment.profile)) {
      return this.outcome(request, "failed", "INVALID_PROFILE", null);
    }
    if (!isValidGain(adjustment.targetGain)) {
      return this.outcome(request, "failed", "INVALID_GAIN", null);
    }
    if (!isValidRamp(adjustment.rampMs)) {
      return this.outcome(request, "failed", "INVALID_RAMP", null);
    }

    try {
      const revision = this.manualRevision;
      const profile = getAudioProfile(adjustment.profile);
      if (this.currentProfile !== adjustment.profile) {
        await this.facade.applyProfile(
          profile,
          Math.max(profile.crossfadeMs, adjustment.rampMs),
        );
      }
      if (revision !== this.manualRevision || this.paused) {
        return this.outcome(request, "skipped", "MANUAL_COOLDOWN", null);
      }
      this.desiredGain = adjustment.targetGain;
      this.currentProfile = adjustment.profile;
      if (!this.muted) {
        await this.facade.rampMasterGain(
          adjustment.targetGain,
          adjustment.rampMs,
        );
      }
      if (revision !== this.manualRevision || this.paused) {
        return this.outcome(request, "skipped", "MANUAL_COOLDOWN", null);
      }
      return this.outcome(request, "applied", "PROFILE_APPLIED", null);
    } catch (error: unknown) {
      await this.failClosedToSilence();
      return this.outcome(
        request,
        "failed",
        "AUDIO_FACADE_FAILURE",
        error instanceof Error
          ? error.message
          : "Unknown audio facade failure.",
      );
    }
  }

  private async failClosedToSilence(): Promise<void> {
    try {
      await this.facade.rampMasterGain(0, SAFE_FAILURE_RAMP_MS);
    } catch {
      // The audio facade is already failing; no further automated action is safe.
    }
    this.muted = true;
  }

  private outcome(
    request: EffectRequest,
    status: EffectOutcome["status"],
    reason: string,
    detail: string | null,
  ): EffectOutcome {
    const observedAt = this.clock.now().toISOString();
    return {
      outcomeId: `outcome_${request.effectId}_${fnv1a(`${status}|${reason}|${observedAt}`)}`,
      effectId: request.effectId,
      status,
      reason,
      detail,
      observedAt,
    };
  }

  private recordManualOverride(action: ManualAudioAction): void {
    const now = this.clock.now();
    this.manualCooldownUntilMs = now.getTime() + this.options.manualCooldownMs;
    this.options.onManualOverride?.({
      action,
      occurredAt: now.toISOString(),
      cooldownUntil: new Date(this.manualCooldownUntilMs).toISOString(),
    });
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    const run = async () => {
      try {
        await task();
      } finally {
        this.publishSnapshot();
      }
    };
    const next = this.operation.then(run, run);
    this.operation = next.catch(() => undefined);
    await next;
  }
}

function assertGain(value: number): void {
  if (!isValidGain(value)) {
    throw new RangeError(`Gain must be between 0 and ${MAX_GAIN}.`);
  }
}

function assertRamp(value: number): void {
  if (!isValidRamp(value)) {
    throw new RangeError(
      `Ramp must be an integer between ${MIN_RAMP_MS} and ${MAX_RAMP_MS} ms.`,
    );
  }
}

function isValidGain(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_GAIN;
}

function isValidRamp(value: number): boolean {
  return (
    Number.isInteger(value) && value >= MIN_RAMP_MS && value <= MAX_RAMP_MS
  );
}

function isValidProfile(value: string): value is AudioProfileId {
  return (
    value === "diverge" ||
    value === "flow" ||
    value === "audit" ||
    value === "debug"
  );
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
