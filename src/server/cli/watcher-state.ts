/**
 * The watcher's decision logic, with no filesystem and no network.
 *
 * Everything that decides *whether* to emit lives here so it can be tested
 * against an injected clock: debouncing, the per-minute cap, and the session
 * activity transitions. `watch.ts` supplies real `fs.watch` events and posts
 * whatever this returns.
 */

export type EditorAction = "edit" | "save" | "navigate" | "open";
export type SessionStatus = "active" | "idle" | "inactive";

export type WatcherEmission =
  | {
      readonly kind: "editor";
      readonly action: EditorAction;
      readonly path?: string;
    }
  | { readonly kind: "session"; readonly status: SessionStatus };

export interface WatcherStateOptions {
  /** Quiet period after a change burst before one editor event is emitted. */
  readonly debounceMs: number;
  /** No activity for this long moves the session to `idle`. */
  readonly idleAfterMs: number;
  /** No activity for this long moves the session to `inactive`. */
  readonly inactiveAfterMs: number;
  /** Hard ceiling on editor events per rolling minute. */
  readonly maxEventsPerMinute: number;
  /** When true, emissions carry the workspace-relative path that changed. */
  readonly includePaths: boolean;
}

export interface WatcherCounters {
  readonly emitted: number;
  readonly suppressedByRateLimit: number;
  readonly changesSeen: number;
}

const MINUTE_MS = 60_000;

export class WatcherState {
  private pendingPath: string | null = null;
  private pendingSinceMs = 0;
  private lastActivityMs: number | null = null;
  private sessionStatus: SessionStatus | null = null;
  private readonly emissionTimestamps: number[] = [];
  private emitted = 0;
  private suppressedByRateLimit = 0;
  private changesSeen = 0;

  public constructor(private readonly options: WatcherStateOptions) {
    if (options.debounceMs < 0 || options.maxEventsPerMinute < 1) {
      throw new RangeError(
        "debounceMs must be non-negative and maxEventsPerMinute at least 1.",
      );
    }
  }

  public counters(): WatcherCounters {
    return {
      emitted: this.emitted,
      suppressedByRateLimit: this.suppressedByRateLimit,
      changesSeen: this.changesSeen,
    };
  }

  /**
   * Records a filesystem change. Nothing is emitted here — a burst of a
   * thousand changes from a `git checkout` collapses into the single pending
   * entry that `tick` later turns into one event.
   */
  public onChange(path: string, nowMs: number): void {
    this.changesSeen += 1;
    if (this.pendingPath === null) {
      this.pendingSinceMs = nowMs;
    }
    this.pendingPath = path;
  }

  /**
   * Advances the clock and returns the events to post, in order. Session
   * transitions come first so a "back at the keyboard" signal never arrives
   * after the edit that caused it.
   */
  public tick(nowMs: number): readonly WatcherEmission[] {
    const emissions: WatcherEmission[] = [];

    const editor = this.drainPending(nowMs);
    if (editor !== null) {
      const activation = this.setSession("active");
      if (activation !== null) {
        emissions.push(activation);
      }
      emissions.push(editor);
      this.lastActivityMs = nowMs;
    }

    const decayed = this.decaySession(nowMs);
    if (decayed !== null) {
      emissions.push(decayed);
    }

    return emissions;
  }

  private drainPending(nowMs: number): WatcherEmission | null {
    if (
      this.pendingPath === null ||
      nowMs - this.pendingSinceMs < this.options.debounceMs
    ) {
      return null;
    }
    const path = this.pendingPath;
    this.pendingPath = null;

    if (!this.admitToRateLimit(nowMs)) {
      // Counted, not silent: a suppressed burst still shows up in the summary
      // the CLI prints, so a user never mistakes a rate limit for inactivity.
      this.suppressedByRateLimit += 1;
      return null;
    }

    this.emitted += 1;
    return {
      kind: "editor",
      // `save` is what the projector's editing rule counts. The watcher cannot
      // distinguish a save from an editor-side edit, and claiming the finer
      // signal would be inventing evidence.
      action: "save",
      ...(this.options.includePaths ? { path } : {}),
    };
  }

  private admitToRateLimit(nowMs: number): boolean {
    const cutoff = nowMs - MINUTE_MS;
    while (
      this.emissionTimestamps.length > 0 &&
      (this.emissionTimestamps[0] ?? 0) <= cutoff
    ) {
      this.emissionTimestamps.shift();
    }
    if (this.emissionTimestamps.length >= this.options.maxEventsPerMinute) {
      return false;
    }
    this.emissionTimestamps.push(nowMs);
    return true;
  }

  private decaySession(nowMs: number): WatcherEmission | null {
    if (this.lastActivityMs === null) {
      return null;
    }
    const quietMs = nowMs - this.lastActivityMs;
    if (quietMs >= this.options.inactiveAfterMs) {
      return this.setSession("inactive");
    }
    if (quietMs >= this.options.idleAfterMs) {
      return this.setSession("idle");
    }
    return null;
  }

  /** Emits only on transition; the projector reads the latest session event. */
  private setSession(status: SessionStatus): WatcherEmission | null {
    if (this.sessionStatus === status) {
      return null;
    }
    this.sessionStatus = status;
    return { kind: "session", status };
  }
}
