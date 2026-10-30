import type { SqliteDatabase } from "../db/types.js";
import type { PulseSnapshot } from "../vibe-signal/model.js";
import {
  DEFAULT_PLAN_BUCKET,
  buildPlaybackPlan,
  crossfadeMsOf,
  planSeedFor,
  resolveTargetBucket,
  type LibraryTrackRow,
  type PlaybackPlanDto,
} from "./plan.js";

/**
 * Thrown when the self pool of library_tracks has no rows at all: the pilot
 * library has not been ingested into this database (B path ingest step).
 * Maps to 503 SELF_TRACK_LIBRARY_EMPTY — an availability state, not a client
 * or server fault.
 */
export class SelfTrackLibraryEmptyError extends Error {
  public constructor() {
    super("The pilot library has not been ingested into this database.");
    this.name = "SelfTrackLibraryEmptyError";
  }
}

/** Minimal pulse surface the planner needs (satisfied by PulseRuntimes). */
export interface PulseAccess {
  current(): Promise<PulseSnapshot>;
}

export interface SelfTrackPlanServiceOptions {
  readonly database: SqliteDatabase;
  /**
   * Per-user pulse view; null when the vibe-signal module is somehow absent
   * (both are keyed on the same MUSES_V07 switch, so this is defensive) —
   * planning then falls back to the V9 default bucket.
   */
  readonly pulseFor?: ((userId: string | null) => PulseAccess | null) | null;
  /** How many steps ahead the plan covers (default 3). */
  readonly stepCount?: number;
}

interface RowShape {
  readonly id: string;
  readonly bucket: string;
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly audioPath: string;
  readonly durationSeconds: number;
}

const SELECT_COLUMNS = `
  SELECT id, bucket, title, author, license,
         license_url AS licenseUrl, audio_path AS audioPath,
         duration_seconds AS durationSeconds
  FROM library_tracks
`;

const byBucket = (
  database: SqliteDatabase,
  bucket: string,
): readonly LibraryTrackRow[] =>
  database
    .prepare(
      `${SELECT_COLUMNS} WHERE track_pool = 'self' AND bucket = ? ORDER BY id`,
    )
    .all(bucket) as readonly RowShape[];

const anySelfTrack = (database: SqliteDatabase): readonly LibraryTrackRow[] =>
  database
    .prepare(`${SELECT_COLUMNS} WHERE track_pool = 'self' ORDER BY bucket, id`)
    .all() as readonly RowShape[];

/**
 * What the service last handed a user: the seed the plan was rolled with,
 * the track that roll was told to avoid, and the track it opened on. Enough
 * to keep reads repeatable for an unchanged pulse and to make a moved pulse
 * open on a different track than the last plan did (see buildPlaybackPlan).
 */
interface ServedPlan {
  readonly seed: number;
  readonly avoidTrackId: string | undefined;
  readonly firstTrackId: string;
}

/** LRU cap on remembered users — the same bound PerUserRuntimes uses. */
const MAX_SERVED_USERS = 200;

/**
 * Builds the "next / when / how" playback plan for one user: read the pulse,
 * map it to a signature bucket, rotate deterministically inside the bucket.
 * All queries hit the same SQLite file the rest of the app uses; the p95
 * budget (<100ms) is dominated by the pulse projection cache hit.
 */
export class SelfTrackPlanService {
  readonly #database: SqliteDatabase;
  readonly #pulseFor: (userId: string | null) => PulseAccess | null;
  readonly #stepCount: number;
  readonly #served = new Map<string | null, ServedPlan>();

  public constructor(options: SelfTrackPlanServiceOptions) {
    this.#database = options.database;
    this.#pulseFor = options.pulseFor ?? (() => null);
    this.#stepCount = options.stepCount ?? 3;
  }

  public async planFor(userId: string | null): Promise<PlaybackPlanDto> {
    const access = this.#pulseFor(userId);
    const snapshot = access === null ? null : await access.current();
    const modulation = snapshot?.emotion.transitionModulation;
    const bucket = resolveTargetBucket(
      snapshot?.rhythm.value ?? "UNKNOWN",
      snapshot?.intensity.value ?? "UNKNOWN",
      modulation?.energyBias ?? 0,
    );

    let rows = byBucket(this.#database, bucket);
    if (rows.length === 0 && bucket !== DEFAULT_PLAN_BUCKET) {
      rows = byBucket(this.#database, DEFAULT_PLAN_BUCKET);
    }
    if (rows.length === 0) {
      rows = anySelfTrack(this.#database);
    }
    if (rows.length === 0) {
      throw new SelfTrackLibraryEmptyError();
    }

    // Rotation avoidance (R2): an unchanged pulse re-reads the exact plan it
    // got before (same seed, same avoidance); a moved pulse re-rolls and must
    // not open on the track the previous plan opened on.
    const seed = planSeedFor(userId, snapshot);
    const previous = this.#served.get(userId);
    const avoidTrackId =
      previous === undefined
        ? undefined
        : previous.seed === seed
          ? previous.avoidTrackId
          : previous.firstTrackId;
    const plan = buildPlaybackPlan(
      rows,
      seed,
      this.#stepCount,
      crossfadeMsOf(snapshot),
      avoidTrackId,
    );
    const firstTrackId = plan.steps[0]?.track.trackId;
    if (firstTrackId !== undefined) {
      this.#remember(userId, { seed, avoidTrackId, firstTrackId });
    }
    return plan;
  }

  #remember(userId: string | null, served: ServedPlan): void {
    // Re-insert so Map iteration order doubles as the LRU order.
    this.#served.delete(userId);
    this.#served.set(userId, served);
    while (this.#served.size > MAX_SERVED_USERS) {
      const oldest = this.#served.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.#served.delete(oldest.value);
    }
  }
}
