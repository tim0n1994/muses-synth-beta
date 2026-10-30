import { randomUUID } from "node:crypto";
import type { WatcherEmission } from "./watcher-state.js";

/**
 * The CloudEvents source every watcher event carries. Ingestion is idempotent
 * by (source, id), so a retried post cannot double-count.
 */
export const WATCH_EVENT_SOURCE = "urn:muses:watch";

export interface CloudEventEnvelope {
  readonly specversion: "1.0";
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly subject: string;
  readonly time: string;
  readonly data: Record<string, string>;
}

export interface EmitterOptions {
  readonly token?: string;
  readonly onAuthFailure?: () => void;
  readonly serverUrl: string;
  readonly subject: string;
  readonly fetchImpl?: typeof fetch;
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onWarning?: (message: string) => void;
  readonly now?: () => Date;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

export function buildEnvelope(
  emission: WatcherEmission,
  sequence: number,
  subject: string,
  occurredAt: Date,
): CloudEventEnvelope {
  const time = occurredAt.toISOString();
  const base = {
    specversion: "1.0" as const,
    // Randomness separates concurrent/restarted watchers, even in one millisecond.
    // The same envelope (and ID) is reused for all delivery attempts.
    id: `watch_${randomUUID()}_${sequence}`,
    source: WATCH_EVENT_SOURCE,
    subject,
    time,
  };
  if (emission.kind === "session") {
    return {
      ...base,
      type: "muses.session.activity",
      data: { status: emission.status },
    };
  }
  return {
    ...base,
    type: "muses.editor.activity",
    data: {
      action: emission.action,
      ...(emission.path === undefined ? {} : { path: emission.path }),
    },
  };
}

/**
 * Posts watcher events to the local ingestion endpoint.
 *
 * A local server that is not running is an ordinary condition, not an error
 * state: posts retry with capped backoff, a give-up is warned about once per
 * event, and nothing is buffered across failures. The watcher keeps running so
 * that starting the server later just works.
 */
export class EventEmitter {
  private sequence = 0;
  private authFailed = false;

  public constructor(private readonly options: EmitterOptions) {}

  public async emit(emission: WatcherEmission): Promise<boolean> {
    if (this.authFailed) return false;
    const now = this.options.now ?? (() => new Date());
    this.sequence += 1;
    const envelope = buildEnvelope(
      emission,
      this.sequence,
      this.options.subject,
      now(),
    );
    return this.post(envelope);
  }

  private async post(envelope: CloudEventEnvelope): Promise<boolean> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const sleep =
      this.options.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, ms);
        }));
    const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const url = `${this.options.serverUrl.replace(/\/$/, "")}/api/v1/context/events`;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            ...(this.options.token === undefined
              ? {}
              : { authorization: `Bearer ${this.options.token}` }),
            "content-type": "application/json",
            // The server validates Origin on browser mutations; a loopback CLI
            // sends the same origin it is posting to.
            origin: this.options.serverUrl,
          },
          body: JSON.stringify(envelope),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        if (response.ok) {
          return true;
        }
        // 4xx means the envelope itself is wrong; retrying cannot help and
        // would hide a contract bug behind three identical failures.
        if (response.status >= 400 && response.status < 500) {
          if (response.status === 401 || response.status === 403) {
            this.authFailed = true;
            this.options.onAuthFailure?.();
          }
          this.warn(
            `Server rejected ${envelope.type} with HTTP ${response.status}; not retrying.`,
          );
          return false;
        }
      } catch {
        // Connection refused: the server is probably not running yet.
      }
      if (attempt < maxAttempts) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    this.warn(
      `Could not deliver ${envelope.type} after ${maxAttempts} attempts; dropped.`,
    );
    return false;
  }

  private warn(message: string): void {
    this.options.onWarning?.(message);
  }
}
