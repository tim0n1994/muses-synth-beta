import { openDatabase, runMigrations } from "../db/index.js";
import { ATTRIBUTED_TABLES } from "../db/migrations/004_user_attribution.js";
import type { SqliteDatabase } from "../db/types.js";
import { ArgumentError } from "./args.js";

/**
 * `muses backfill` — the v0.6 cutover tool that attributes legacy NULL-stream
 * rows to a real account.
 *
 * Migration 004 is deliberately additive-only: it adds the nullable `user_id`
 * columns and leaves every pre-v0.6 row NULL, which reads as the legacy
 * global stream. That is correct for auth-disabled local mode, but on an
 * auth-enabled deployment upgraded from v0.5 the NULL stream is invisible to
 * every account — bootstrap, event lists, decisions and effects all read the
 * requesting user's shard only. This tool closes that gap: it assigns the
 * NULL rows of every attributed table to one designated user, chosen by the
 * operator. The legacy stream must be verified as belonging to that account
 * before any attribution is applied.
 *
 * Safety shape:
 *   - default invocation only plans: it prints the per-table NULL counts and
 *     exits 2 asking for `--yes`;
 *   - `--dry-run` prints the same plan and exits 0 without the warning;
 *   - the apply pass runs inside one transaction and verifies that each
 *     table's updated count equals its matched count;
 *   - the target user must already exist in `users` (match by id or email,
 *     case-insensitive) — the tool never creates accounts.
 */

export interface ParsedBackfillArgs {
  readonly databasePath: string;
  readonly userRef: string;
  readonly dryRun: boolean;
  readonly confirmed: boolean;
}

export interface BackfillUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
}

export interface BackfillTableReport {
  readonly table: string;
  /** Legacy NULL-stream rows found in this table. */
  readonly matched: number;
  /** Rows actually re-attributed; 0 unless the apply pass ran. */
  readonly updated: number;
}

export type BackfillOutcome =
  | { readonly status: "unknown-user"; readonly userRef: string }
  | {
      /** Matched counts only, no writes, no confirmation demand. */
      readonly status: "dry-run";
      readonly user: BackfillUser;
      readonly tables: readonly BackfillTableReport[];
    }
  | {
      /** Matched counts only; re-running with --yes will apply them. */
      readonly status: "needs-confirmation";
      readonly user: BackfillUser;
      readonly tables: readonly BackfillTableReport[];
    }
  | {
      /** Rows were re-attributed in one transaction. */
      readonly status: "applied";
      readonly user: BackfillUser;
      readonly tables: readonly BackfillTableReport[];
    };

export const BACKFILL_USAGE = `muses backfill — attribute legacy NULL-stream rows to a user (v0.6 cutover)

Usage:
  muses backfill --db <path> --to-user <email-or-id> [--dry-run | --yes]

Options:
  --db <path>            SQLite database file (required; back it up first)
  --to-user <ref>        Existing account, by email or user id (required)
  --dry-run              Report the per-table NULL counts and exit 0
  --yes                  Actually move the rows (without this, the command
                         only prints the plan and exits 2)

Every pre-v0.6 row lives in the NULL (legacy global) stream, which no
account can read once auth is enabled. This command assigns those rows to
one designated user across all attributed tables, in a single transaction.
Stop the server and back up the database before applying. Legacy migration
requires a separate, reviewed plan; it is outside the public local beta.`;

export function parseBackfillArgs(argv: readonly string[]): ParsedBackfillArgs {
  let databasePath: string | undefined;
  let userRef: string | undefined;
  let dryRun = false;
  let confirmed = false;

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
      case "--":
        break;
      case "--db":
        databasePath = readValue();
        break;
      case "--to-user":
        userRef = readValue();
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--yes":
        confirmed = true;
        break;
      default:
        throw new ArgumentError(`Unknown option ${String(flag)}.`);
    }
  }

  if (databasePath === undefined || databasePath.trim().length === 0) {
    throw new ArgumentError("--db is required.");
  }
  if (userRef === undefined || userRef.trim().length === 0) {
    throw new ArgumentError("--to-user is required.");
  }
  return { databasePath, userRef, dryRun, confirmed };
}

interface CountRow {
  readonly count: number;
}

function tableExists(database: SqliteDatabase, table: string): boolean {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?`,
    )
    .get(table) as CountRow | undefined;
  return row?.count === 1;
}

const countNullRows = (database: SqliteDatabase, table: string): number => {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id IS NULL`)
    .get() as CountRow | undefined;
  return row?.count ?? 0;
};

export function executeBackfill(args: ParsedBackfillArgs): BackfillOutcome {
  const opened = openDatabase(args.databasePath, { fileMustExist: true });
  try {
    const database = opened.connection;
    // Idempotent: a v0.6 server has already applied 004; a v0.5 database
    // gets only the additive nullable columns, which v0.5 code ignores.
    runMigrations(database, { purpose: "application-startup" });

    const user = database
      .prepare(
        `SELECT id, email, role FROM users WHERE id = ? OR LOWER(email) = LOWER(?)`,
      )
      .get(args.userRef, args.userRef) as BackfillUser | undefined;
    if (user === undefined) {
      return { status: "unknown-user", userRef: args.userRef };
    }

    const apply = !args.dryRun && args.confirmed;
    const reports: BackfillTableReport[] = [];

    if (apply) {
      const moveAll = database.transaction((): void => {
        for (const table of ATTRIBUTED_TABLES) {
          // Table names come from the frozen local list, never from input.
          if (!tableExists(database, table)) {
            continue;
          }
          const matched = countNullRows(database, table);
          const updated = database
            .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`)
            .run(user.id).changes;
          if (updated !== matched) {
            throw new Error(
              `Backfill of ${table} moved ${updated} rows but matched ${matched}; transaction rolled back.`,
            );
          }
          reports.push({ table, matched, updated });
        }
      });
      moveAll();
      return { status: "applied", user, tables: reports };
    }

    for (const table of ATTRIBUTED_TABLES) {
      if (!tableExists(database, table)) {
        continue;
      }
      reports.push({
        table,
        matched: countNullRows(database, table),
        updated: 0,
      });
    }
    return {
      status: args.dryRun ? "dry-run" : "needs-confirmation",
      user,
      tables: reports,
    };
  } finally {
    opened.close();
  }
}

/**
 * CLI entry: parses `rest`, executes the backfill, and renders the report.
 * Exit codes: 0 planned/applied cleanly, 1 bad usage or unknown user,
 * 2 plan printed but --yes missing.
 */
export function runBackfillCommand(
  argv: readonly string[],
  log: (message: string) => void,
): number {
  let args: ParsedBackfillArgs;
  try {
    args = parseBackfillArgs(argv);
  } catch (error: unknown) {
    if (error instanceof ArgumentError) {
      process.stderr.write(`${error.message}\n\n${BACKFILL_USAGE}\n`);
      return 1;
    }
    throw error;
  }

  const outcome = executeBackfill(args);
  if (outcome.status === "unknown-user") {
    process.stderr.write(
      `No user in "${args.databasePath}" matches "${outcome.userRef}". The tool never creates accounts; register the user first or pass an existing email/id.\n`,
    );
    return 1;
  }

  const totalMatched = outcome.tables.reduce(
    (sum, report) => sum + report.matched,
    0,
  );
  const totalUpdated = outcome.tables.reduce(
    (sum, report) => sum + report.updated,
    0,
  );
  log(
    `Target user: ${outcome.user.email} (${outcome.user.id}, role ${outcome.user.role})`,
  );
  for (const report of outcome.tables) {
    log(
      `  ${report.table}: ${report.matched} legacy row(s)${
        report.updated > 0 ? ` — moved ${report.updated}` : ""
      }`,
    );
  }

  if (outcome.status === "dry-run") {
    log(
      `Dry run: ${totalMatched} row(s) would be attributed. Nothing was modified.`,
    );
    return 0;
  }
  if (outcome.status === "needs-confirmation") {
    log(
      `${totalMatched} row(s) matched. No rows were modified — re-run with --yes to attribute them to ${outcome.user.email}.`,
    );
    return 2;
  }
  log(`Applied: ${totalUpdated} row(s) now belong to ${outcome.user.email}.`);
  return 0;
}
