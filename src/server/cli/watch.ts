import { watch as fsWatch, type FSWatcher } from "node:fs";
import { basename, relative, resolve } from "node:path";

import { EventEmitter } from "./emitter.js";
import { createIgnoreFilter } from "./ignore.js";
import { WatcherState, type WatcherStateOptions } from "./watcher-state.js";

export interface WatchOptions extends WatcherStateOptions {
  readonly token?: string;
  readonly onAuthFailure?: () => void;
  readonly directory: string;
  readonly serverUrl: string;
  readonly extraIgnored: readonly string[];
  /** How often the state machine is advanced. */
  readonly tickMs: number;
  readonly log: (message: string) => void;
}

export interface WatchHandle {
  stop(): Promise<void>;
}

/**
 * Starts watching a workspace and posting the resulting signals.
 *
 * Everything that decides *whether* to emit lives in `WatcherState`; this
 * function only supplies real filesystem events and a real clock, so the rules
 * stay testable without touching the disk.
 */
export function startWatching(options: WatchOptions): WatchHandle {
  const root = resolve(options.directory);
  const subject = `workspace:${basename(root)}`;
  const shouldIgnore = createIgnoreFilter({
    extraDirectories: options.extraIgnored,
  });
  const state = new WatcherState(options);
  const emitter = new EventEmitter({
    serverUrl: options.serverUrl,
    subject,
    onWarning: options.log,
    ...(options.token === undefined ? {} : { token: options.token }),
    onAuthFailure: () => {
      globalThis.clearInterval(interval);
      watcher.close();
      options.onAuthFailure?.();
    },
  });

  let watcher: FSWatcher;
  try {
    watcher = fsWatch(root, { recursive: true, persistent: true });
  } catch (error: unknown) {
    // Recursive watching is unsupported on some platforms (notably older
    // Linux). Failing loudly beats silently watching only the top directory
    // and reporting no activity forever.
    throw new Error(
      `Cannot watch ${root} recursively on this platform: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  watcher.on("error", (error: Error) => {
    options.log(`Watch error: ${error.message}`);
  });

  watcher.on(
    "change",
    (_eventType: string, filename: string | Buffer | null) => {
      if (filename === null) {
        return;
      }
      const relativePath =
        typeof filename === "string" ? filename : filename.toString("utf8");
      if (shouldIgnore(relative(root, resolve(root, relativePath)))) {
        return;
      }
      state.onChange(relativePath, Date.now());
    },
  );

  let drain: Promise<void> = Promise.resolve();
  let draining = false;
  const interval = globalThis.setInterval(() => {
    // Skip a tick still waiting on the previous drain rather than queueing
    // overlapping posts; the next tick picks up whatever accumulated.
    if (draining) {
      return;
    }
    const emissions = state.tick(Date.now());
    if (emissions.length === 0) {
      return;
    }
    draining = true;
    drain = (async () => {
      try {
        for (const emission of emissions) {
          await emitter.emit(emission);
        }
      } finally {
        draining = false;
      }
    })();
  }, options.tickMs);

  options.log(
    `Watching ${root} -> ${options.serverUrl} (subject ${subject}). Press Ctrl+C to stop.`,
  );

  return {
    stop: async (): Promise<void> => {
      globalThis.clearInterval(interval);
      watcher.close();
      const counters = state.counters();
      options.log(
        `Stopped. ${counters.changesSeen} change(s) seen, ${counters.emitted} event(s) emitted, ${counters.suppressedByRateLimit} suppressed by the rate limit.`,
      );
      await drain;
    },
  };
}
