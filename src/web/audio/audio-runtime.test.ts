import { describe, expect, it, vi } from "vitest";

import type { EffectRequest } from "../../server/effects/contracts.js";
import { AudioRuntime } from "./audio-runtime.js";
import type { AudioFacade } from "./contracts.js";

/**
 * Spies are held as standalone consts rather than read back off the facade so
 * assertions never pass an unbound method reference around.
 */
function createFacade(overrides: Partial<AudioFacade> = {}) {
  const start = vi.fn(async () => undefined);
  const applyProfile = vi.fn(async () => undefined);
  const rampMasterGain = vi.fn(async () => undefined);
  const pause = vi.fn(async () => undefined);
  const dispose = vi.fn(async () => undefined);
  const facade: AudioFacade = {
    start,
    applyProfile,
    rampMasterGain,
    pause,
    dispose,
    ...overrides,
  };
  return { facade, start, applyProfile, rampMasterGain, pause, dispose };
}

const issuedEffect: EffectRequest = {
  effectId: "effect_1",
  decisionId: "decision_1",
  actionId: "audio.adjust",
  adjustment: {
    actionId: "audio.adjust",
    profile: "flow",
    targetGain: 0.3,
    rampMs: 1_000,
  },
  issuedAt: "2026-08-21T10:00:00.000Z",
  status: "issued",
};

describe("AudioRuntime", () => {
  it("publishes async state changes, caches unchanged snapshots, and unsubscribes", async () => {
    const runtime = new AudioRuntime({ facade: createFacade().facade });
    expect(runtime.snapshot()).toBe(runtime.snapshot());
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    const before = runtime.snapshot();
    await runtime.runManualCommand("play", { effectId: "subscribed" });
    expect(listener).toHaveBeenCalled();
    expect(runtime.snapshot()).not.toBe(before);
    expect(runtime.snapshot()).toBe(runtime.snapshot());
    unsubscribe();
    listener.mockClear();
    await runtime.runManualCommand("pause", { effectId: "unsubscribed" });
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.snapshot().paused).toBe(true);
  });
  it("actually starts the audio graph on a manual play", async () => {
    const { facade, start, applyProfile } = createFacade();
    const runtime = new AudioRuntime({ manualCooldownMs: 0, facade });

    const outcome = await runtime.runManualCommand("play", {
      effectId: "effect_1",
      profile: "flow",
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(applyProfile).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("applied");
    expect(outcome.reason).toBe("MANUAL_START");
    expect(runtime.snapshot().started).toBe(true);
  });

  it("reports every manual command with a reserved override reason", async () => {
    const runtime = new AudioRuntime({
      manualCooldownMs: 0,
      facade: createFacade().facade,
    });
    await runtime.runManualCommand("play", { effectId: "e" });

    const pause = await runtime.runManualCommand("pause", { effectId: "e" });
    const volume = await runtime.runManualCommand("set-volume", {
      effectId: "e",
      volume: 0.2,
    });
    const revert = await runtime.runManualCommand("undo-decision", {
      effectId: "e",
    });

    // The server keys its MANUAL_COOLDOWN on exactly these tokens.
    expect([pause.reason, volume.reason, revert.reason]).toEqual([
      "MANUAL_PAUSE",
      "MANUAL_VOLUME",
      "MANUAL_REVERT",
    ]);
    expect([pause.status, volume.status, revert.status]).toEqual([
      "skipped",
      "applied",
      "reverted",
    ]);
  });

  it("declines a server-issued effect until the user starts audio", async () => {
    const { facade, start } = createFacade();
    const runtime = new AudioRuntime({ manualCooldownMs: 0, facade });

    const outcome = await runtime.applyIssuedEffect(issuedEffect);

    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("EXPLICIT_START_REQUIRED");
    expect(start).not.toHaveBeenCalled();
  });

  it("applies a server-issued effect once audio is running", async () => {
    const { facade, rampMasterGain } = createFacade();
    const runtime = new AudioRuntime({ manualCooldownMs: 0, facade });
    await runtime.runManualCommand("play", { effectId: "e", profile: "audit" });

    const outcome = await runtime.applyIssuedEffect(issuedEffect);

    expect(outcome.status).toBe("applied");
    expect(runtime.snapshot().currentProfile).toBe("flow");
    expect(rampMasterGain).toHaveBeenCalledWith(0.3, 1_000);
  });

  it("keeps a manual pause authoritative over a later automated effect", async () => {
    const runtime = new AudioRuntime({
      manualCooldownMs: 0,
      facade: createFacade().facade,
    });
    await runtime.runManualCommand("play", { effectId: "e" });
    await runtime.runManualCommand("pause", { effectId: "e" });

    const outcome = await runtime.applyIssuedEffect(issuedEffect);

    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("MANUALLY_PAUSED");
  });

  it("reports a failed outcome instead of throwing when the engine breaks", async () => {
    const runtime = new AudioRuntime({
      manualCooldownMs: 0,
      facade: createFacade({
        start: vi.fn(async () => {
          throw new Error("AudioContext unavailable");
        }),
      }).facade,
    });

    const outcome = await runtime.runManualCommand("play", { effectId: "e" });

    expect(outcome.status).toBe("failed");
    expect(outcome.detail).toContain("AudioContext unavailable");
  });
});
