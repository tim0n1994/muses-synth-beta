import { describe, expect, it } from "vitest";

import type { EffectRequest } from "../../server/effects/contracts.js";
import { AudioRuntime } from "./audio-runtime.js";
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
  it("keeps Pause before the first Play a native no-op", async () => {
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(facade, { manualCooldownMs: 0 });
    const observed: boolean[] = [];
    executor.subscribe(() => observed.push(executor.snapshot().paused));
    await executor.pause();
    await executor.pause(5000);
    expect(facade.calls).toEqual([]);
    expect(executor.snapshot()).toMatchObject({
      started: false,
      paused: false,
    });
    expect(observed).toEqual([false, false]);
  });

  it("retries failed cancellation even when the first Start never completed", async () => {
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(facade, { manualCooldownMs: 0 });
    let activate!: () => void;
    facade.start = () =>
      new Promise<void>((resolve) => {
        activate = resolve;
      });
    facade.pause = () => Promise.reject(new Error("native suspend failed"));
    const start = executor.start();
    const cancelled = expect(start).rejects.toThrow(
      "Audio start was cancelled.",
    );
    const pause = executor.pause();
    const failed = expect(pause).rejects.toThrow("native suspend failed");
    activate();
    await cancelled;
    await failed;
    expect(executor.snapshot().started).toBe(false);
    facade.pause = async (duration) => {
      facade.calls.push(`pause:${duration}`);
    };
    await executor.pause();
    expect(facade.calls.at(-1)).toBe("pause:500");
    expect(executor.snapshot().paused).toBe(true);
  });

  it("does not publish resumed playback when an old Pause rejects after disposal", async () => {
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(facade, { manualCooldownMs: 0 });
    await executor.start();
    const observed: Array<{ started: boolean; paused: boolean }> = [];
    executor.subscribe(() => {
      const { started, paused } = executor.snapshot();
      observed.push({ started, paused });
    });
    let reject!: (error: Error) => void;
    facade.pause = () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
    let release!: () => void;
    facade.dispose = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pause = executor.pause();
    const failed = expect(pause).rejects.toThrow("native suspend failed");
    const disposal = executor.dispose();
    reject(new Error("native suspend failed"));
    await failed;
    expect(observed).toEqual(
      Array.from({ length: 3 }, () => ({ started: true, paused: true })),
    );
    release();
    await disposal;
    expect(observed.at(-1)).toEqual({ started: false, paused: false });
    expect(observed.some((state) => state.started && !state.paused)).toBe(
      false,
    );
  });

  it.each([false, true])(
    "notifies observers after pause failure while preserving newer Play ownership (%s)",
    async (newerPlay) => {
      const facade = new FakeAudioFacade();
      const executor = new AudioEffectExecutor(facade, { manualCooldownMs: 0 });
      await executor.start();
      const observed: boolean[] = [];
      executor.subscribe(() => observed.push(executor.snapshot().paused));
      let reject!: (error: Error) => void;
      facade.pause = () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        });
      const pause = executor.pause();
      const failed = expect(pause).rejects.toThrow("native suspend failed");
      let activate!: () => void;
      facade.start = () =>
        new Promise<void>((resolve) => {
          activate = resolve;
        });
      const play = newerPlay ? executor.start("debug") : null;
      reject(new Error("native suspend failed"));
      await failed;
      expect(observed).toEqual(newerPlay ? [true, true] : [true, false]);
      if (play !== null) {
        activate();
        await play;
        expect(observed).toEqual([true, true, false]);
        expect(executor.snapshot().currentProfile).toBe("debug");
      }
    },
  );

  it.each([500, 5000])(
    "uses the requested %s-ms pause ramp and waits for completion",
    async (rampMs) => {
      const facade = new FakeAudioFacade();
      const notices: ManualOverrideNotice[] = [];
      const executor = new AudioEffectExecutor(facade, {
        manualCooldownMs: 0,
        onManualOverride: (notice) => notices.push(notice),
      });
      await executor.start();
      let release!: () => void;
      facade.pause = (duration) => {
        facade.calls.push(`pause:${duration}`);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      };
      const pause = executor.pause(rampMs);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(facade.calls.at(-1)).toBe(`pause:${rampMs}`);
      expect(notices.map((notice) => notice.action)).toEqual(["start"]);
      release();
      await pause;
      expect(notices.map((notice) => notice.action)).toEqual([
        "start",
        "pause",
      ]);
    },
  );

  it.each([false, true])(
    "retries a failed pause without Play (synchronous cancellation: %s)",
    async (cancelFirst) => {
      const facade = new FakeAudioFacade();
      const runtime = new AudioRuntime({ facade, manualCooldownMs: 0 });
      await runtime.runManualCommand("play", { effectId: "play" });
      facade.pause = (duration) => {
        facade.calls.push(`pause:${duration}`);
        return Promise.reject(new Error("native suspend failed"));
      };
      if (cancelFirst) runtime.cancelPendingStart();
      await expect(
        runtime.runManualCommand("pause", { effectId: "failed" }),
      ).resolves.toMatchObject({
        status: "failed",
        detail: "native suspend failed",
      });
      expect(runtime.snapshot().paused).toBe(false);
      facade.pause = async (duration) => {
        facade.calls.push(`pause:${duration}`);
      };
      await expect(
        runtime.runManualCommand("pause", { effectId: "retry" }),
      ).resolves.toMatchObject({
        status: "skipped",
        reason: "MANUAL_PAUSE",
      });
      expect(facade.calls.filter((call) => call.startsWith("pause:"))).toEqual([
        cancelFirst ? "pause:0" : "pause:500",
        "pause:500",
      ]);
      expect(runtime.snapshot().paused).toBe(true);
    },
  );

  it("waits for native pause before reporting MANUAL_PAUSE after synchronous cancellation", async () => {
    const facade = new FakeAudioFacade();
    const runtime = new AudioRuntime({ facade, manualCooldownMs: 0 });
    await runtime.runManualCommand("play", { effectId: "play" });
    let release!: () => void;
    const suspension = new Promise<void>((resolve) => {
      release = resolve;
    });
    facade.pause = (rampMs) => {
      facade.calls.push(`pause:${rampMs}`);
      return suspension;
    };
    runtime.cancelPendingStart();
    expect(facade.calls.at(-1)).toBe("pause:0");
    let completed = false;
    const pause = runtime.runManualCommand("pause", { effectId: "pause" });
    void pause.then(() => {
      completed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);
    release();
    await expect(pause).resolves.toMatchObject({
      status: "skipped",
      reason: "MANUAL_PAUSE",
    });
    expect(facade.calls.filter((call) => call.startsWith("pause:"))).toEqual([
      "pause:0",
    ]);
  });

  it.each([false, true])(
    "reports native pause rejection instead of success (rejected before pause command: %s)",
    async (rejectBeforeCommand) => {
      const facade = new FakeAudioFacade();
      const runtime = new AudioRuntime({ facade, manualCooldownMs: 0 });
      await runtime.runManualCommand("play", { effectId: "play" });
      let reject!: (error: Error) => void;
      const suspension = new Promise<void>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      });
      facade.pause = () => suspension;
      runtime.cancelPendingStart();
      if (rejectBeforeCommand) {
        reject(new Error("native suspend failed"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const pause = runtime.runManualCommand("pause", { effectId: "pause" });
      if (!rejectBeforeCommand) reject(new Error("native suspend failed"));
      await expect(pause).resolves.toMatchObject({
        status: "failed",
        reason: "MANUAL_PAUSE",
        detail: "native suspend failed",
      });
    },
  );

  it("lets a newer Play win over an old pending pause without pausing again", async () => {
    const facade = new FakeAudioFacade();
    const notices: ManualOverrideNotice[] = [];
    const executor = new AudioEffectExecutor(facade, {
      manualCooldownMs: 0,
      onManualOverride: (notice) => notices.push(notice),
    });
    await executor.start();
    let release!: () => void;
    facade.pause = (rampMs) => {
      facade.calls.push(`pause:${rampMs}`);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const pause = executor.pause();
    const play = executor.start("debug");
    expect(facade.calls.slice(-2)).toEqual(["pause:500", "start"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notices.map((notice) => notice.action)).toEqual(["start"]);
    release();
    await pause;
    await play;
    expect(executor.snapshot()).toMatchObject({
      paused: false,
      currentProfile: "debug",
    });
    expect(notices.map((notice) => notice.action)).toEqual([
      "start",
      "pause",
      "start",
    ]);
    expect(facade.calls.filter((call) => call.startsWith("pause:"))).toEqual([
      "pause:500",
    ]);
  });

  it("waits for native pause even when the cancelled start never completed", async () => {
    const facade = new FakeAudioFacade();
    const notices: ManualOverrideNotice[] = [];
    const executor = new AudioEffectExecutor(facade, {
      manualCooldownMs: 0,
      onManualOverride: (notice) => notices.push(notice),
    });
    let activate!: () => void;
    facade.start = () =>
      new Promise<void>((resolve) => {
        activate = resolve;
      });
    let suspend!: () => void;
    facade.pause = (duration) => {
      facade.calls.push(`pause:${duration}`);
      return new Promise<void>((resolve) => {
        suspend = resolve;
      });
    };
    const start = executor.start();
    const cancelled = expect(start).rejects.toThrow(
      "Audio start was cancelled.",
    );
    const pause = executor.pause();
    expect(facade.calls.at(-1)).toBe("pause:0");
    activate();
    await cancelled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notices).toEqual([]);
    suspend();
    await pause;
    expect(notices.map((notice) => notice.action)).toEqual(["pause"]);
    expect(executor.snapshot().started).toBe(false);
  });

  it("does not let an old pause rejection disturb a newer Play", async () => {
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(facade, { manualCooldownMs: 0 });
    await executor.start();
    let reject!: (error: Error) => void;
    facade.pause = () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
    const pause = executor.pause();
    const failed = expect(pause).rejects.toThrow("native suspend failed");
    const play = executor.start("debug");
    reject(new Error("native suspend failed"));
    await failed;
    await play;
    expect(executor.snapshot()).toMatchObject({
      paused: false,
      currentProfile: "debug",
    });
    facade.pause = async () => undefined;
    await executor.pause();
    expect(executor.snapshot().paused).toBe(true);
  });

  it("does not carry a failed old pause into a new Play and Pause", async () => {
    const facade = new FakeAudioFacade();
    const executor = new AudioEffectExecutor(facade, { manualCooldownMs: 0 });
    await executor.start();
    facade.pause = () => Promise.reject(new Error("native suspend failed"));
    await expect(executor.pause()).rejects.toThrow("native suspend failed");
    await executor.start();
    facade.pause = async () => undefined;
    await expect(executor.pause()).resolves.toBeUndefined();
    expect(executor.snapshot().paused).toBe(true);
  });

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
