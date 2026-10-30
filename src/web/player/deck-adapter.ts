import type { PlanTrack } from "./contracts.js";
import type { DeckPort } from "./crossfade-engine.js";

/**
 * Browser deck: an <audio> element bridged into Web Audio via
 * createMediaElementSource + GainNode. The element keeps its native streaming
 * behaviour — assigning `src` is what makes the browser issue HTTP Range
 * requests against the static library file, preserving seek and progressive
 * loading. The gain node exists purely for crossfade automation; audio is
 * never decoded into buffers here (see static-only.test.ts).
 */
export function createBrowserDeck(
  context: AudioContext,
  element: HTMLAudioElement,
): DeckPort {
  const source = context.createMediaElementSource(element);
  const gainNode = context.createGain();
  source.connect(gainNode);
  gainNode.connect(context.destination);
  let revision = 0;
  return {
    load(track: PlanTrack): void {
      revision += 1;
      // Static file assignment only: no fetch, no transcode endpoint.
      element.src = track.url;
    },
    async play(): Promise<void> {
      const startedRevision = revision;
      await context.resume();
      if (startedRevision !== revision) {
        throw new Error("Media start was cancelled.");
      }
      if (context.state !== "running") {
        throw new Error("AudioContext did not enter running state.");
      }
      await element.play();
    },
    pause(): void {
      revision += 1;
      element.pause();
    },
    gain: gainNode.gain,
  };
}

/** Creates the two elements and their decks lazily inside a user gesture. */
export function createBrowserDeckPair(): {
  deckA: DeckPort;
  deckB: DeckPort;
  context: AudioContext;
  dispose(): void;
} {
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
    deckA: createBrowserDeck(context, elementA),
    deckB: createBrowserDeck(context, elementB),
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
