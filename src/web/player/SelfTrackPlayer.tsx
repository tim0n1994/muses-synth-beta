import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n/index.js";
import type {
  PlaybackPlan,
  PlaybackPlanSource,
  PlanTrack,
} from "./contracts.js";
import {
  CrossfadeEngine,
  type DeckPort,
  type EngineClock,
  type EngineSnapshot,
  type SchedulerPort,
} from "./crossfade-engine.js";
import { createPlayerTranslator } from "./copy.js";
import { createBrowserDeckPair } from "./deck-adapter.js";
import { planSignatureBucket } from "./plan.js";
import { createLocalStubPlanSource } from "./stub-plan.js";

/** Feedback emitted by the player; recorded (never learned from) per V9. */
export interface PlayerFeedbackEvent {
  readonly kind: "skip" | "relisten";
  readonly trackId: string;
  readonly occurredAt: string;
}

export interface SelfTrackPlayerProps {
  readonly planSource?: PlaybackPlanSource;
  readonly deckFactory?: () => { deckA: DeckPort; deckB: DeckPort };
  readonly scheduler?: SchedulerPort;
  readonly clock?: EngineClock;
  readonly onFeedback?: (event: PlayerFeedbackEvent) => void;
  /**
   * Mid-playback plan refresh cadence (default 20s). Together with the
   * server's 5s ingest debounce this keeps the event→track-change latency
   * inside the 60s budget; tests drive it through the injected scheduler.
   */
  readonly refreshIntervalMs?: number;
}

const IDLE_SNAPSHOT: EngineSnapshot = {
  state: "idle",
  stepIndex: 0,
  nowPlaying: undefined,
};

/**
 * Stub pilot tracks until the server plan API lands. URLs point at the
 * static library partition (served by the library module); the plan source
 * is replaced wholesale by the integrator, not these descriptors.
 */
const STUB_TRACKS: readonly PlanTrack[] = [
  {
    trackId: "stub-minimal-electronic-1",
    url: "/library/tracks/stub-minimal-electronic-1.opus",
    title: "Pulse Layer",
    artist: "Open Library pilot",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    durationMs: 180_000,
  },
  {
    trackId: "stub-ambient-1",
    url: "/library/tracks/stub-ambient-1.opus",
    title: "Drift Layer",
    artist: "Open Library pilot",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    durationMs: 210_000,
  },
  {
    trackId: "stub-lofi-jazz-1",
    url: "/library/tracks/stub-lofi-jazz-1.opus",
    title: "Dust Layer",
    artist: "Open Library pilot",
    license: "CC-BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    durationMs: 195_000,
  },
];

/** Module-level default so the stub notice and engine wiring stay stable. */
const DEFAULT_PLAN_SOURCE = createLocalStubPlanSource(STUB_TRACKS);

const browserScheduler: SchedulerPort = {
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

const browserClock: EngineClock = {
  now: () => performance.now() / 1000,
};

function createDecklessStub(): DeckPort {
  return {
    load: () => {},
    play: () => {},
    pause: () => {},
    gain: {
      setValueAtTime: () => {},
      setValueCurveAtTime: () => {},
      cancelScheduledValues: () => {},
    },
  };
}

export function SelfTrackPlayer(
  props: SelfTrackPlayerProps,
): React.JSX.Element {
  const { lang } = useI18n();
  const t = createPlayerTranslator(lang);
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(IDLE_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<CrossfadeEngine | null>(null);
  const startRevision = useRef(0);
  const [loading, setLoading] = useState(false);
  const currentPlanRef = useRef<PlaybackPlan | null>(null);
  const browserPairRef = useRef<ReturnType<
    typeof createBrowserDeckPair
  > | null>(null);

  const planSource = props.planSource ?? DEFAULT_PLAN_SOURCE;
  const scheduler = props.scheduler ?? browserScheduler;
  const clock = props.clock ?? browserClock;
  const deckFactory = props.deckFactory;
  const onFeedback = props.onFeedback;
  const refreshIntervalMs = props.refreshIntervalMs ?? 20_000;

  useEffect(() => {
    // Decks are created inside the start gesture in the browser (autoplay
    // policy); injected factories (tests) are invoked once here. Until decks
    // exist the engine runs against silent stubs.
    let disposed = false;
    const pair = deckFactory?.();
    const engine = new CrossfadeEngine({
      deckA: pair?.deckA ?? createDecklessStub(),
      deckB: pair?.deckB ?? createDecklessStub(),
      scheduler,
      clock,
    });
    engine.subscribe((next) => {
      if (!disposed) {
        setSnapshot(next);
      }
    });
    engineRef.current = engine;
    return () => {
      disposed = true;
      startRevision.current += 1;
      engine.stop();
      const pair = browserPairRef.current;
      pair?.dispose();
      browserPairRef.current = null;
      engineRef.current = null;
    };
  }, [deckFactory, scheduler, clock]);

  const handleStart = useCallback(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    setError(null);
    const revision = ++startRevision.current;
    setLoading(true);
    // Real audio decks are created HERE, inside the start gesture: the
    // AudioContext must be constructed from a user event for the autoplay
    // policy. Until then the engine runs against silent stubs (tests inject
    // their own factories and never hit this branch).
    if (deckFactory === undefined && browserPairRef.current === null) {
      try {
        const pair = createBrowserDeckPair();
        browserPairRef.current = pair;
        engine.attachDecks(pair.deckA, pair.deckB);
      } catch (cause: unknown) {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    }
    planSource
      .load()
      .then((plan) => {
        if (revision !== startRevision.current) return;
        setLoading(false);
        engine.start(plan);
        currentPlanRef.current = plan;
      })
      .catch((cause: unknown) => {
        if (revision !== startRevision.current) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [planSource, deckFactory]);

  const handleStop = useCallback(() => {
    startRevision.current += 1;
    setLoading(false);
    engineRef.current?.stop();
  }, []);

  const handleSkip = useCallback(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    const current = engine.getState().nowPlaying;
    engine.skip();
    if (current !== undefined && onFeedback !== undefined) {
      onFeedback({
        kind: "skip",
        trackId: current.trackId,
        occurredAt: new Date().toISOString(),
      });
    }
  }, [onFeedback]);

  const nowPlaying = snapshot.nowPlaying;
  const stateLabel = t(`player.state.${snapshot.state}` as const);
  const isRunning =
    snapshot.state === "playing" || snapshot.state === "crossfading";
  const busy = loading || snapshot.pending === true;

  // The 60s event→track-change budget's client half (Round-1 review B2):
  // the server invalidates and debounces the pulse within 5s of an ingest,
  // so the plan API reflects a moved signature bucket almost immediately —
  // but nothing used to ask it again once playback had started. While the
  // engine runs, poll the plan source every refreshIntervalMs; when the
  // target BUCKET changed, restart playback with the new plan (equal-power
  // fade-in from the new first track — no gap, no hard cut). A same-bucket
  // seed re-roll never interrupts the music; a failed poll keeps the
  // current plan playing. 20s poll + 5s server debounce lands the change
  // comfortably inside the 60s budget.
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    let stopped = false;
    let handle: number | null = null;
    const tick = (): void => {
      if (stopped) {
        return;
      }
      void planSource
        .load()
        .then((next) => {
          const engine = engineRef.current;
          if (
            stopped ||
            engine === null ||
            engine.getState().state === "idle" ||
            engine.getState().pending
          ) {
            return;
          }
          const currentBucket =
            currentPlanRef.current === null
              ? null
              : planSignatureBucket(currentPlanRef.current);
          const nextBucket = planSignatureBucket(next);
          if (
            currentBucket !== null &&
            nextBucket !== null &&
            nextBucket !== currentBucket
          ) {
            engine.start(next);
            currentPlanRef.current = next;
          }
        })
        .catch(() => {
          // Transient refresh failure: keep playing the current plan and
          // try again on the next tick. Start-button failures stay the only
          // ones surfaced through the alert region.
        })
        .finally(() => {
          if (!stopped) {
            handle = scheduler.setTimeout(tick, refreshIntervalMs);
          }
        });
    };
    handle = scheduler.setTimeout(tick, refreshIntervalMs);
    return () => {
      stopped = true;
      if (handle !== null) {
        scheduler.clearTimeout(handle);
      }
    };
  }, [isRunning, planSource, scheduler, refreshIntervalMs]);

  return (
    <section aria-labelledby="self-track-heading">
      <h1 id="self-track-heading">{t("player.title")}</h1>
      <p>{t("player.subtitle")}</p>
      <p aria-live="polite" data-testid="player-state">
        {stateLabel}
      </p>
      <div>
        <button
          type="button"
          onClick={handleStart}
          disabled={isRunning || busy}
        >
          {t("player.control.start")}
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={
            !busy && (snapshot.state === "idle" || snapshot.state === "ended")
          }
        >
          {t("player.control.stop")}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={!isRunning || busy}
        >
          {t("player.control.skip")}
        </button>
      </div>
      {error !== null && <p role="alert">{error}</p>}
      {snapshot.error !== undefined && <p role="alert">{snapshot.error}</p>}
      {nowPlaying !== undefined && (
        <div>
          <p>
            {t("player.nowPlaying.label")}:{" "}
            <span data-testid="now-playing-title">{nowPlaying.title}</span> —{" "}
            <span>{nowPlaying.artist}</span>
          </p>
          <p>
            {t("player.attribution.label")}:{" "}
            <a
              href={nowPlaying.licenseUrl}
              target="_blank"
              rel="noreferrer license"
            >
              {nowPlaying.license}
            </a>
          </p>
        </div>
      )}
      {planSource.kind === "local-stub" && (
        <p>
          <small>{t("player.plan.localStubNotice")}</small>
        </p>
      )}
    </section>
  );
}
