import type { DeckPort } from "../player/crossfade-engine.js";
import { createBrowserDeck } from "../player/deck-adapter.js";
import type { ReplayPlanTrack } from "./playback.js";

/**
 * Replay decks (defect #2 web half): the shared deck-adapter bridges an
 * <audio> element into Web Audio but loads whole tracks from 0 — replay
 * clips start at an offset into the source file. This decorator owns the
 * element the shared adapter bridges and seeks it whenever a clip is
 * loaded: the offset travels on the track object as the structural
 * ReplayPlanTrack extension (validatePlan only checks PlanTrack's own
 * fields), so the shared engine and adapter stay untouched.
 */

export const withClipSeek = (
  deck: DeckPort,
  element: HTMLAudioElement,
): DeckPort => {
  let pendingSeekSec = 0;
  const applySeek = (): void => {
    if (pendingSeekSec > 0 && element.readyState >= 1) {
      try {
        element.currentTime = pendingSeekSec;
      } catch {
        // Not seekable yet (no metadata); the listener below retries.
      }
    }
  };
  element.addEventListener("loadedmetadata", applySeek);
  return {
    load(track) {
      pendingSeekSec = (track as Partial<ReplayPlanTrack>).clipStartSec ?? 0;
      deck.load(track);
      applySeek();
    },
    play() {
      return deck.play();
    },
    pause() {
      deck.pause();
    },
    gain: deck.gain,
  };
};

export interface ReplayDeckPair {
  readonly deckA: DeckPort;
  readonly deckB: DeckPort;
  readonly context: AudioContext;
  dispose(): void;
}

/**
 * The two real media elements + decks, created inside the Start gesture
 * (autoplay policy: the AudioContext must be constructed from a user
 * gesture — same pattern SelfTrackPlayer uses). Elements live in
 * document.head for the page's lifetime.
 */
export function createReplayDeckPair(): ReplayDeckPair {
  const Constructor = globalThis.AudioContext;
  if (Constructor === undefined) {
    throw new Error("Web Audio API is unavailable in this browser.");
  }
  const context = new Constructor({ latencyHint: "interactive" });
  const elementA = document.createElement("audio");
  const elementB = document.createElement("audio");
  for (const element of [elementA, elementB]) {
    element.preload = "auto";
    document.head.append(element);
  }
  return {
    deckA: withClipSeek(createBrowserDeck(context, elementA), elementA),
    deckB: withClipSeek(createBrowserDeck(context, elementB), elementB),
    context,
    dispose() {
      for (const element of [elementA, elementB]) {
        element.pause();
        element.remove();
      }
      void context.close();
    },
  };
}
