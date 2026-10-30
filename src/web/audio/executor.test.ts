import { describe, expect, it } from "vitest";

import type { EffectRequest } from "../../server/effects/contracts.js";
import type {
  AudioClock,
  AudioFacade,
  AudioProfileDefinition,
  ManualOverrideNotice,
} from "./contracts.js";
import { AudioEffectExecutor } from "./executor.js";

class FakeClock implements AudioClock {
  private timestamp = new Date("2026-07-30T03:00:00.000Z").getTime();
  public now(): Date {
    return new Date(this.timestamp);
  }
  public async sleep(milliseconds: number): Promise<void> {
    this.timestamp += milliseconds;
  }
  public advance(milliseconds: number): void {
    this.timestamp += milliseconds;
  }
}

class FakeAudioFacade implements AudioFacade {
  public readonly calls: string[] = [];
  public failApply = false;

  public async start(): Promise<void> {
    this.calls.push("start");
  }
  public async applyProfile(
    profile: AudioProfileDefinition,
    crossfadeMs: number,
  ): Promise<void> {
    this.calls.push(`profile:${profile.id}:${crossfadeMs}`);
    if (this.failApply) {
      throw new Error("synthetic failure");
    }
  }
  public async rampMasterGain(
    targetGain: number,
    rampMs: number,
  ): Promise<void> {
    this.calls.push(`gain:${targetGain}:${rampMs}`);
  }
  public async pause(rampMs: number): Promise<void> {
    this.calls.push(`pause:${rampMs}`);
  }
  public async dispose(): Promise<void> {
    this.calls.push("dispose");
  }
}

function request(
  profile: "diverge" | "flow" | "audit" | "debug" = "debug",
): EffectRequest {
  return {
    effectId: "effect-1",
    decisionId: "decision-1",
    actionId: "audio.adjust",
    adjustment: {
      actionId: "audio.adjust",
      profile,
      targetGain: 0.15,
      rampMs: 900,
    },
    issuedAt: "2026-07-30T03:00:00.000Z",
    status: "issued",
  };
}

describe("AudioEffectExecutor", () => {
  it("does not acknowledge an in-flight automatic change as applied after a manual pause", async () => {
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(
      facade,
      { manualCooldownMs: 0 },
      new FakeClock(),
    );
    await executor.start("flow");
    let release!: () => void;
    let entered!: () => void;
    const applying = new Promise<void>((resolve) => {
      entered = resolve;
    });
    facade.applyProfile = () => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const automatic = executor.execute(request());
    await applying;
    const paused = executor.pause();
    release();
    await expect(automatic).resolves.toMatchObject({
      status: "skipped",
      reason: "MANUAL_COOLDOWN",
    });
    await paused;
    expect(executor.snapshot().paused).toBe(true);
  });
  it("requires explicit start before automated effects", async () => {
    const executor = new AudioEffectExecutor(
      new FakeAudioFacade(),
      { manualCooldownMs: 1000 },
      new FakeClock(),
    );
    await expect(executor.execute(request())).resolves.toMatchObject({
      status: "skipped",
      reason: "EXPLICIT_START_REQUIRED",
    });
  });

  it("gives manual override cooldown priority", async () => {
    const clock = new FakeClock();
    const facade = new FakeAudioFacade();
    const notices: ManualOverrideNotice[] = [];
    const executor = new AudioEffectExecutor(
      facade,
      {
        manualCooldownMs: 1000,
        onManualOverride: (notice) => notices.push(notice),
      },
      clock,
    );
    await executor.start("flow", 0.18);
    await expect(executor.execute(request())).resolves.toMatchObject({
      status: "skipped",
      reason: "MANUAL_COOLDOWN",
    });
    clock.advance(1001);
    await expect(executor.execute(request())).resolves.toMatchObject({
      status: "applied",
      reason: "PROFILE_APPLIED",
    });
    expect(notices[0]?.action).toBe("start");
  });

  it("ramps mute and unmute instead of changing gain abruptly", async () => {
    const clock = new FakeClock();
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(
      facade,
      { manualCooldownMs: 0 },
      clock,
    );
    await executor.start("flow", 0.18);
    await executor.mute(350);
    await executor.unmute(350);
    expect(facade.calls).toContain("gain:0:350");
    expect(facade.calls).toContain("gain:0.18:350");
  });

  it("fails closed to silence when the audio facade fails", async () => {
    const clock = new FakeClock();
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(
      facade,
      { manualCooldownMs: 0 },
      clock,
    );
    await executor.start("flow", 0.18);
    facade.failApply = true;
    const outcome = await executor.execute(request("debug"));
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "AUDIO_FACADE_FAILURE",
    });
    expect(facade.calls).toContain("gain:0:300");
    expect(executor.snapshot().muted).toBe(true);
  });
});
