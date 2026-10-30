import type {
  EngineClock,
  CrossfadeEngine,
} from "../player/crossfade-engine.js";
import type { PlaybackPlan, PlanStep, PlanTrack } from "../player/contracts.js";
import { validatePlan } from "../player/plan.js";
import { segmentAt } from "./timeline.js";
import type { ReplayPlan, ReplayTrack } from "./types.js";

/**
 * Replay playback bridge (Round-2 batch-2, defect #2 web half): turns the
 * server's playlist + timestamps (ReplayPlan.segments) into the
 * two-deck PlaybackPlan the shared crossfade-engine plays, and gives the
 * page a controller that anchors wall-clock position to replay seconds so
 * the timeline strip stays aligned with what is audible.
 *
 * The engine/deck pair are the EXISTING src/web/player modules used
 * verbatim: crossfade-engine schedules transitions and equal-power fades;
 * deck-adapter bridges real <audio> elements into Web Audio. The one thing
 * the shared engine cannot do is start a clip mid-track, so replay steps
 * carry the clip offset as a structural extension of PlanTrack
 * (clipStartSec — validatePlan only checks PlanTrack's own fields) and the
 * replay deck decorator (replay-deck.ts) seeks the element on load.
 */

/** PlanTrack plus the offset into the source file where this clip starts. */
export interface ReplayPlanTrack extends PlanTrack {
  readonly clipStartSec: number;
}

export interface BuiltPlayback {
  readonly plan: PlaybackPlan;
  /** Index of the plan segment the playback starts from. */
  readonly startSegmentIndex: number;
  /** Replay position the audio is anchored at when playback begins. */
  readonly anchorSec: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Builds the engine plan for the clips at/after a replay position.
 * Unplayable segments (no metadata — e.g. "unassigned" before the catalog
 * wiring) are skipped honestly: playback starts at the first playable
 * segment at/after the position and runs while metadata holds.
 */
export const buildPlaybackPlan = (
  plan: ReplayPlan,
  tracksById: ReadonlyMap<string, ReplayTrack>,
  options: { readonly fromSec?: number } = {},
): BuiltPlayback | null => {
  const fromSec = clamp(options.fromSec ?? 0, 0, plan.totalDurationSec);
  const covering = segmentAt(plan, fromSec);
  let startIndex = plan.segments.indexOf(covering);
  if (startIndex < 0) {
    return null;
  }
  // First playable segment at/after the covering one.
  while (
    startIndex < plan.segments.length &&
    !tracksById.has(plan.segments[startIndex]!.trackId)
  ) {
    startIndex += 1;
  }
  if (startIndex >= plan.segments.length) {
    return null;
  }

  const steps: PlanStep[] = [];
  const stepDurationsMs: number[] = [];
  const startSegment = plan.segments[startIndex]!;
  // How far into the covering clip the scrub position sits. Kept fractional
  // (deck seeks accept floats) so the anchor equals the dragged position;
  // the first step is shortened by exactly this amount instead of the clip
  // overrunning its schedule slot.
  const intraSec = clamp(
    fromSec - startSegment.replayStartSec,
    0,
    startSegment.durationSec,
  );

  for (let index = startIndex; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index]!;
    const meta = tracksById.get(segment.trackId);
    if (meta === undefined) {
      // Metadata ran out: the plan ends here (no fabricated placeholders).
      break;
    }
    const isFirst = index === startIndex;
    const durationMs = isFirst
      ? Math.max(1_000, Math.round((segment.durationSec - intraSec) * 1_000))
      : segment.durationSec * 1_000;
    // Never run past the end of the source file: slide the clip window
    // left when the source is shorter than offset + clip length.
    const sourceSec = meta.durationMs / 1_000;
    const wantedStart = isFirst
      ? segment.clipStartSec + intraSec
      : segment.clipStartSec;
    const maxStart = Math.max(0, Math.floor(sourceSec - durationMs / 1_000));
    const clipStartSec = clamp(wantedStart, 0, maxStart);
    const track: ReplayPlanTrack = {
      trackId: segment.trackId,
      url: meta.url,
      title: meta.title,
      artist: meta.artist,
      license: meta.license,
      licenseUrl: meta.licenseUrl,
      durationMs,
      clipStartSec,
    };
    const enteringSec = isFirst ? 0 : plan.segments[index - 1]!.crossfadeSec;
    const previousMs =
      stepDurationsMs.length === 0
        ? Number.POSITIVE_INFINITY
        : stepDurationsMs[stepDurationsMs.length - 1]!;
    // Keep every fade shorter than both neighbours with >=1s unfaded audio
    // (validatePlan enforces the strict bound; the first step may have been
    // shrunk by the scrub offset, so re-cap against the actual durations).
    const crossfadeMs = Math.max(
      0,
      Math.min(enteringSec * 1_000, previousMs - 1_000, durationMs - 1_000),
    );
    stepDurationsMs.push(durationMs);
    steps.push({ track, crossfadeMs });
  }
  if (steps.length === 0) {
    return null;
  }
  const playbackPlan = { steps };
  const problems = validatePlan(playbackPlan);
  if (problems.length > 0) {
    throw new Error(`Replay playback plan rejected: ${problems[0]!}`);
  }
  return {
    plan: playbackPlan,
    startSegmentIndex: startIndex,
    anchorSec: startSegment.replayStartSec + intraSec,
  };
};

export interface ReplayPlaybackOptions {
  readonly engine: CrossfadeEngine;
  readonly clock: EngineClock;
}

/**
 * Seek-driven playback: seekTo(positionSec) (re)starts the engine on the
 * suffix plan anchored at that replay position; positionSec() reports where
 * playback stands on the REPLAY timeline (the strip's coordinate system),
 * advancing with the injected clock.
 */
export class ReplayPlaybackController {
  readonly #engine: CrossfadeEngine;
  readonly #clock: EngineClock;
  #anchorSec: number | null = null;
  #anchorClockSec = 0;
  #awaitingStart = false;

  public constructor(options: ReplayPlaybackOptions) {
    this.#engine = options.engine;
    this.#clock = options.clock;
    this.#engine.subscribe((snapshot) => {
      if (
        this.#awaitingStart &&
        snapshot.state === "playing" &&
        !snapshot.pending
      ) {
        this.#anchorClockSec = this.#clock.now();
        this.#awaitingStart = false;
      }
    });
  }

  /** (Re)starts playback at a replay position; false when nothing plays. */
  public seekTo(
    plan: ReplayPlan,
    tracksById: ReadonlyMap<string, ReplayTrack>,
    positionSec: number,
  ): boolean {
    const built = buildPlaybackPlan(plan, tracksById, { fromSec: positionSec });
    if (built === null) {
      this.stop();
      return false;
    }
    this.#anchorSec = built.anchorSec;
    this.#anchorClockSec = this.#clock.now();
    this.#awaitingStart = true;
    this.#engine.start(built.plan);
    return true;
  }

  /** Current replay position, or null while stopped. */
  public positionSec(): number | null {
    if (this.#anchorSec === null) {
      return null;
    }
    const state = this.#engine.getState();
    if (state.state === "idle") {
      return null;
    }
    return this.#anchorSec + (this.#clock.now() - this.#anchorClockSec);
  }

  public stop(): void {
    this.#engine.stop();
    this.#anchorSec = null;
  }
}
