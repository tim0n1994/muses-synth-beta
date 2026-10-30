import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PlaybackPlan, PlanTrack } from "./contracts.js";
import type { DeckPort, GainParamPort } from "./crossfade-engine.js";
import {
  SelfTrackPlayer,
  type SelfTrackPlayerProps,
} from "./SelfTrackPlayer.js";

class NullGain implements GainParamPort {
  public setValueAtTime(): void {}
  public setValueCurveAtTime(): void {}
  public cancelScheduledValues(): void {}
}

class FakeDeck implements DeckPort {
  public readonly gain = new NullGain();
  public loaded: string[] = [];
  public load(track: PlanTrack): void {
    this.loaded.push(track.trackId);
  }
  public play(): void {}
  public pause(): void {}
}

const planTracks: readonly PlanTrack[] = [
  {
    trackId: "p-1",
    url: "/library/tracks/p-1.opus",
    title: "Opening Pulse",
    artist: "Composer One",
    license: "CC-BY 4.0",
    licenseUrl: "https://example.org/licenses/by/4.0",
    durationMs: 90_000,
  },
  {
    trackId: "p-2",
    url: "/library/tracks/p-2.opus",
    title: "Second Wind",
    artist: "Composer Two",
    license: "CC0",
    licenseUrl: "https://example.org/licenses/cc0",
    durationMs: 90_000,
  },
];

const stubPlan: PlaybackPlan = {
  steps: planTracks.map((track) => ({ track, crossfadeMs: 4_000 })),
};

interface ManualScheduler {
  readonly setTimeout: (handler: () => void, ms: number) => number;
  readonly clearTimeout: (handle: number) => void;
  firePending(): void;
}

/**
 * Queues engine timers without firing them, so a test controls exactly when
 * transitions advance (the real scheduler fires on wall-clock time).
 */
function makeManualScheduler(): ManualScheduler {
  const pending: Array<{ handle: number; handler: () => void }> = [];
  let nextHandle = 1;
  return {
    setTimeout(handler, _ms) {
      const handle = nextHandle;
      nextHandle += 1;
      pending.push({ handle, handler });
      return handle;
    },
    clearTimeout(handle) {
      const index = pending.findIndex((t) => t.handle === handle);
      if (index >= 0) {
        pending.splice(index, 1);
      }
    },
    firePending() {
      while (pending.length > 0) {
        const task = pending.shift()!;
        task.handler();
      }
    },
  };
}

function makeProps(overrides: Partial<SelfTrackPlayerProps> = {}): {
  props: SelfTrackPlayerProps;
  deckA: FakeDeck;
  deckB: FakeDeck;
  feedback: Array<{ kind: string; trackId: string; occurredAt: string }>;
} {
  const deckA = new FakeDeck();
  const deckB = new FakeDeck();
  const feedback: Array<{ kind: string; trackId: string; occurredAt: string }> =
    [];
  const props: SelfTrackPlayerProps = {
    planSource: {
      kind: "local-stub",
      load: () => Promise.resolve(stubPlan),
    },
    deckFactory: () => ({ deckA, deckB }),
    scheduler: makeManualScheduler(),
    clock: { now: () => 0 },
    onFeedback: (event) => {
      feedback.push(event);
    },
    ...overrides,
  };
  return { props, deckA, deckB, feedback };
}

describe("SelfTrackPlayer", () => {
  it("renders a title and the stub-plan notice", async () => {
    const { props } = makeProps();
    render(<SelfTrackPlayer {...props} />);
    expect(
      await screen.findByRole("heading", { name: /self-track/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/local plan/i)).toBeInTheDocument();
  });

  it("starts playback from the plan and shows now-playing attribution", async () => {
    const { props, deckA } = makeProps();
    const user = userEvent.setup();
    render(<SelfTrackPlayer {...props} />);

    await user.click(await screen.findByRole("button", { name: /start/i }));
    expect(await screen.findByText("Opening Pulse")).toBeInTheDocument();
    expect(screen.getByText("Composer One")).toBeInTheDocument();
    // Attribution obligations render license name linked to its URL.
    const license = screen.getByRole("link", { name: /CC-BY 4.0/i });
    expect(license).toHaveAttribute(
      "href",
      "https://example.org/licenses/by/4.0",
    );
    expect(deckA.loaded).toEqual(["p-1"]);
  });

  it("skip records feedback with the current track and advances", async () => {
    const scheduler = makeManualScheduler();
    const { props, feedback } = makeProps({ scheduler });
    const user = userEvent.setup();
    render(<SelfTrackPlayer {...props} />);
    await user.click(await screen.findByRole("button", { name: /start/i }));
    await screen.findByText("Opening Pulse");

    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ kind: "skip", trackId: "p-1" });
    expect(typeof feedback[0]?.occurredAt).toBe("string");
    // Advance the engine's pending transition-end timer.
    scheduler.firePending();
    expect(await screen.findByText("Second Wind")).toBeInTheDocument();
  });

  it("stop halts playback and returns to the idle state", async () => {
    const { props } = makeProps();
    const user = userEvent.setup();
    render(<SelfTrackPlayer {...props} />);
    await user.click(await screen.findByRole("button", { name: /start/i }));
    await screen.findByText("Opening Pulse");

    await user.click(screen.getByRole("button", { name: /stop/i }));
    expect(await screen.findByText(/idle/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Mid-playback plan refresh (the 60s event→track-change budget, review B2)
// ---------------------------------------------------------------------------

const bucketTrack = (
  trackId: string,
  title: string,
  bucket: string,
): PlanTrack => ({
  trackId,
  url: `/library/self/${bucket}/${trackId}.opus`,
  title,
  artist: `Artist ${trackId}`,
  license: "CC-BY 4.0",
  licenseUrl: "https://example.org/licenses/by/4.0",
  durationMs: 120_000,
});

const bucketPlan = (bucket: string, firstTitle: string): PlaybackPlan => ({
  steps: [
    {
      track: bucketTrack(`${bucket}-a`, firstTitle, bucket),
      crossfadeMs: 4_000,
    },
    {
      track: bucketTrack(`${bucket}-b`, `${firstTitle} II`, bucket),
      crossfadeMs: 4_000,
    },
  ],
});

/**
 * Fires only timers scheduled for a specific delay, so the refresh ticks
 * (refreshIntervalMs) can be advanced without also firing the engine's own
 * transition timers.
 */
function makeSelectiveScheduler(): {
  readonly scheduler: ManualScheduler;
  readonly fireFor: (ms: number) => void;
  readonly countFor: (ms: number) => number;
} {
  const pending: Array<{ handle: number; handler: () => void; ms: number }> =
    [];
  let nextHandle = 1;
  const scheduler: ManualScheduler = {
    setTimeout(handler, ms) {
      const handle = nextHandle;
      nextHandle += 1;
      pending.push({ handle, handler, ms });
      return handle;
    },
    clearTimeout(handle) {
      const index = pending.findIndex((t) => t.handle === handle);
      if (index >= 0) {
        pending.splice(index, 1);
      }
    },
    firePending() {
      while (pending.length > 0) {
        const task = pending.shift()!;
        task.handler();
      }
    },
  };
  const fireFor = (ms: number): void => {
    for (const task of [...pending.filter((t) => t.ms === ms)]) {
      const index = pending.indexOf(task);
      pending.splice(index, 1);
      task.handler();
    }
  };
  const countFor = (ms: number): number =>
    pending.filter((t) => t.ms === ms).length;
  return { scheduler, fireFor, countFor };
}

const REFRESH_MS = 20_000;

describe("SelfTrackPlayer mid-playback refresh (60s budget)", () => {
  it("reloads the plan on a cadence while playing and restarts when the signature bucket moved", async () => {
    const midPlan = bucketPlan("self_mid_mid", "Mid Layer");
    const slowPlan = bucketPlan("self_slow_mid", "Slow Layer");
    let current = midPlan;
    const planSource = {
      kind: "server-api" as const,
      load: () => Promise.resolve(current),
    };
    const { scheduler, fireFor, countFor } = makeSelectiveScheduler();
    const deckA = new FakeDeck();
    const deckB = new FakeDeck();
    const user = userEvent.setup();
    render(
      <SelfTrackPlayer
        planSource={planSource}
        deckFactory={() => ({ deckA, deckB })}
        scheduler={scheduler}
        clock={{ now: () => 0 }}
        refreshIntervalMs={REFRESH_MS}
      />,
    );

    // No refresh timer before playback starts.
    expect(countFor(REFRESH_MS)).toBe(0);
    await user.click(await screen.findByRole("button", { name: /start/i }));
    expect(await screen.findByText("Mid Layer")).toBeInTheDocument();
    expect(countFor(REFRESH_MS)).toBe(1);

    // The pulse moved to the slow bucket (events landed, server re-rolled
    // the plan): the next refresh tick restarts playback there.
    current = slowPlan;
    fireFor(REFRESH_MS);
    expect(await screen.findByText("Slow Layer")).toBeInTheDocument();
    expect(deckA.loaded[deckA.loaded.length - 1]).toBe("self_slow_mid-a");
  });

  it("never interrupts playback for a same-bucket re-roll", async () => {
    const first = bucketPlan("self_mid_mid", "Stable Layer");
    const reRolled = bucketPlan("self_mid_mid", "Re-rolled Layer");
    let current = first;
    const planSource = {
      kind: "server-api" as const,
      load: () => Promise.resolve(current),
    };
    const { scheduler, fireFor } = makeSelectiveScheduler();
    const deckA = new FakeDeck();
    const deckB = new FakeDeck();
    const user = userEvent.setup();
    render(
      <SelfTrackPlayer
        planSource={planSource}
        deckFactory={() => ({ deckA, deckB })}
        scheduler={scheduler}
        clock={{ now: () => 0 }}
        refreshIntervalMs={REFRESH_MS}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /start/i }));
    expect(await screen.findByText("Stable Layer")).toBeInTheDocument();
    const loadsAfterStart = deckA.loaded.length;

    current = reRolled;
    fireFor(REFRESH_MS);
    await flushAsync();
    expect(screen.getByText("Stable Layer")).toBeInTheDocument();
    expect(screen.queryByText("Re-rolled Layer")).not.toBeInTheDocument();
    expect(deckA.loaded).toHaveLength(loadsAfterStart);
  });

  it("survives a transient refresh failure and stops refreshing after stop", async () => {
    const midPlan = bucketPlan("self_mid_mid", "Keep Layer");
    const slowPlan = bucketPlan("self_slow_mid", "Later Layer");
    let current: PlaybackPlan = midPlan;
    let failNext = false;
    const planSource = {
      kind: "server-api" as const,
      load: (): Promise<PlaybackPlan> =>
        failNext
          ? Promise.reject(new Error("plan unavailable"))
          : Promise.resolve(current),
    };
    const { scheduler, fireFor, countFor } = makeSelectiveScheduler();
    const deckA = new FakeDeck();
    const deckB = new FakeDeck();
    const user = userEvent.setup();
    render(
      <SelfTrackPlayer
        planSource={planSource}
        deckFactory={() => ({ deckA, deckB })}
        scheduler={scheduler}
        clock={{ now: () => 0 }}
        refreshIntervalMs={REFRESH_MS}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /start/i }));
    expect(await screen.findByText("Keep Layer")).toBeInTheDocument();

    // One failed poll: no alert, playback continues, and the loop survives.
    failNext = true;
    current = slowPlan;
    fireFor(REFRESH_MS);
    await waitFor(() => expect(countFor(REFRESH_MS)).toBe(1));
    expect(screen.getByText("Keep Layer")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // The next tick succeeds and the bucket change lands.
    failNext = false;
    fireFor(REFRESH_MS);
    expect(await screen.findByText("Later Layer")).toBeInTheDocument();

    // Stop tears the refresh loop down.
    await user.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() => expect(countFor(REFRESH_MS)).toBe(0));
  });
});

/** Flushes the refresh promise chain (load → then/catch/finally) one round. */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}
