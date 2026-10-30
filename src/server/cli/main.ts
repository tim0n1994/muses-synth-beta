import { ArgumentError, parseWatchArgs, USAGE } from "./args.js";
import { BACKFILL_USAGE, runBackfillCommand } from "./backfill.js";
import { startWatching } from "./watch.js";
import { readSessionToken, verifyCollectionAccess } from "./credentials.js";

const TICK_MS = 500;

const COMMANDS_USAGE = `muses — local CLI

Usage:
  muses <command> [options]

Commands:
  watch      Emit local development signals to a running Muses server
  backfill   Attribute legacy NULL-stream rows to a user (v0.6 cutover)

Run muses <command> --help for command details.`;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "help" || command === "--help") {
    log(COMMANDS_USAGE);
    return command === undefined ? 1 : 0;
  }
  if (command !== "watch" && command !== "backfill") {
    process.stderr.write(`Unknown command.\n\n${COMMANDS_USAGE}\n`);
    return 1;
  }
  // `pnpm watch -- --help` lands here as ["watch", "--help"]; asking for help
  // is not an argument error.
  if (rest.includes("--help") || rest.includes("-h")) {
    log(command === "watch" ? USAGE : BACKFILL_USAGE);
    return 0;
  }
  if (command === "backfill") {
    return runBackfillCommand(rest, log);
  }

  let args;
  try {
    args = parseWatchArgs(rest);
  } catch (error: unknown) {
    if (error instanceof ArgumentError) {
      process.stderr.write(`${error.message}\n\n${USAGE}\n`);
      return 1;
    }
    throw error;
  }

  const token = args.tokenStdin ? await readSessionToken() : undefined;
  await verifyCollectionAccess(args.serverUrl, token);
  let finish: (code: number) => void = () => {};
  const finished = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const handle = startWatching({
    ...args,
    tickMs: TICK_MS,
    log,
    ...(token === undefined ? {} : { token }),
    onAuthFailure: () => finish(1),
  });
  const stop = (): void => finish(0);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await finished;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await handle.stop();
  }
}

// Only self-start when executed directly, so tests can import runCli.
if (
  process.argv[1]?.endsWith("main.js") === true ||
  process.argv[1]?.endsWith("main.ts") === true
) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
