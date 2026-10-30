import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { getStoredToken } from "../auth/auth-store.js";
import { createAuthorizedFetch } from "../auth/authorized-fetch.js";
import {
  CrossfadeEngine,
  type DeckPort,
  type EngineClock,
  type GainParamPort,
  type SchedulerPort,
} from "../player/crossfade-engine.js";
import { createReplayApiClient, ReplayApiError } from "./api-client.js";
import { ReplayPlaybackController } from "./playback.js";
import { createReplayDeckPair } from "./replay-deck.js";
import { ReplayTimeline } from "./ReplayTimeline.js";
import { segmentAt } from "./timeline.js";
import type { JourneyNode, ReplayPlan, ReplayTrack } from "./types.js";

/**
 * Replay surface (v0.7 batch 2): lists the caller's journeys, renders the
 * latest one's replay plan on the timeline strip, and PLAYS it (Round-2
 * defect #2: the page used to draw the timeline with no audio path at
 * all). Playback reuses the existing batch-1 machinery verbatim — the
 * shared crossfade-engine (two decks, equal-power fades) and deck-adapter
 * (real <audio> elements over HTTP Range) — plus a replay-owned seek
 * decorator because replay clips start mid-track. The API lives behind
 * MUSES_V07 && MUSES_V07_REPLAY on the server; when the switches are off
 * the requests fail and the page shows the error state.
 */

type PageState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | {
      readonly status: "ready";
      readonly plan: ReplayPlan;
      readonly tracks: readonly ReplayTrack[];
      readonly nodes: readonly JourneyNode[];
    }
  | { readonly status: "error"; readonly message: string };

const browserScheduler: SchedulerPort = {
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

const browserClock: EngineClock = {
  now: () => performance.now() / 1_000,
};

/** Silent stand-in decks so the engine exists before the Start gesture. */
const createDecklessStub = (): DeckPort => ({
  load: () => {},
  play: () => {},
  pause: () => {},
  gain: {
    setValueAtTime: () => {},
    setValueCurveAtTime: () => {},
    cancelScheduledValues: () => {},
  } satisfies GainParamPort,
});

export default function ReplayPage(): React.JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [positionSec, setPositionSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const engineRef = useRef<CrossfadeEngine | null>(null);
  const controllerRef = useRef<ReplayPlaybackController | null>(null);
  const deckPairRef = useRef<ReturnType<typeof createReplayDeckPair> | null>(
    null,
  );

  useEffect(() => {
    let disposed = false;
    const client = createReplayApiClient({
      baseUrl: "",
      token: getStoredToken() ?? "",
      fetchFn: createAuthorizedFetch(),
    });
    void (async () => {
      try {
        const journeys = await client.listJourneys();
        const latest = journeys[0];
        if (latest === undefined) {
          if (!disposed) {
            setState({ status: "empty" });
          }
          return;
        }
        const journey = await client.getJourney(latest.journeyId);
        let bundle;
        try {
          bundle = await client.getReplay(latest.journeyId);
        } catch {
          bundle = await client.renderReplay(latest.journeyId);
        }
        if (!disposed) {
          setState({
            status: "ready",
            plan: bundle.plan,
            tracks: bundle.tracks,
            nodes: journey.nodes,
          });
          setPositionSec(0);
        }
      } catch (cause: unknown) {
        if (disposed) {
          return;
        }
        setState({
          status: "error",
          message:
            cause instanceof ReplayApiError
              ? cause.message
              : cause instanceof Error
                ? cause.message
                : String(cause),
        });
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const tracksById = useMemo(
    () =>
      new Map(
        (state.status === "ready" ? state.tracks : []).map((track) => [
          track.trackId,
          track,
        ]),
      ),
    [state],
  );

  const ensureController = useCallback((): ReplayPlaybackController => {
    if (controllerRef.current !== null) {
      return controllerRef.current;
    }
    const engine = new CrossfadeEngine({
      deckA: createDecklessStub(),
      deckB: createDecklessStub(),
      scheduler: browserScheduler,
      clock: browserClock,
    });
    engineRef.current = engine;
    engine.subscribe((snapshot) => {
      setPending(snapshot.pending === true);
      setPlaying(
        snapshot.state === "playing" || snapshot.state === "crossfading",
      );
      if (snapshot.error !== undefined) setPlayError(snapshot.error);
    });
    controllerRef.current = new ReplayPlaybackController({
      engine,
      clock: browserClock,
    });
    return controllerRef.current;
  }, []);

  const handleStart = useCallback(() => {
    if (state.status !== "ready") {
      return;
    }
    const controller = ensureController();
    setPlayError(null);
    try {
      if (deckPairRef.current === null) {
        // The AudioContext must be born inside the user gesture (autoplay
        // policy) — same pattern SelfTrackPlayer uses for its decks.
        deckPairRef.current = createReplayDeckPair();
      }
      engineRef.current?.attachDecks(
        deckPairRef.current.deckA,
        deckPairRef.current.deckB,
      );
    } catch (cause: unknown) {
      setPlaying(false);
      setPlayError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    const started = controller.seekTo(state.plan, tracksById, positionSec);
    if (!started) setPlayError(t("replay.empty"));
  }, [ensureController, positionSec, state, t, tracksById]);

  const handleStop = useCallback(() => {
    controllerRef.current?.stop();
    setPlaying(false);
  }, []);

  // Pause on unmount so a route change never leaves decks running.
  useEffect(() => {
    return () => {
      controllerRef.current?.stop();
      deckPairRef.current?.dispose();
    };
  }, []);

  // Playhead follows wall-clock playback (the strip's coordinate system).
  useEffect(() => {
    if (!playing) {
      return;
    }
    const handle = window.setInterval(() => {
      const position = controllerRef.current?.positionSec();
      if (position !== null && position !== undefined) {
        setPositionSec(position);
      }
    }, 500);
    return () => window.clearInterval(handle);
  }, [playing]);

  const handleSeek = useCallback(
    (nextPositionSec: number) => {
      setPositionSec(nextPositionSec);
      if (
        (playing || pending) &&
        state.status === "ready" &&
        controllerRef.current !== null
      ) {
        controllerRef.current.seekTo(state.plan, tracksById, nextPositionSec);
      }
    },
    [playing, pending, state, tracksById],
  );

  const nowPlaying =
    state.status === "ready"
      ? tracksById.get(segmentAt(state.plan, positionSec).trackId)
      : undefined;

  return (
    <main aria-labelledby="replay-heading">
      <h1 id="replay-heading">{t("replay.title")}</h1>
      <p>{t("replay.subtitle")}</p>
      {state.status === "loading" && (
        <p aria-live="polite">{t("replay.loading")}</p>
      )}
      {state.status === "empty" && <p>{t("replay.empty")}</p>}
      {state.status === "error" && (
        <p role="alert">{`${t("replay.error")} ${state.message}`}</p>
      )}
      {state.status === "ready" && (
        <>
          <ReplayTimeline
            plan={state.plan}
            nodes={state.nodes}
            positionSec={positionSec}
            onSeek={handleSeek}
          />
          <p>
            <button
              type="button"
              onClick={handleStart}
              disabled={playing || pending}
            >
              {t("player.control.start")}
            </button>{" "}
            <button
              type="button"
              onClick={handleStop}
              disabled={!playing && !pending}
            >
              {t("player.control.stop")}
            </button>
          </p>
          {playError !== null && <p role="alert">{playError}</p>}
          {nowPlaying !== undefined && (
            <p>
              {`${t("player.nowPlaying.label")}: ${nowPlaying.title} · ${t(
                "player.attribution.label",
              )}: ${nowPlaying.license}`}
            </p>
          )}
        </>
      )}
    </main>
  );
}
