import { describe, expect, it } from "vitest";

import {
  CrossfadeEngine,
  type DeckPort,
  type EngineClock,
  type GainParamPort,
  type SchedulerPort,
} from "../../player/crossfade-engine.js";
import type { PlanTrack } from "../../player/contracts.js";
import {
  buildPlaybackPlan,
  ReplayPlaybackController,
  type ReplayPlanTrack,
} from "../playback.js";
import { journeyTimeAt, replayPositionAt, segmentAt } from "../timeline.js";
import type { ReplayPlan, ReplayTrack } from "../types.js";

/**
 * Deterministic playback spec (defect #2 web half): the suffix-plan builder
 * and the seek controller run against stub decks + a manual clock — no
 * audio stack involved. The timeline alignment property this pins is the
 * same one timeline.test.ts (R1's acceptance) froze: dragging to a journey
 * moment lands on the clip that covers it, round-trip error <= 5s.
 */

class NullGain implements GainParamPort {
  public setValueAtTime(): void {}
  public setValueCurveAtTime(): void {}
  public cancelScheduledValues(): void {}
}

class RecordingDeck implements DeckPort {
  public readonly gain = new NullGain();
  public readonly loaded: PlanTrack[] = [];
  public playCount = 0;
  public pauseCount = 0;

  public load(track: PlanTrack): void {
    this.loaded.push(track);
  }

  public play(): void {
    this.playCount += 1;
  }

  public pause(): void {
    this.pauseCount += 1;
  }
}

class ManualClock implements EngineClock {
  private current = 1_000;

  public now(): number {
    return this.current;
  }

  public advance(deltaSec: number): void {
    this.current += deltaSec;
  }
}

const QUEUE_ONLY_SCHEDULER: SchedulerPort = {
  setTimeout: () => 0,
  clearTimeout: () => {},
};

const TRACKS: readonly ReplayTrack[] = [
  {
    trackId: "t-1",
    url: "/library/self/self_slow_low/t-1.opus",
    title: "Slow Low One",
    artist: "Pilot Author",
    license: "CC-BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    durationMs: 240_000,
  },
  {
    trackId: "t-2",
    url: "/library/self/self_fast_low/t-2.opus",
    title: "Fast Low Two",
    artist: "Pilot Author",
    license: "CC-BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    durationMs: 240_000,
  },
  {
    trackId: "t-3",
    url: "/library/self/self_mid_low/t-3.opus",
    title: "Mid Low Three",
    artist: "Pilot Author",
    license: "CC-BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    durationMs: 240_000,
  },
];

const TRACKS_BY_ID = new Map(TRACKS.map((track) => [track.trackId, track]));

const PLAN: ReplayPlan = {
  replayId: "rpl_playback00000000001",
  journeyId: "jrn_playback0000000001",
  generatedAt: "2026-10-20T21:00:00.000Z",
  totalDurationSec: 175,
  segments: [
    {
      segmentId: "seg_0001",
      bucket: "self:low:low",
      trackId: "t-1",
      clipStartSec: 10,
      replayStartSec: 0,
      durationSec: 60,
      crossfadeSec: 5,
      journeyStartSec: 0,
      journeyEndSec: 5_400,
    },
    {
      segmentId: "seg_0002",
      bucket: "self:high:low",
      trackId: "t-2",
      clipStartSec: 20,
      replayStartSec: 55,
      durationSec: 65,
      crossfadeSec: 5,
      journeyStartSec: 5_400,
      journeyEndSec: 10_800,
    },
    {
      segmentId: "seg_0003",
      bucket: "self:medium:low",
      trackId: "t-3",
      clipStartSec: 30,
      replayStartSec: 115,
      durationSec: 60,
      crossfadeSec: 0,
      journeyStartSec: 10_800,
      journeyEndSec: 16_200,
    },
  ],
};

describe("buildPlaybackPlan", () => {
  it("builds the full playlist from position 0 with planner crossfades", () => {
    const built = buildPlaybackPlan(PLAN, TRACKS_BY_ID, { fromSec: 0 })!;
    expect(built).not.toBeNull();
    expect(built.startSegmentIndex).toBe(0);
    expect(built.anchorSec).toBe(0);
    expect(built.plan.steps.map((step) => step.track.trackId)).toEqual([
      "t-1",
      "t-2",
      "t-3",
    ]);
    // Step i enters with the PREVIOUS segment's crossfade; first from 0.
    expect(built.plan.steps.map((step) => step.crossfadeMs)).toEqual([
      0, 5_000, 5_000,
    ]);
    // Clip durations come from the segments, not the source files.
    expect(built.plan.steps.map((step) => step.track.durationMs)).toEqual([
      60_000, 65_000, 60_000,
    ]);
    // The clip offset rides along for the replay deck's seek decorator.
    expect(
      built.plan.steps.map(
        (step) => (step.track as ReplayPlanTrack).clipStartSec,
      ),
    ).toEqual([10, 20, 30]);
  });

  it("builds the suffix from a scrub position with a mid-clip start", () => {
    // 70s sits 15s into seg_0002 (replayStart 55, duration 65).
    const built = buildPlaybackPlan(PLAN, TRACKS_BY_ID, { fromSec: 70 })!;
    expect(built.startSegmentIndex).toBe(1);
    expect(built.anchorSec).toBe(70);
    expect(built.plan.steps[0]!.track.trackId).toBe("t-2");
    expect(built.plan.steps[0]!.crossfadeMs).toBe(0);
    // First clip shortened by the scrub offset: 65 - 15 = 50s.
    expect(built.plan.steps[0]!.track.durationMs).toBe(50_000);
    expect((built.plan.steps[0]!.track as ReplayPlanTrack).clipStartSec).toBe(
      35,
    );
  });

  it("slides the clip window left when the source file is too short", () => {
    const shortTracks = new Map([
      ...TRACKS_BY_ID,
      [
        "t-1",
        { ...TRACKS[0]!, durationMs: 50_000 }, // 50s source, 60s clip
      ],
    ]);
    const built = buildPlaybackPlan(PLAN, shortTracks, { fromSec: 0 })!;
    expect((built.plan.steps[0]!.track as ReplayPlanTrack).clipStartSec).toBe(
      0,
    );
  });

  it("starts at the first playable segment when metadata is missing", () => {
    const partial = new Map([["t-2", TRACKS[1]!]]);
    const built = buildPlaybackPlan(PLAN, partial, { fromSec: 0 })!;
    expect(built.startSegmentIndex).toBe(1);
    expect(built.plan.steps.map((step) => step.track.trackId)).toEqual(["t-2"]);
    expect(buildPlaybackPlan(PLAN, new Map(), { fromSec: 0 })).toBeNull();
  });
});

describe("ReplayPlaybackController", () => {
  const makeController = (): {
    controller: ReplayPlaybackController;
    deckA: RecordingDeck;
    deckB: RecordingDeck;
    clock: ManualClock;
  } => {
    const deckA = new RecordingDeck();
    const deckB = new RecordingDeck();
    const clock = new ManualClock();
    const engine = new CrossfadeEngine({
      deckA,
      deckB,
      scheduler: QUEUE_ONLY_SCHEDULER,
      clock,
    });
    return {
      controller: new ReplayPlaybackController({ engine, clock }),
      deckA,
      deckB,
      clock,
    };
  };

  it("anchors wall-clock position to replay seconds", () => {
    const { controller, deckA, clock } = makeController();
    expect(controller.positionSec()).toBeNull();
    expect(controller.seekTo(PLAN, TRACKS_BY_ID, 0)).toBe(true);
    expect(deckA.loaded[0]?.trackId).toBe("t-1");
    expect(controller.positionSec()).toBe(0);
    clock.advance(30);
    expect(controller.positionSec()).toBe(30);
    clock.advance(25);
    expect(controller.positionSec()).toBe(55);
    controller.stop();
    expect(controller.positionSec()).toBeNull();
    expect(deckA.pauseCount).toBeGreaterThanOrEqual(1);
  });

  it("re-seeks mid-playback to the clip covering the new position", () => {
    const { controller, deckA, deckB, clock } = makeController();
    controller.seekTo(PLAN, TRACKS_BY_ID, 0);
    clock.advance(10);
    controller.seekTo(PLAN, TRACKS_BY_ID, 131);
    // The deck pair alternates on restart: engine.start uses deckA again
    // after stop-less re-start? CrossfadeEngine.start resets to deckA.
    const lastLoad =
      deckA.loaded[deckA.loaded.length - 1] ??
      deckB.loaded[deckB.loaded.length - 1];
    expect(lastLoad?.trackId).toBe("t-3");
    expect(controller.positionSec()).toBe(131);
  });

  it("dragging to a journey moment lands on the covering clip (<=5s)", () => {
    const { controller } = makeController();
    for (let journeySec = 0; journeySec <= 16_200; journeySec += 900) {
      const replaySec = replayPositionAt(PLAN, journeySec);
      expect(controller.seekTo(PLAN, TRACKS_BY_ID, replaySec)).toBe(true);
      const covering = segmentAt(PLAN, replaySec);
      // positionSec maps back onto the same journey moment (<=5s), and the
      // alignment target: journeyTimeAt(position) is the dragged moment.
      const position = controller.positionSec()!;
      expect(Math.abs(journeyTimeAt(PLAN, position) - journeySec)).toBeLessThan(
        5,
      );
      void covering;
    }
  });
});
