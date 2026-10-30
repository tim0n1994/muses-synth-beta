import type { ContextClock } from "../context/model.js";
import { SYSTEM_CLOCK } from "../context/model.js";
import {
  invalidPulseRequest,
  pulseReplayLimitExceeded,
  pulseStorageFailure,
} from "./errors.js";
import type {
  PulseEventReader,
  PulseProjectionRequest,
  PulseSnapshot,
  PulseSnapshotStore,
} from "./model.js";
import { projectPulse } from "./projector.js";

export interface PulseServiceOptions {
  readonly clock?: ContextClock;
  readonly defaultMaxEvents?: number;
  readonly maximumMaxEvents?: number;
  readonly snapshotStore?: PulseSnapshotStore;
}

const DEFAULT_MAX_EVENTS = 2_000;
const MAXIMUM_MAX_EVENTS = 10_000;

/**
 * Mirrors BeliefService: current() persists the snapshot when a store is
 * configured, replay() never persists; maxEvents bounds the read; storage
 * failures surface as 503 domain errors. One deliberate difference: the
 * cached hot path (PulseRuntimes) calls current() rather than replay() so
 * configured pulse_readings persistence sees cache-miss projections too —
 * belief has no snapshotStore in its production wiring, the pulse has.
 */
export class PulseService {
  private readonly reader: PulseEventReader;
  private readonly clock: ContextClock;
  private readonly defaultMaxEvents: number;
  private readonly maximumMaxEvents: number;
  private readonly snapshotStore: PulseSnapshotStore | undefined;

  public constructor(
    reader: PulseEventReader,
    options: PulseServiceOptions = {},
  ) {
    this.reader = reader;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.defaultMaxEvents = options.defaultMaxEvents ?? DEFAULT_MAX_EVENTS;
    this.maximumMaxEvents = options.maximumMaxEvents ?? MAXIMUM_MAX_EVENTS;
    this.snapshotStore = options.snapshotStore;
  }

  public async current(
    request: Readonly<{ maxEvents?: number }> = {},
  ): Promise<PulseSnapshot> {
    return this.project({ ...request, persist: true });
  }

  public async replay(
    request: PulseProjectionRequest = {},
  ): Promise<PulseSnapshot> {
    return this.project({ ...request, persist: false });
  }

  private async project(
    request: PulseProjectionRequest,
  ): Promise<PulseSnapshot> {
    const asOf = normalizeAsOf(request.asOf, this.clock.now());
    const maxEvents = request.maxEvents ?? this.defaultMaxEvents;
    if (
      !Number.isSafeInteger(maxEvents) ||
      maxEvents <= 0 ||
      maxEvents > this.maximumMaxEvents
    ) {
      throw invalidPulseRequest(
        `maxEvents must be an integer from 1 to ${this.maximumMaxEvents}.`,
      );
    }

    let events;
    try {
      events = await this.reader.readRecentForPulse({
        asOf,
        limit: maxEvents + 1,
      });
    } catch (error: unknown) {
      throw pulseStorageFailure("readRecentForPulse", error);
    }
    if (events.length > maxEvents) {
      throw pulseReplayLimitExceeded(maxEvents);
    }

    const snapshot = projectPulse(events, asOf, { maxEvents });
    if ((request.persist ?? false) && this.snapshotStore !== undefined) {
      try {
        await this.snapshotStore.savePulseSnapshot(snapshot);
      } catch (error: unknown) {
        throw pulseStorageFailure("savePulseSnapshot", error);
      }
    }
    return snapshot;
  }
}

const normalizeAsOf = (input: string | undefined, now: Date): string => {
  if (input === undefined) {
    return now.toISOString();
  }
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds)) {
    throw invalidPulseRequest("asOf must be an RFC3339 timestamp.");
  }
  if (milliseconds > now.getTime() + 5 * 60 * 1_000) {
    throw invalidPulseRequest("asOf is too far in the future.");
  }
  return new Date(milliseconds).toISOString();
};
