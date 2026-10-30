import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ReplayPage from "../ReplayPage.js";

/**
 * ReplayPage playback (Round-2 batch-2 defect #2): the page drew a timeline
 * but rendered no audio path — nothing could play. Contract: with a replay
 * plan + playable track metadata, Start spins up the two-deck engine (the
 * shared src/web/player deck-adapter + crossfade-engine, real audio
 * elements), the first clip's static library URL lands in the deck, and a
 * timeline drag re-seeks playback to the clip that covers the dragged
 * replay position (the alignment contract timeline.test.ts pins at <=5s).
 *
 * jsdom has no audio stack: AudioContext is stubbed with the port shapes
 * createBrowserDeck needs and HTMLMediaElement.play/pause are spied so the
 * media elements record src/paused without decoding anything.
 */

const JOURNEY_ID = "jrn_replaypage0000000001";

const SEGMENTS = [
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
] as const;

const PLAN = {
  replayId: "rpl_replaypage000000000001",
  journeyId: JOURNEY_ID,
  generatedAt: "2026-10-20T21:00:00.000Z",
  totalDurationSec: 175,
  segments: SEGMENTS,
};

const TRACKS = [
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
] as const;

const SNAPSHOT = {
  journeyId: JOURNEY_ID,
  sessionStartedAt: "2026-10-20T09:00:00.000Z",
  sessionEndedAt: "2026-10-20T13:30:00.000Z",
  durationSec: 16_200,
  eventCount: 120,
  derivedAt: "2026-10-20T13:31:00.000Z",
  retentionDays: 90,
  samples: [],
  nodes: [
    {
      nodeId: "node_flow1",
      type: "flow_entered",
      offsetSec: 5_400,
      evidenceEventIds: ["e-1"],
    },
  ],
} as const;

const SUMMARY = {
  journeyId: JOURNEY_ID,
  sessionStartedAt: SNAPSHOT.sessionStartedAt,
  sessionEndedAt: SNAPSHOT.sessionEndedAt,
  durationSec: SNAPSHOT.durationSec,
  eventCount: SNAPSHOT.eventCount,
  nodeCount: 1,
  retentionDays: 90,
  derivedAt: SNAPSHOT.derivedAt,
} as const;

class FakeAudioParam {
  public setValueAtTime(): void {}
  public setValueCurveAtTime(): void {}
  public cancelScheduledValues(): void {}
}

class FakeAudioNode {
  public readonly gain = new FakeAudioParam();
  public connect(): FakeAudioNode {
    return this;
  }
}

class FakeAudioContext {
  public state = "running";
  public async resume(): Promise<void> {}
  public async close(): Promise<void> {}
  public readonly destination = new FakeAudioNode();
  public createMediaElementSource(): FakeAudioNode {
    return new FakeAudioNode();
  }
  public createGain(): FakeAudioNode {
    return new FakeAudioNode();
  }
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const stubApi = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "/api/v1/journeys") {
        return jsonResponse({ items: [SUMMARY] });
      }
      if (url === `/api/v1/journeys/${JOURNEY_ID}`) {
        return jsonResponse({ journey: SNAPSHOT });
      }
      if (url === `/api/v1/journeys/${JOURNEY_ID}/replay`) {
        return jsonResponse({ replay: PLAN, tracks: TRACKS });
      }
      return jsonResponse({ error: { code: "NOT_FOUND" } });
    }),
  );
};

const audioSources = (): (string | null)[] =>
  [...document.head.querySelectorAll("audio")].map((element) =>
    element.getAttribute("src"),
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReplayPage playback", () => {
  it(
    "starts real deck playback from the playlist and re-seeks on a timeline drag",
    { timeout: 20_000 },
    async () => {
      stubApi();
      vi.stubGlobal("AudioContext", FakeAudioContext);
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockResolvedValue(undefined);
      const pauseSpy = vi
        .spyOn(HTMLMediaElement.prototype, "pause")
        .mockImplementation(() => undefined);

      render(<ReplayPage />);

      // Ready state: the page shows the plan and a Start control that does
      // not exist yet today (defect #2: timeline without any audio path).
      const start = await screen.findByRole("button", { name: "Start" });
      expect(document.head.querySelectorAll("audio").length).toBe(0);

      // Start (the user gesture): the first clip's static library URL is
      // assigned to a real <audio> element via the shared deck adapter.
      fireEvent.click(start);
      await waitFor(() => {
        expect(audioSources().filter((src) => src !== null)).toEqual([
          "/library/self/self_slow_low/t-1.opus",
        ]);
      });
      await waitFor(() => expect(playSpy).toHaveBeenCalled());

      // Timeline drag to 75% of 175s = 131.25s -> segment seg_0003 (the
      // clip covering that replay position), so the deck re-seeks there.
      const timeline = screen.getByRole("slider", { name: "Replay timeline" });
      timeline.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 40,
        width: 200,
        height: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      fireEvent.click(timeline, { clientX: 150 });
      await waitFor(() => {
        expect(audioSources()).toContain("/library/self/self_mid_low/t-3.opus");
      });

      // Stop pauses the decks.
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await waitFor(() => {
        expect(pauseSpy).toHaveBeenCalled();
      });
    },
  );
});
