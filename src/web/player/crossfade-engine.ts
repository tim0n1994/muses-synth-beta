import type { PlaybackPlan, PlanTrack } from "./contracts.js";
import { buildEqualPowerCurves } from "./equal-power.js";
import { buildTimeline, validatePlan, type TimelineStep } from "./plan.js";

/** The subset of AudioParam the engine drives. */
export interface GainParamPort {
  setValueAtTime(value: number, startTime: number): void;
  setValueCurveAtTime(
    curve: Float32Array,
    startTime: number,
    duration: number,
  ): void;
  cancelScheduledValues(cancelTime: number): void;
}

/** One playback deck: a media element bridged to Web Audio with a gain node. */
export interface DeckPort {
  /** Assign the static library URL; the element fetches it with Range. */
  load(track: PlanTrack): void;
  play(): void | Promise<void>;
  pause(): void;
  readonly gain: GainParamPort;
}

/** setTimeout-shaped scheduler; tests drive a virtual one. */
export interface SchedulerPort {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/** AudioContext-style monotonic clock in seconds. */
export interface EngineClock {
  now(): number;
}

export type EngineStateName = "idle" | "playing" | "crossfading" | "ended";

export interface EngineSnapshot {
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly state: EngineStateName;
  readonly stepIndex: number;
  readonly nowPlaying: PlanTrack | undefined;
}

export interface CrossfadeEngineOptions {
  readonly deckA: DeckPort;
  readonly deckB: DeckPort;
  readonly scheduler: SchedulerPort;
  readonly clock: EngineClock;
  /** Curve resolution for setValueCurveAtTime (default 128 samples). */
  readonly curveSamples?: number;
}

/**
 * Two-deck crossfade state machine.
 *
 * Timeline guarantees (asserted in crossfade-engine.test.ts):
 * - the incoming deck is started before any gain moves,
 * - both decks get mirrored equal-power curves at the same instant for the
 *   full overlap duration,
 * - the outgoing deck is paused only after the overlap completes,
 * - hard cuts swap decks at full gain with no scheduled curve.
 */
export class CrossfadeEngine {
  private state: EngineStateName = "idle";
  private revision = 0;
  private pending = false;
  private error: string | undefined;
  private stepIndex = 0;
  private nowPlaying: PlanTrack | undefined = undefined;
  private timeline: readonly TimelineStep[] = [];
  private tracks: readonly PlanTrack[] = [];
  private planStartMs = 0;
  private activeDeck: DeckPort | null = null;
  private idleDeck: DeckPort | null = null;
  private timerHandle: number | null = null;
  private readonly listeners = new Set<(snapshot: EngineSnapshot) => void>();
  private readonly curveSamples: number;
  private deckA: DeckPort;
  private deckB: DeckPort;

  public constructor(private readonly options: CrossfadeEngineOptions) {
    this.curveSamples = options.curveSamples ?? 128;
    this.deckA = options.deckA;
    this.deckB = options.deckB;
  }

  /**
   * Swaps the underlying deck pair while the engine is idle. The page builds
   * the engine against silent stubs at mount time and creates the real Web
   * Audio decks inside the start gesture (autoplay policy: the AudioContext
   * must be constructed from a user gesture); this hands the live decks over
   * before the first (or any later) start. Ignored mid-playback — a running
   * session keeps its decks.
   */
  public attachDecks(deckA: DeckPort, deckB: DeckPort): void {
    if (this.state !== "idle") {
      return;
    }
    this.deckA = deckA;
    this.deckB = deckB;
    this.activeDeck = null;
    this.idleDeck = null;
  }

  public subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): EngineSnapshot {
    return {
      pending: this.pending,
      error: this.error,
      state: this.state,
      stepIndex: this.stepIndex,
      nowPlaying: this.nowPlaying,
    };
  }

  public start(plan: PlaybackPlan): void {
    const problems = validatePlan(plan);
    if (problems.length > 0) {
      throw new Error(`Invalid playback plan: ${problems.join("; ")}`);
    }
    if (this.pending || this.state !== "idle") this.stop();
    else this.revision += 1;
    const revision = this.revision;
    this.error = undefined;
    this.pending = true;
    this.notify();
    this.timeline = buildTimeline(plan);
    this.tracks = plan.steps.map((step) => step.track);
    this.planStartMs = this.options.clock.now() * 1000;
    this.activeDeck = this.deckA;
    this.idleDeck = this.deckB;
    const now = this.options.clock.now();
    // Clear stale automation from any previous session. The idle deck gets an
    // explicit 0; the active deck is set by its fade-in curve (or full gain)
    // below - scheduling a setValueAtTime at the same instant a curve starts
    // violates the Web Audio event ordering, so it only gets one event.
    this.deckA.gain.cancelScheduledValues(now);
    this.deckB.gain.cancelScheduledValues(now);
    this.deckB.gain.setValueAtTime(0, now);

    const first = this.tracks[0]!;
    const fadeInMs = plan.steps[0]!.crossfadeMs;
    const active = this.activeDeck;
    active.load(first);
    this.playDeck(active, revision, () => {
      const now = this.options.clock.now();
      if (fadeInMs > 0) {
        const { fadeIn } = buildEqualPowerCurves(this.curveSamples);
        active.gain.setValueCurveAtTime(fadeIn, now, fadeInMs / 1000);
      } else {
        active.gain.setValueAtTime(1, now);
      }
      this.planStartMs = this.options.clock.now() * 1000;
      this.state = "playing";
      this.stepIndex = 0;
      this.nowPlaying = first;
      this.notify();
      this.scheduleNext(0);
    });
  }

  /** Manually advance to the next step using its configured transition. */
  public skip(): void {
    if (
      this.pending ||
      this.state === "crossfading" ||
      this.state === "ended"
    ) {
      return;
    }
    if (this.state === "idle" || this.activeDeck === null) {
      return;
    }
    const nextIndex = this.stepIndex + 1;
    if (nextIndex >= this.timeline.length) {
      this.finishPlan();
      return;
    }
    this.clearTimer();
    this.beginTransition(nextIndex);
  }

  public stop(): void {
    this.revision += 1;
    this.pending = false;
    this.clearTimer();
    for (const deck of [this.deckA, this.deckB]) {
      deck.pause();
      this.silence(deck);
    }
    this.activeDeck = null;
    this.idleDeck = null;
    this.state = "idle";
    this.stepIndex = 0;
    this.nowPlaying = undefined;
    this.notify();
  }

  private scheduleNext(fromStep: number): void {
    const next = this.timeline[fromStep + 1];
    if (next === undefined) {
      const last = this.timeline[fromStep]!;
      const delayMs = Math.max(0, last.endMs - this.elapsedMs());
      this.timerHandle = this.options.scheduler.setTimeout(() => {
        this.timerHandle = null;
        this.finishPlan();
      }, delayMs);
      return;
    }
    const delayMs = Math.max(0, next.startMs - this.elapsedMs());
    this.timerHandle = this.options.scheduler.setTimeout(() => {
      this.timerHandle = null;
      this.beginTransition(next.stepIndex);
    }, delayMs);
  }

  private beginTransition(nextIndex: number): void {
    if (this.state === "idle" || this.state === "ended") {
      return;
    }
    const active = this.activeDeck;
    const idle = this.idleDeck;
    const next = this.timeline[nextIndex];
    if (active === null || idle === null || next === undefined) {
      return;
    }
    const nextTrack = this.trackForStep(nextIndex);
    const revision = this.revision;
    this.pending = true;
    this.notify();

    if (next.overlapMs <= 0) {
      // Hard cut: stop the old deck, start the new one at full gain.
      active.pause();
      this.silence(active);
      idle.load(nextTrack);
      idle.gain.setValueAtTime(1, this.options.clock.now());
      this.playDeck(idle, revision, () => {
        this.swapDecks(idle, active);
        this.state = "playing";
        this.stepIndex = nextIndex;
        this.nowPlaying = nextTrack;
        this.notify();
        this.scheduleNext(nextIndex);
      });
      return;
    }

    // Crossfade. Incoming deck first (no gap), then mirrored equal-power
    // curves over the full overlap, then the outgoing deck pauses.
    idle.load(nextTrack);
    let now = this.options.clock.now();
    idle.gain.cancelScheduledValues(now);
    // No setValueAtTime(0) here: the fadeIn curve's first sample is 0, and a
    // same-instant setValue would collide with the curve interval (spec).
    this.playDeck(idle, revision, () => {
      now = this.options.clock.now();

      const { fadeOut, fadeIn } = buildEqualPowerCurves(this.curveSamples);
      const durationSeconds = next.overlapMs / 1000;
      active.gain.cancelScheduledValues(now);
      active.gain.setValueCurveAtTime(fadeOut, now, durationSeconds);
      idle.gain.setValueCurveAtTime(fadeIn, now, durationSeconds);

      this.state = "crossfading";
      this.stepIndex = nextIndex - 1;
      this.notify();

      this.timerHandle = this.options.scheduler.setTimeout(() => {
        this.timerHandle = null;
        active.pause();
        this.silence(active);
        this.swapDecks(idle, active);
        this.state = "playing";
        this.stepIndex = nextIndex;
        this.nowPlaying = nextTrack;
        this.notify();
        this.scheduleNext(nextIndex);
      }, next.overlapMs);
    });
  }

  private playDeck(deck: DeckPort, revision: number, ready: () => void): void {
    const success = (): void => {
      if (revision !== this.revision) return;
      this.pending = false;
      ready();
    };
    const failure = (cause: unknown): void => {
      if (revision !== this.revision) return;
      this.stop();
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.notify();
    };
    try {
      const result = deck.play();
      if (result === undefined) success();
      else void result.then(success).catch(failure);
    } catch (cause: unknown) {
      failure(cause);
    }
  }

  private finishPlan(): void {
    if (this.state === "idle" || this.state === "ended") {
      return;
    }
    this.clearTimer();
    if (this.activeDeck !== null) {
      this.activeDeck.pause();
      this.silence(this.activeDeck);
    }
    this.state = "ended";
    this.notify();
  }

  private trackForStep(stepIndex: number): PlanTrack {
    const step = this.timeline[stepIndex];
    if (step === undefined) {
      throw new Error(`No timeline step at index ${stepIndex}.`);
    }
    return this.tracks[step.stepIndex]!;
  }

  private swapDecks(newActive: DeckPort, newIdle: DeckPort): void {
    this.activeDeck = newActive;
    this.idleDeck = newIdle;
  }

  private silence(deck: DeckPort): void {
    const now = this.options.clock.now();
    deck.gain.cancelScheduledValues(now);
    deck.gain.setValueAtTime(0, now);
  }

  private elapsedMs(): number {
    return this.options.clock.now() * 1000 - this.planStartMs;
  }

  private clearTimer(): void {
    if (this.timerHandle !== null) {
      this.options.scheduler.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
