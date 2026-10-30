import { systemClock, type Clock } from "../db/types.js";
import type {
  ContextEventRecord,
  EventStoreListQuery,
} from "../context/model.js";
import { deriveJourneySnapshots } from "./derive.js";
import type { JourneySnapshot, JourneySummary, ReplayPlan } from "./model.js";
import { planReplay, type TrackCatalog } from "./replay-planner.js";
import type { ReplayTrackMeta, TrackMetaResolver } from "./track-meta.js";
import type { SqliteJourneyRepository } from "./sqlite-journey-repository.js";

/**
 * Structural slice of the v0.6 ContextEventStore the journey service reads
 * through — satisfied by SqliteContextEventStore without coupling batch 2
 * to the store implementation (or to batch 1's vibe-signal work).
 */
export interface JourneyEventSource {
  listEvents(
    query: EventStoreListQuery,
  ): Promise<readonly ContextEventRecord[]>;
  /**
   * Optional cheap change probe (index seek on the real store): the user's
   * current MAX(server_sequence). Derivation is a pure function of the
   * events inside the derive window, and the store assigns server_sequence
   * at receipt (append-only), so an unchanged max means the derive output
   * cannot have changed — derive-on-read may skip the full window re-read.
   * Sources without the probe keep the always-derive behavior.
   */
  getMaxServerSequence?(userId: string | null): Promise<number>;
}

export interface JourneyServiceOptions {
  readonly repository: SqliteJourneyRepository;
  readonly eventSource: JourneyEventSource;
  readonly clock?: Clock;
  readonly catalog?: TrackCatalog;
  /** Library metadata lookup for playable track metadata (optional). */
  readonly resolveTracks?: TrackMetaResolver;
  /** How far back derivation reaches (default 7 days). */
  readonly deriveWindowMs?: number;
  readonly deriveEventLimit?: number;
}

const DEFAULT_DERIVE_WINDOW_MS = 7 * 86_400_000;
const DEFAULT_DERIVE_EVENT_LIMIT = 50_000;

/**
 * Journey orchestration: derive-on-read. Listing journeys derives any
 * missing sessions from the user's own event stream (bounded by the derive
 * window) and upserts the derived snapshots — journeys are never computed
 * from another user's events because the store query itself is scoped by
 * the user id (V7 + V10).
 */
export class JourneyService {
  private readonly clock: Clock;
  private readonly deriveWindowMs: number;
  private readonly deriveEventLimit: number;
  /**
   * Per-user MAX(server_sequence) stamp of the last successful derive
   * (R2 CPU budget work, 2026-10-21): a repeat GET /journeys against an
   * unchanged stream skips the full-window re-read+re-hydrate (~0.12s CPU
   * per call on a ~6.7k-event stream). Cleared wholesale at 500 users —
   * a miss only costs one redundant derive, never correctness.
   */
  private readonly derivedThrough = new Map<string, number>();

  public constructor(private readonly options: JourneyServiceOptions) {
    this.clock = options.clock ?? systemClock;
    this.deriveWindowMs = options.deriveWindowMs ?? DEFAULT_DERIVE_WINDOW_MS;
    this.deriveEventLimit =
      options.deriveEventLimit ?? DEFAULT_DERIVE_EVENT_LIMIT;
  }

  public async listJourneys(
    userId: string | null,
  ): Promise<readonly JourneySummary[]> {
    await this.deriveRecent(userId);
    return this.options.repository.listSummaries(userId);
  }

  public getJourney(
    journeyId: string,
    userId: string | null,
  ): JourneySnapshot | null {
    return this.options.repository.getById(journeyId, userId);
  }

  public renderReplay(
    journeyId: string,
    userId: string | null,
  ): ReplayPlan | null {
    const snapshot = this.options.repository.getById(journeyId, userId);
    if (snapshot === null) {
      return null;
    }
    // Re-render = re-roll: the rotation counter is the number of replays
    // already stored for this journey, so the first render keeps the frozen
    // v0 output and every later render rotates with avoidance of the
    // previous pick (same bucket, different track + clip offset).
    const rotation = this.options.repository.countReplays(journeyId, userId);
    const plan = planReplay(snapshot, {
      catalog: this.options.catalog ?? {},
      generatedAt: this.clock.now().toISOString(),
      rotation,
    });
    this.options.repository.saveReplay(plan, userId);
    return plan;
  }

  /**
   * Playable metadata for a plan's tracks (url/attribution/duration).
   * Unresolvable ids (including "unassigned") are absent — the web keeps
   * the timeline but cannot play those segments.
   */
  public trackMetaFor(plan: ReplayPlan): readonly ReplayTrackMeta[] {
    return this.options.resolveTracks === undefined
      ? []
      : this.options.resolveTracks(
          plan.segments.map((segment) => segment.trackId),
        );
  }

  public getLatestReplay(
    journeyId: string,
    userId: string | null,
  ): ReplayPlan | null {
    return this.options.repository.getLatestReplay(journeyId, userId);
  }

  public pruneExpired(): number {
    return this.options.repository.pruneExpired(this.clock.now()).journeys;
  }

  private async deriveRecent(userId: string | null): Promise<void> {
    const cacheKey = userId ?? "\0anonymous";
    const maxSequence =
      await this.options.eventSource.getMaxServerSequence?.(userId);
    if (maxSequence === undefined) {
      await this.deriveWindow(userId);
      return;
    }
    if (this.derivedThrough.get(cacheKey) === maxSequence) {
      return;
    }
    try {
      await this.deriveWindow(userId);
    } catch (error) {
      // A failed derive must not leave a stamp that skips the retry.
      this.derivedThrough.delete(cacheKey);
      throw error;
    }
    if (this.derivedThrough.size > 500) {
      this.derivedThrough.clear();
    }
    this.derivedThrough.set(cacheKey, maxSequence);
  }

  private async deriveWindow(userId: string | null): Promise<void> {
    const now = this.clock.now();
    const events = await this.options.eventSource.listEvents({
      afterSequence: 0,
      asOf: now.toISOString(),
      userId,
      limit: this.deriveEventLimit,
      includeExpired: false,
    });
    const cutoffMs = now.getTime() - this.deriveWindowMs;
    const recent = events.filter(
      (event) => Date.parse(event.occurredAt) >= cutoffMs,
    );
    for (const snapshot of deriveJourneySnapshots(recent, {
      userId,
      now,
    })) {
      this.options.repository.upsertSnapshot(snapshot, userId);
    }
  }
}
