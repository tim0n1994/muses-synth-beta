import { describe, expect, it, vi } from "vitest";
import { WebAudioFacade } from "./web-audio-facade.js";
import { getAudioProfile } from "./profiles.js";
import { AudioRuntime } from "./audio-runtime.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const ramp = deferred();
  const suspendEntered = deferred();
  const suspendFinished = deferred();
  let delaySuspend = false;
  const parameter = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: parameter(),
  });
  const gains: Array<ReturnType<typeof node>> = [];
  const makeSource = () => ({
    ...node(),
    frequency: parameter(),
    detune: parameter(),
    start: vi.fn(),
    stop: vi.fn(),
  });
  const sources: Array<ReturnType<typeof makeSource>> = [];
  function source() {
    const value = makeSource();
    sources.push(value);
    return value;
  }
  const context = {
    state: "running" as AudioContextState,
    currentTime: 0,
    sampleRate: 100,
    destination: node(),
    createGain: vi.fn(() => {
      const value = node();
      gains.push(value);
      return value;
    }),
    createOscillator: vi.fn(source),
    createBufferSource: vi.fn(source),
    createBiquadFilter: () => ({
      ...node(),
      frequency: parameter(),
      Q: parameter(),
    }),
    createBuffer: (_channels: number, frames: number) => ({
      getChannelData: () => new Float32Array(frames),
    }),
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    suspend: vi.fn(async () => {
      suspendEntered.resolve();
      if (delaySuspend) await suspendFinished.promise;
      context.state = "suspended";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
  };
  const clock = { now: () => new Date(), sleep: vi.fn(() => ramp.promise) };
  const facade = new WebAudioFacade(
    { create: () => context as unknown as AudioContext },
    clock,
  );
  return {
    facade,
    context,
    clock,
    ramp,
    suspendEntered,
    suspendFinished,
    gains,
    sources,
    delaySuspend: () => {
      delaySuspend = true;
    },
  };
}

describe("WebAudioFacade asynchronous ownership", () => {
  it("rapid runtime Pause→Play survives the previous pause ramp", async () => {
    const h = harness();
    h.ramp.resolve();
    const runtime = new AudioRuntime({ facade: h.facade });
    await runtime.runManualCommand("play", { effectId: "initial" });
    const oldRamp = deferred();
    h.clock.sleep.mockReturnValueOnce(oldRamp.promise);
    const pause = runtime.runManualCommand("pause", { effectId: "pause" });
    const play = runtime.runManualCommand("play", { effectId: "restart" });
    oldRamp.resolve();
    await pause;
    await expect(play).resolves.toMatchObject({ status: "applied" });
    expect(h.context.state).toBe("running");
    expect(runtime.snapshot()).toMatchObject({ paused: false, muted: false });
  });

  it("runtime disposal releases an in-flight start immediately and prevents reuse", async () => {
    const h = harness();
    const runtime = new AudioRuntime({ facade: h.facade });
    const play = runtime.runManualCommand("play", { effectId: "initial" });
    await vi.waitFor(() => expect(h.sources).toHaveLength(3));
    const disposed = runtime.dispose();
    expect(h.context.close).toHaveBeenCalledTimes(1);
    h.ramp.resolve();
    await disposed;
    await expect(play).resolves.toMatchObject({ status: "failed" });
    await expect(
      runtime.runManualCommand("play", { effectId: "late" }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(h.context.state).toBe("closed");
  });
  it("a new start cancels an old pause still awaiting its zero-ms ramp", async () => {
    const { facade, context, ramp, gains } = harness();
    await facade.start();
    const pause = facade.pause(0);
    await facade.start();
    const master = gains[0]!;
    master.gain.value = 0.18;
    ramp.resolve();
    await pause;
    expect(context.state).toBe("running");
    expect(context.suspend).not.toHaveBeenCalled();
    expect(master.gain.value).toBe(0.18);
  });

  it("forces zero gain before suspension when audio rendering lags the timer", async () => {
    const { facade, context, ramp, gains } = harness();
    await facade.start();
    const master = gains[0]!;
    master.gain.value = 0.18;
    const pause = facade.pause(0);
    ramp.resolve();
    await pause;
    expect(master.gain.cancelScheduledValues).toHaveBeenLastCalledWith(
      context.currentTime,
    );
    expect(master.gain.value).toBe(0);
    expect(context.state).toBe("suspended");
  });

  it("a new start wins even when an older native suspend is already pending", async () => {
    const h = harness();
    await h.facade.start();
    h.delaySuspend();
    const pause = h.facade.pause(0);
    h.ramp.resolve();
    await h.suspendEntered.promise;
    const restart = h.facade.start();
    h.suspendFinished.resolve();
    await Promise.all([pause, restart]);
    expect(h.context.state).toBe("running");
  });

  it("dispose during a crossfade stops both graphs immediately and is terminal", async () => {
    const h = harness();
    await h.facade.start();
    const flow = h.facade.applyProfile(getAudioProfile("flow"), 1000);
    const audit = h.facade.applyProfile(getAudioProfile("audit"), 1000);
    await h.facade.dispose();
    expect(h.sources).toHaveLength(6);
    expect(
      h.sources.every((source) => source.stop.mock.calls.length === 1),
    ).toBe(true);
    expect(h.context.state).toBe("closed");
    await expect(h.facade.start()).rejects.toThrow(/disposed/iu);
    h.ramp.resolve();
    await Promise.all([flow, audit]);
    await h.facade.dispose();
    expect(h.context.close).toHaveBeenCalledTimes(1);
  });
});
