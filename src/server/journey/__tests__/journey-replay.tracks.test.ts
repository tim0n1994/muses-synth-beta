import { afterEach, describe, expect, it } from "vitest";

import {
  authedHeaders,
  createWorkspace,
  ingestSession,
  registerInWorkspace,
  seedSelfPool,
  type Opened,
} from "./wiring-workspace.js";

/**
 * Replay playback metadata (Round-2 batch-2 defect #2, server half).
 *
 * ReplayPage can only play real audio if the replay response carries, for
 * every segment's trackId, the static library URL and the attribution
 * fields the player's validatePlan requires (title/artist/license/
 * licenseUrl/durationMs — the PlanTrack contract in src/web/player).
 * Contract: POST/GET replay responses carry a `tracks` array with exactly
 * one entry per distinct segment trackId, url shaped
 * /library/self/<library-bucket>/<id>.opus (the static partition the
 * browser consumes over HTTP Range), and durations from the library rows.
 */

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

interface SegmentDto {
  readonly trackId: string;
  readonly bucket: string;
}

interface TrackDto {
  readonly trackId: string;
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly durationMs: number;
}

interface ReplayDto {
  readonly replay: {
    readonly replayId: string;
    readonly segments: readonly SegmentDto[];
  };
  readonly tracks?: readonly TrackDto[];
}

describe("replay response carries playable track metadata", () => {
  it(
    "POST and GET replay include one tracks entry per distinct segment track",
    { timeout: 120_000 },
    async () => {
      const workspace = createWorkspace();
      cleanups.push(() => workspace.destroy());
      const session = await registerInWorkspace(
        workspace,
        "tracks@example.com",
      );
      const seeded = seedSelfPool(workspace.databasePath);

      const opened: Opened = await workspace.open({
        MUSES_V07: "1",
        MUSES_V07_REPLAY: "1",
        MUSES_V07_USERS: session.userId,
      });
      cleanups.push(() => opened.close());
      await ingestSession(opened.app, session.token, "trk");

      const list = await opened.app.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: authedHeaders(session.token),
      });
      expect(list.statusCode).toBe(200);
      const journeyId = list.json<{ items: readonly { journeyId: string }[] }>()
        .items[0]!.journeyId;

      const rendered = await opened.app.inject({
        method: "POST",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(session.token),
        payload: {},
      });
      expect(rendered.statusCode).toBe(201);
      const body = rendered.json<ReplayDto>();
      expect(body.replay.segments.length).toBeGreaterThanOrEqual(1);

      expect(Array.isArray(body.tracks), "replay response has tracks[]").toBe(
        true,
      );
      const tracks = body.tracks ?? [];
      const distinct = [
        ...new Set(body.replay.segments.map((segment) => segment.trackId)),
      ];
      expect(tracks.map((track) => track.trackId).sort()).toEqual(
        [...distinct].sort(),
      );

      // Metadata for a real self pool, never for the "unassigned" default.
      expect(
        body.replay.segments.every((s) => s.trackId !== "unassigned"),
        "catalog wiring must resolve real tracks",
      ).toBe(true);

      const byId = new Map(tracks.map((track) => [track.trackId, track]));
      for (const trackId of distinct) {
        const track = byId.get(trackId);
        expect(track, `tracks entry for ${trackId}`).toBeDefined();
        // Static same-origin partition, bucket directory from the library.
        expect(track!.url).toMatch(
          /^\/library\/self\/self_(slow|mid|fast)_(low|mid|high)\/[A-Za-z0-9._\-/]+$/,
        );
        const bucketInUrl =
          /^\/library\/self\/(self_(?:slow|mid|fast)_(?:low|mid|high))\//.exec(
            track!.url,
          )![1]!;
        expect(seeded[bucketInUrl]).toContain(trackId);
        expect(track!.title.length).toBeGreaterThanOrEqual(1);
        expect(track!.artist).toBe("Pilot Author");
        expect(track!.license).toBe("CC-BY 4.0");
        expect(track!.licenseUrl).toBe(
          "https://creativecommons.org/licenses/by/4.0/",
        );
        expect(track!.durationMs).toBe(240_000);
      }

      // GET serves the same metadata shape.
      const fetched = await opened.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(session.token),
      });
      expect(fetched.statusCode).toBe(200);
      const fetchedBody = fetched.json<ReplayDto>();
      expect(fetchedBody.tracks).toEqual(tracks);
    },
  );
});
