import type { SqliteDatabasePort } from "./sqlite-journey-repository.js";

/**
 * Playable track metadata for replay responses (Round-2 batch-2, defect #2
 * server half): the segments reference library track ids, but the web can
 * only play real audio when the response also carries the static library
 * URL and the attribution fields the player's PlanTrack contract requires
 * (title/artist/license/licenseUrl/durationMs — src/web/player/contracts).
 *
 * Read-only over library_tracks (the same columns self-track's plan service
 * selects); url follows the static partition convention
 * `/library/<audio_path>` — audio always flows as static files over HTTP
 * Range, never through this API and never transcoded (V8).
 */

export interface ReplayTrackMeta {
  readonly trackId: string;
  /** Same-origin static path under /library/. */
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly durationMs: number;
}

interface MetaRow {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly license_url: string;
  readonly audio_path: string;
  readonly duration_seconds: number;
}

export type TrackMetaResolver = (
  trackIds: readonly string[],
) => readonly ReplayTrackMeta[];

/**
 * Resolves distinct track ids against the self pool; ids without a library
 * row (including the planner's explicit "unassigned" default) are simply
 * absent from the result — the web keeps the timeline but cannot play that
 * segment, which is the honest degradation.
 */
export const createSqliteTrackMetaResolver = (
  database: SqliteDatabasePort,
): TrackMetaResolver => {
  return (trackIds) => {
    const unique = [...new Set(trackIds)].filter(
      (id) => id !== "unassigned" && id.length > 0,
    );
    if (unique.length === 0) {
      return [];
    }
    const placeholders = unique.map(() => "?").join(", ");
    const rows = database
      .prepare(
        `SELECT id, title, author, license, license_url, audio_path,
                duration_seconds
         FROM library_tracks
         WHERE track_pool = 'self' AND id IN (${placeholders})`,
      )
      .all(...unique) as readonly MetaRow[];
    return rows.map((row) => ({
      trackId: row.id,
      url: `/library/${row.audio_path}`,
      title: row.title,
      artist: row.author,
      license: row.license,
      licenseUrl: row.license_url,
      durationMs: Math.max(1, Math.round(row.duration_seconds * 1_000)),
    }));
  };
};
