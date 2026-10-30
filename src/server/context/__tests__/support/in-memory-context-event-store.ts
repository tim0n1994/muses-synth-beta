import type {
  ContextEventAttribution,
  ContextEventCandidate,
  ContextEventCounts,
  ContextEventRecord,
  ContextEventStore,
  ContextEventStoreAppendResult,
  EventStoreListQuery,
} from "../../model.js";

export class InMemoryContextEventStore implements ContextEventStore {
  private readonly events: ContextEventRecord[] = [];
  private readonly identityIndex = new Map<string, ContextEventRecord>();
  private readonly watermarks = new Map<string, string>();
  /** Attribution per stored event, keyed by serverSequence. Null = legacy global stream. */
  private readonly attribution = new Map<number, string | null>();
  private readonly retentionManaged = new Set<number>();
  private nextSequence = 1;

  public async getOrderingWatermark(
    identity: Readonly<{
      source: string;
      subject?: string;
      userId?: string | null;
    }>,
  ): Promise<string | undefined> {
    if (identity.userId === undefined) {
      return this.watermarks.get(
        orderingKey(identity.source, identity.subject),
      );
    }
    let watermark: string | undefined;
    for (const event of this.events) {
      if (
        event.source !== identity.source ||
        event.subject !== identity.subject
      ) {
        continue;
      }
      if (this.attribution.get(event.serverSequence) !== identity.userId) {
        continue;
      }
      if (
        watermark === undefined ||
        Date.parse(event.occurredAt) > Date.parse(watermark)
      ) {
        watermark = event.occurredAt;
      }
    }
    return watermark;
  }

  public async appendEvent(
    candidate: ContextEventCandidate,
    attribution?: ContextEventAttribution,
  ): Promise<ContextEventStoreAppendResult> {
    const key = identityKey(candidate.source, candidate.id);
    const existing = this.identityIndex.get(key);
    if (existing !== undefined) {
      return { event: existing, duplicate: true };
    }

    const event: ContextEventRecord = {
      ...candidate,
      serverSequence: this.nextSequence,
    };
    this.attribution.set(event.serverSequence, attribution?.userId ?? null);
    if (attribution?.retentionManaged === true) {
      this.retentionManaged.add(event.serverSequence);
    }
    this.nextSequence += 1;
    this.events.push(event);
    this.identityIndex.set(key, event);

    const watermarkKey = orderingKey(candidate.source, candidate.subject);
    const current = this.watermarks.get(watermarkKey);
    if (
      current === undefined ||
      Date.parse(candidate.occurredAt) > Date.parse(current)
    ) {
      this.watermarks.set(watermarkKey, candidate.occurredAt);
    }
    return { event, duplicate: false };
  }

  public async listEvents(
    query: EventStoreListQuery,
  ): Promise<readonly ContextEventRecord[]> {
    const asOfMs = Date.parse(query.asOf);
    return this.events
      .filter((event) => event.serverSequence > query.afterSequence)
      .filter(
        (event) => query.source === undefined || event.source === query.source,
      )
      .filter((event) => query.type === undefined || event.type === query.type)
      .filter(
        (event) =>
          query.subject === undefined || event.subject === query.subject,
      )
      .filter(
        (event) =>
          query.userId === undefined ||
          this.attribution.get(event.serverSequence) === query.userId,
      )
      .filter((event) => Date.parse(event.occurredAt) <= asOfMs)
      .filter(
        (event) => query.includeExpired || Date.parse(event.expiresAt) > asOfMs,
      )
      .sort((left, right) =>
        query.order === "desc"
          ? right.serverSequence - left.serverSequence
          : left.serverSequence - right.serverSequence,
      )
      .slice(0, query.limit);
  }

  public async countEvents(
    query: Readonly<{ since: string; until: string; userId?: string | null }>,
  ): Promise<ContextEventCounts> {
    const sinceMs = Date.parse(query.since);
    const untilMs = Date.parse(query.until);
    const inWindow = this.events.filter(
      (event) =>
        Date.parse(event.occurredAt) > sinceMs &&
        Date.parse(event.occurredAt) <= untilMs &&
        Date.parse(event.expiresAt) > untilMs &&
        (query.userId === undefined ||
          this.attribution.get(event.serverSequence) === query.userId),
    );

    const grouped = new Map<
      string,
      { type: string; source: string; count: number }
    >();
    for (const event of inWindow) {
      const key = `${event.type}\u0000${event.source}`;
      const entry = grouped.get(key);
      if (entry === undefined) {
        grouped.set(key, {
          type: event.type,
          source: event.source,
          count: 1,
        });
      } else {
        entry.count += 1;
      }
    }

    const compareText = (left: string, right: string): number =>
      left < right ? -1 : left > right ? 1 : 0;
    const groups = [...grouped.values()]
      .sort(
        (left, right) =>
          right.count - left.count ||
          compareText(left.type, right.type) ||
          compareText(left.source, right.source),
      )
      .slice(0, 50);
    return { total: inWindow.length, groups };
  }

  public async getMaxServerSequence(userId: string | null): Promise<number> {
    let max = 0;
    for (const event of this.events) {
      if (
        event.serverSequence > max &&
        this.attribution.get(event.serverSequence) === userId
      ) {
        max = event.serverSequence;
      }
    }
    return max;
  }

  public async pruneExpired(asOf: string, limit: number): Promise<number> {
    const asOfMs = Date.parse(asOf);
    if (
      !Number.isFinite(asOfMs) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 10_000
    ) {
      throw new Error("Invalid context cleanup bounds.");
    }
    const expired = this.events
      .filter(
        (event) =>
          this.retentionManaged.has(event.serverSequence) &&
          Date.parse(event.expiresAt) <= asOfMs,
      )
      .sort(
        (left, right) =>
          left.expiresAt.localeCompare(right.expiresAt) ||
          left.serverSequence - right.serverSequence,
      )
      .slice(0, limit);
    const expiredKeys = new Set(
      expired.map((event) => identityKey(event.source, event.id)),
    );
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (
        event !== undefined &&
        expiredKeys.has(identityKey(event.source, event.id))
      ) {
        this.events.splice(index, 1);
        this.identityIndex.delete(identityKey(event.source, event.id));
        this.attribution.delete(event.serverSequence);
        this.retentionManaged.delete(event.serverSequence);
      }
    }
    return expired.length;
  }
}

const identityKey = (source: string, id: string): string =>
  `${source}\u0000${id}`;
const orderingKey = (source: string, subject: string | undefined): string =>
  `${source}\u0000${subject ?? ""}`;
