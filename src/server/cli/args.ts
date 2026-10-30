/**
 * Argument parsing for the Muses CLI. Kept separate from the watcher so the
 * defaults and the loopback guard are unit-testable without starting anything.
 */

export interface ParsedWatchArgs {
  readonly tokenStdin: boolean;
  readonly directory: string;
  readonly serverUrl: string;
  readonly debounceMs: number;
  readonly idleAfterMs: number;
  readonly inactiveAfterMs: number;
  readonly maxEventsPerMinute: number;
  readonly includePaths: boolean;
  readonly extraIgnored: readonly string[];
}

export const DEFAULT_WATCH_ARGS: ParsedWatchArgs = {
  tokenStdin: false,
  directory: ".",
  serverUrl: "http://127.0.0.1:3001",
  debounceMs: 2_000,
  idleAfterMs: 5 * 60_000,
  inactiveAfterMs: 15 * 60_000,
  maxEventsPerMinute: 30,
  includePaths: false,
  extraIgnored: [],
};

export class ArgumentError extends Error {}

/** Accepts `500`, `30s`, `5m`, `1h`. Bare numbers are milliseconds. */
export function parseDuration(value: string, label: string): number {
  const match = /^(\d+)(ms|s|m|h)?$/u.exec(value.trim());
  if (match === null) {
    throw new ArgumentError(
      `${label} must be a duration like 500, 30s, 5m, or 1h.`,
    );
  }
  const amount = Number(match[1]);
  switch (match[2]) {
    case "h":
      return amount * 3_600_000;
    case "m":
      return amount * 60_000;
    case "s":
      return amount * 1_000;
    default:
      return amount;
  }
}

/**
 * Muses is local-first. Posting a stream of
 * developer activity to a non-loopback host is exactly the mistake the
 * product's boundaries forbid, so it takes a deliberate flag.
 */
export function assertLoopback(serverUrl: string, allowRemote: boolean): void {
  let host: string;
  try {
    const url = new URL(serverUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error("Expected a plain HTTP(S) origin");
    }
    host = url.hostname;
  } catch {
    throw new ArgumentError(
      "--server must be an HTTP(S) origin without credentials, path, query or fragment.",
    );
  }
  const loopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";
  if (!loopback && !allowRemote) {
    throw new ArgumentError(
      "--server is not loopback; pass --allow-remote only for intentional remote collection.",
    );
  }
}

export function parseWatchArgs(argv: readonly string[]): ParsedWatchArgs {
  let args: ParsedWatchArgs = DEFAULT_WATCH_ARGS;
  const extraIgnored: string[] = [];
  let allowRemote = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new ArgumentError(`${String(flag)} requires a value.`);
      }
      index += 1;
      return value;
    };

    switch (flag) {
      case "--token-stdin":
        args = { ...args, tokenStdin: true };
        break;
      // npm/pnpm pass a bare `--` through when forwarding flags to a script.
      case "--":
        break;
      case "--dir":
        args = { ...args, directory: readValue() };
        break;
      case "--server":
        args = { ...args, serverUrl: readValue() };
        break;
      case "--debounce":
        args = {
          ...args,
          debounceMs: parseDuration(readValue(), "--debounce"),
        };
        break;
      case "--idle-after":
        args = {
          ...args,
          idleAfterMs: parseDuration(readValue(), "--idle-after"),
        };
        break;
      case "--inactive-after":
        args = {
          ...args,
          inactiveAfterMs: parseDuration(readValue(), "--inactive-after"),
        };
        break;
      case "--max-events-per-minute": {
        const value = Number(readValue());
        if (!Number.isInteger(value) || value < 1) {
          throw new ArgumentError(
            "--max-events-per-minute must be an integer of at least 1.",
          );
        }
        args = { ...args, maxEventsPerMinute: value };
        break;
      }
      case "--include-paths":
        args = { ...args, includePaths: true };
        break;
      case "--ignore":
        extraIgnored.push(readValue());
        break;
      case "--allow-remote":
        allowRemote = true;
        break;
      default:
        throw new ArgumentError(
          "Unknown watch option (values are not echoed).",
        );
    }
  }

  if (args.inactiveAfterMs <= args.idleAfterMs) {
    throw new ArgumentError(
      "--inactive-after must be longer than --idle-after.",
    );
  }
  assertLoopback(args.serverUrl, allowRemote);
  if (args.tokenStdin) {
    // Beta credentials must never leave the local machine, even with --allow-remote.
    assertLoopback(args.serverUrl, false);
  }
  return { ...args, serverUrl: new URL(args.serverUrl).origin, extraIgnored };
}

export const USAGE = `muses watch — emit local development signals to a running Muses server

Usage:
  muses watch [options]

Options:
  --dir <path>                  Directory to watch (default: .)
  --server <url>                Muses server URL (default: http://127.0.0.1:3001)
  --debounce <duration>         Quiet period before one event is sent (default: 2s)
  --idle-after <duration>       Quiet time before the session goes idle (default: 5m)
  --inactive-after <duration>   Quiet time before the session goes inactive (default: 15m)
  --max-events-per-minute <n>   Hard ceiling on editor events (default: 30)
  --include-paths               Include the changed file's relative path in the event
  --ignore <name>               Extra directory name to ignore (repeatable)
  --allow-remote                Permit an anonymous non-loopback --server
  --token-stdin                 Read a session Bearer token from a pipe (loopback only)

Durations accept 500, 30s, 5m, or 1h. No file contents are ever read, and no
relative paths are sent unless --include-paths is passed. The subject includes
the watched directory basename. --dir replaces the default current directory.

Auth-on: pipe an existing account session token from a trusted credential manager
to pnpm watch -- --token-stdin. Never put a token or password in arguments or
shell history. stdin must close after the token (one line, at most 8192 bytes).
The token stays in memory; no login, refresh, token file or config is written.
It carries the account's existing permissions, not a collector-only scope.
Use a dedicated local account; on expiry/revocation (401/403), collection stops.
Without --token-stdin, only a server accepting anonymous access can be watched.
Start the server first: collection access must pass a 5s startup check.
Posts retry transient failures at most 3 times (5s per request, capped backoff);
failed events are dropped, with no persistent queue or automatic re-login.`;
