import { describe, expect, it } from "vitest";

import type { PlaybackPlan, PlanTrack } from "./contracts.js";
import { CrossfadeEngine } from "./crossfade-engine.js";
import type {
  DeckPort,
  GainParamPort,
  SchedulerPort,
} from "./crossfade-engine.js";

interface GainCall {
  readonly type: "setValue" | "setValueCurve";
  readonly at: number;
  readonly value?: number;
  readonly curve?: Float32Array;
  readonly duration?: number;
}

class RecordingGain implements GainParamPort {
  public readonly calls: GainCall[] = [];
  public setValueAtTime(value: number, startTime: number): void {
    this.calls.push({ type: "setValue", at: startTime, value });
  }
  public setValueCurveAtTime(
    curve: Float32Array,
    startTime: number,
    duration: number,
  ): void {
    this.calls.push({ type: "setValueCurve", at: startTime, curve, duration });
  }
  public cancelScheduledValues(_time: number): void {
    // Not part of the asserted contract surface.
  }
}

interface DeckEvent {
  readonly deck: string;
  readonly at: number;
  readonly action: "load" | "play" | "pause";
  readonly trackId?: string;
}

class RecordingDeck implements DeckPort {
  public readonly gain = new RecordingGain();
  public constructor(
    public readonly name: string,
    public readonly events: DeckEvent[],
  ) {}
  public load(track: PlanTrack): void {
    this.events.push({
      deck: this.name,
      at: NOW(),
      action: "load",
      trackId: track.trackId,
    });
  }
  public play(): void {
    this.events.push({ deck: this.name, at: NOW(), action: "play" });
  }
  public pause(): void {
    this.events.push({ deck: this.name, at: NOW(), action: "pause" });
  }
}

// Virtual clock in seconds (AudioContext-style), driven by the scheduler.
let virtualNow = 0;
function NOW(): number {
  return virtualNow;
}

interface ScheduledTask {
  readonly handle: number;
  readonly atMs: number;
  readonly handler: () => void;
}

class VirtualScheduler implements SchedulerPort {
  public queue: ScheduledTask[] = [];
  private nextHandle = 1;
  public setTimeout(handler: () => void, ms: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.queue.push({ handle, atMs: virtualNow * 1000 + ms, handler });
    return handle;
  }
  public clearTimeout(handle: number): void {
    this.queue = this.queue.filter((t) => t.handle !== handle);
  }
  public runNext(): void {
    const sorted = [...this.queue].sort((a, b) => a.atMs - b.atMs);
    const task = sorted[0];
    if (task === undefined) {
      return;
    }
    this.queue = this.queue.filter((t) => t.handle !== task.handle);
    virtualNow = task.atMs / 1000;
    task.handler();
  }
  public drain(limit = 500): void {
    for (let i = 0; i < limit && this.queue.length > 0; i += 1) {
      this.runNext();
    }
  }
}

function track(trackId: string, durationMs: number): PlanTrack {
  return {
    trackId,
    url: `/library/tracks/${trackId}.opus`,
    title: `Track ${trackId}`,
    artist: "A. Composer",
    license: "CC-BY 4.0",
    licenseUrl: "https://example.org/licenses/cc-by-4.0",
    durationMs,
  };
}

function makePlan(): PlaybackPlan {
  return {
    steps: [
      { track: track("alpha", 30_000), crossfadeMs: 5_000 },
      { track: track("beta", 30_000), crossfadeMs: 5_000 },
      { track: track("gamma", 30_000), crossfadeMs: 0 },
    ],
  };
}

function buildEngine() {
  virtualNow = 0;
  const events: DeckEvent[] = [];
  const deckA = new RecordingDeck("A", events);
  const deckB = new RecordingDeck("B", events);
  const scheduler = new VirtualScheduler();
  const engine = new CrossfadeEngine({
    deckA,
    deckB,
    scheduler,
    clock: { now: NOW },
  });
  return { engine, deckA, deckB, scheduler, events };
}

describe("CrossfadeEngine state machine", () => {
  it("starts idle, plays the first deck after start(), and ends after the plan", () => {
    const { engine, scheduler, events } = buildEngine();
    expect(engine.getState().state).toBe("idle");

    engine.start(makePlan());
    expect(engine.getState()).toMatchObject({ state: "playing", stepIndex: 0 });
    expect(events.filter((e) => e.action === "play").map((e) => e.at)).toEqual([
      0,
    ]);

    scheduler.drain();
    expect(engine.getState().state).toBe("ended");
  });

  it("exposes the now-playing track and follows step changes", () => {
    const { engine, scheduler } = buildEngine();
    engine.start(makePlan());
    expect(engine.getState().nowPlaying?.trackId).toBe("alpha");
    scheduler.runNext(); // alpha -> beta crossfade starts
    expect(engine.getState().nowPlaying?.trackId).toBe("alpha");
    scheduler.runNext(); // crossfade completes
    expect(engine.getState().nowPlaying?.trackId).toBe("beta");
  });

  it("refuses to start an invalid plan", () => {
    const { engine } = buildEngine();
    const base = makePlan();
    const bad: PlaybackPlan = {
      steps: [
        {
          track: {
            ...track("alpha", 30_000),
            url: "https://cdn.example.com/alpha.opus",
          },
          crossfadeMs: base.steps[0]!.crossfadeMs,
        },
        ...base.steps.slice(1),
      ],
    };
    expect(() => engine.start(bad)).toThrow(/plan/i);
    expect(engine.getState().state).toBe("idle");
  });

  it("stop() cancels pending transitions and silences both decks", () => {
    const { engine, deckA, deckB, scheduler } = buildEngine();
    engine.start(makePlan());
    engine.stop();
    expect(engine.getState().state).toBe("idle");
    const aLast = deckA.gain.calls.at(-1);
    const bLast = deckB.gain.calls.at(-1);
    expect(aLast?.type === "setValue" && aLast.value === 0).toBe(true);
    expect(bLast?.type === "setValue" && bLast.value === 0).toBe(true);
    // Draining afterwards must not resurrect playback.
    scheduler.drain();
    expect(engine.getState().state).toBe("idle");
  });
});

describe("crossfade scheduling (no audible gap)", () => {
  it("plays the incoming deck before fading and pauses the outgoing deck exactly at fade end", () => {
    const { engine, deckA, deckB, scheduler } = buildEngine();
    engine.start(makePlan());
    scheduler.runNext(); // fires at 25s: alpha->beta overlap begins

    // Incoming deck starts before the fade end, at fade start.
    const bPlay = deckB.events.find(
      (e) => e.deck === "B" && e.action === "play",
    );
    expect(bPlay?.at).toBe(25);

    // deckA's first curve is the opening fade-in; the transition fade-out is
    // its most recent curve.
    const fadeOut = deckA.gain.calls.findLast(
      (c) => c.type === "setValueCurve",
    );
    const fadeIn = deckB.gain.calls.find((c) => c.type === "setValueCurve");
    expect(fadeOut).toBeDefined();
    expect(fadeIn).toBeDefined();
    expect(fadeOut!.at).toBe(25);
    expect(fadeIn!.at).toBe(25);
    expect(fadeOut!.duration).toBe(5);
    expect(fadeIn!.duration).toBe(5);

    scheduler.runNext(); // overlap completes at 30s
    const aPause = deckA.events.find(
      (e) => e.deck === "A" && e.action === "pause",
    );
    expect(aPause?.at).toBe(30);
    // Ordering invariant: incoming play (25) <= fade start (25) < fade end (30) = outgoing pause.
    expect(bPlay!.at).toBeLessThanOrEqual(fadeIn!.at);
    expect(fadeIn!.at).toBeLessThan(aPause!.at);
  });

  it("uses mirrored equal-power curves: same length, power sum 1, no interior zeros", () => {
    const { engine, deckA, deckB, scheduler } = buildEngine();
    engine.start(makePlan());
    scheduler.runNext();

    const fadeOut = deckA.gain.calls.findLast(
      (c) => c.type === "setValueCurve",
    )!;
    const fadeIn = deckB.gain.calls.findLast(
      (c) => c.type === "setValueCurve",
    )!;
    expect(fadeOut.curve!.length).toBe(fadeIn.curve!.length);
    const n = fadeOut.curve!.length;
    for (let i = 0; i < n; i += 1) {
      const power = fadeOut.curve![i]! ** 2 + fadeIn.curve![i]! ** 2;
      expect(Math.abs(power - 1)).toBeLessThan(1e-6);
      if (i < n - 1) {
        expect(fadeOut.curve![i]!).toBeGreaterThan(0);
      }
      if (i > 0) {
        expect(fadeIn.curve![i]!).toBeGreaterThan(0);
      }
    }
  });

  it("hard cuts (crossfadeMs 0): old deck pauses, new deck plays at full gain, no curve scheduled", () => {
    const { engine, deckA, deckB, scheduler } = buildEngine();
    engine.start(makePlan());
    scheduler.drain(); // 0s alpha, 25s overlap, 30s beta, 55s cut->gamma, 85s end

    // Deck roles after the alpha->beta crossfade: deckA idle (played alpha),
    // deckB active (beta). The cut at 55s swaps back: deckB pauses, deckA
    // takes gamma at full gain via setValue — no crossfade curve for the cut.
    expect(deckB.events.some((e) => e.action === "pause" && e.at === 55)).toBe(
      true,
    );
    expect(
      deckA.events.some((e) => e.action === "load" && e.trackId === "gamma"),
    ).toBe(true);
    expect(deckA.events.some((e) => e.action === "play" && e.at === 55)).toBe(
      true,
    );
    expect(
      deckA.gain.calls.some(
        (c) => c.type === "setValue" && c.value === 1 && c.at === 55,
      ),
    ).toBe(true);
    expect(
      deckA.gain.calls.some((c) => c.type === "setValueCurve" && c.at === 55),
    ).toBe(false);
    expect(engine.getState().state).toBe("ended");
  });
});

describe("manual skip", () => {
  it("triggers the next step's configured crossfade immediately", () => {
    const { engine, deckB, scheduler } = buildEngine();
    engine.start(makePlan());
    virtualNow = 10; // 10s into alpha
    engine.skip();
    expect(engine.getState()).toMatchObject({
      state: "crossfading",
      stepIndex: 0,
    });
    const fadeIn = deckB.gain.calls.find((c) => c.type === "setValueCurve");
    expect(fadeIn).toBeDefined();
    expect(fadeIn!.at).toBe(10);
    scheduler.runNext();
    expect(engine.getState()).toMatchObject({ state: "playing", stepIndex: 1 });
  });

  it("skip during an ongoing crossfade is ignored (one transition at a time)", () => {
    const { engine, scheduler } = buildEngine();
    engine.start(makePlan());
    scheduler.runNext(); // enter crossfade at 25s
    virtualNow = 26;
    engine.skip();
    expect(engine.getState().state).toBe("crossfading");
    expect(engine.getState().stepIndex).toBe(0);
  });

  it("skip on the last step ends playback", () => {
    const { engine, scheduler } = buildEngine();
    engine.start(makePlan());
    scheduler.drain();
    virtualNow = 200;
    engine.skip();
    expect(engine.getState().state).toBe("ended");
  });
});

describe("CrossfadeEngine.attachDecks (start-gesture deck swap)", () => {
  it("plays through the attached pair after an idle swap, ignoring the stubs", () => {
    const { engine, scheduler } = buildEngine();
    const events: DeckEvent[] = [];
    const liveA = new RecordingDeck("liveA", events);
    const liveB = new RecordingDeck("liveB", events);

    engine.attachDecks(liveA, liveB);
    engine.start(makePlan());

    // The first load/play landed on the attached deck, not the stubs.
    const loads = events.filter((e) => e.action === "load");
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ deck: "liveA", trackId: "alpha" });
    expect(events.filter((e) => e.action === "play")).toEqual([
      { deck: "liveA", at: 0, action: "play" },
    ]);

    // Transitions use the attached pair too.
    scheduler.runNext();
    const transitionLoads = events.filter(
      (e) => e.action === "load" && e.trackId === "beta",
    );
    expect(transitionLoads).toHaveLength(1);
    expect(transitionLoads[0]!.deck).toBe("liveB");
  });

  it("refuses the swap mid-playback so a running session keeps its decks", () => {
    const { engine, deckA } = buildEngine();
    engine.start(makePlan());
    const lateEvents: DeckEvent[] = [];
    const lateA = new RecordingDeck("lateA", lateEvents);
    const lateB = new RecordingDeck("lateB", lateEvents);

    engine.attachDecks(lateA, lateB);
    expect(engine.getState().nowPlaying?.trackId).toBe("alpha");
    // No load/play ever reached the late pair...
    expect(lateEvents).toHaveLength(0);
    // ...while the original deck still holds the running track.
    expect(
      deckA.events.filter((e) => e.action === "load").map((e) => e.trackId),
    ).toEqual(["alpha"]);
  });
});
