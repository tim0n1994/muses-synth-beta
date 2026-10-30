import { describe, expect, it, vi } from "vitest";
import { CrossfadeEngine, type DeckPort } from "./crossfade-engine.js";
import type { PlaybackPlan } from "./contracts.js";

const plan: PlaybackPlan = {
  steps: [
    {
      crossfadeMs: 0,
      track: {
        trackId: "tone",
        url: "/library/tone.wav",
        title: "Tone",
        artist: "Fixture",
        license: "CC0",
        licenseUrl: "https://example.org/license",
        durationMs: 5000,
      },
    },
  ],
};

function setup() {
  let resolve!: () => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const pause = vi.fn();
  const deck: DeckPort = {
    load: vi.fn(),
    play: () => promise,
    pause,
    gain: {
      setValueAtTime: vi.fn(),
      setValueCurveAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
  };
  const setTimeout = vi.fn(() => 1);
  const engine = new CrossfadeEngine({
    deckA: deck,
    deckB: deck,
    clock: { now: () => 0 },
    scheduler: { setTimeout, clearTimeout: vi.fn() },
  });
  return { engine, resolve, reject, pause, setTimeout };
}

describe("media start acknowledgement", () => {
  it("does not publish playing or schedule a timeline before media resolves", async () => {
    const { engine, resolve, setTimeout } = setup();
    engine.start(plan);
    expect(engine.getState()).toMatchObject({ state: "idle", pending: true });
    expect(setTimeout).not.toHaveBeenCalled();
    resolve();
    await Promise.resolve();
    expect(engine.getState()).toMatchObject({
      state: "playing",
      pending: false,
    });
    expect(setTimeout).toHaveBeenCalledOnce();
  });
  it("surfaces rejection and leaves both decks paused without a timeline", async () => {
    const { engine, reject, pause, setTimeout } = setup();
    engine.start(plan);
    reject(new Error("decode failed"));
    await vi.waitFor(() =>
      expect(engine.getState().error).toBe("decode failed"),
    );
    expect(engine.getState()).toMatchObject({ state: "idle", pending: false });
    expect(pause).toHaveBeenCalledTimes(2);
    expect(setTimeout).not.toHaveBeenCalled();
  });
  it("Stop wins over a late successful media start", async () => {
    const { engine, resolve, setTimeout } = setup();
    engine.start(plan);
    engine.stop();
    resolve();
    await Promise.resolve();
    expect(engine.getState()).toMatchObject({ state: "idle", pending: false });
    expect(setTimeout).not.toHaveBeenCalled();
  });
});
