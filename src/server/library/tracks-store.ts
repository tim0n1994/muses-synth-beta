import { createHash } from "node:crypto";

import { migration001Initial } from "../db/migrations/001_initial.js";
import { migration002IntegrityTriggers } from "../db/migrations/002_integrity_triggers.js";
import { migration003Auth } from "../db/migrations/003_auth.js";
import { migration004UserAttribution } from "../db/migrations/004_user_attribution.js";
import { migration006LibraryTracks } from "../db/migrations/006_library_tracks.js";
import type { SqliteDatabase } from "../db/types.js";
import {
  rejectionReason,
  validateTrackForIngestion,
  type LibraryTrackCandidate,
  type LicenseGateResult,
} from "./license-gate.js";

/**
 * Library track store (v0.7 batch 1, B path).
 *
 * Owns the `library_tracks` access path: schema bootstrap for pilot
 * databases, gated inserts, and the audit queries used by the pipeline
 * verification step. The server never transcodes audio — rows reference
 * pre-encoded Opus 96 kbps files served as static assets.
 *
 * NOTE on migration wiring: the shared registry (src/server/db/migrations.ts)
 * is owned by the stage-3 integration worker, who wires migration 005 (A
 * path) and 006 into the application list. Until then, pilot databases are
 * bootstrapped by {@link bootstrapPilotLibraryDatabase}, which applies the
 * frozen v0.6 migrations (001–004), any 005 already landed in the tree, and
 * 006, in ascending version order, using the same schema_migrations ledger
 * layout (version, name, sha256-of-sql checksum, applied_at) the real
 * registry reads. Re-running is a no-op for already-applied versions.
 */

interface AppliedRow {
  readonly version: number;
}

function checksumSql(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export interface MigrationLike {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly prepare?: (database: SqliteDatabase) => void;
}

/**
 * All migrations this module statically knows for a pilot library DB.
 * Callers may pass additionally-landed migrations (e.g. A path's 005) via
 * {@link BootstrapOptions.extraMigrations}; everything is applied in
 * ascending version order.
 */
export function pilotMigrations(
  ...extra: readonly MigrationLike[]
): readonly MigrationLike[] {
  return [
    migration001Initial,
    migration002IntegrityTriggers,
    migration003Auth,
    migration004UserAttribution,
    ...extra,
    migration006LibraryTracks,
  ].sort((a, b) => a.version - b.version);
}

export interface BootstrapResult {
  readonly appliedVersions: readonly number[];
  readonly skippedVersions: readonly number[];
}

export interface BootstrapOptions {
  /**
   * Migrations that landed in the tree after this module was written
   * (discovered by the pipeline via fs.existsSync + dynamic import), merged
   * into the version-ordered application list.
   */
  readonly extraMigrations?: readonly MigrationLike[];
}

export function bootstrapPilotLibraryDatabase(
  database: SqliteDatabase,
  options: BootstrapOptions = {},
): BootstrapResult {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set(
    (
      database
        .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
        .all() as readonly AppliedRow[]
    ).map((row) => row.version),
  );

  const appliedNow: number[] = [];
  const skipped: number[] = [];
  for (const migration of pilotMigrations(...(options.extraMigrations ?? []))) {
    if (applied.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }
    const apply = database.transaction(() => {
      migration.prepare?.(database);
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          migration.version,
          migration.name,
          checksumSql(migration.sql),
          new Date().toISOString(),
        );
    });
    apply.immediate();
    appliedNow.push(migration.version);
  }

  return { appliedVersions: appliedNow, skippedVersions: skipped };
}

/**
 * Self-pool catalog for the journey/replay planner (V2 buckets -> track
 * ids). Read-only; returns an empty record when the pilot library has not
 * been ingested into this database, letting the planner fall back to its
 * "unassigned" defaults. Called by the stage-3 wiring only while the
 * batch-2 flags are on, so a flag-off process never touches the table.
 */
export function selfTrackCatalog(
  database: SqliteDatabase,
): Readonly<Record<string, readonly string[]>> {
  const rows = database
    .prepare(
      `SELECT bucket, id FROM library_tracks
       WHERE track_pool = 'self' ORDER BY bucket, id`,
    )
    .all() as readonly { bucket: string; id: string }[];
  const catalog: Record<string, string[]> = {};
  for (const row of rows) {
    (catalog[row.bucket] ??= []).push(row.id);
  }
  return catalog;
}

export type InsertRejectionCode =
  "gate" | "duplicate_source_url" | "duplicate_pool_title_author";

export interface InsertResult extends LicenseGateResult {
  readonly inserted: boolean;
  readonly duplicateOf?: { readonly id: string };
  readonly rejectionCode?: InsertRejectionCode;
}

interface IdRow {
  readonly id: string;
}

const INSERT_SQL = `
  INSERT INTO library_tracks (
    id, track_pool, bucket, title, author, source, source_url, audio_url,
    audio_path, license, license_url, license_evidence_url, snapshot_path,
    snapshot_sha256, content_sha256, duration_seconds, size_bytes,
    bitrate_kbps, mime_type, features_json, bucket_rule_version,
    pro_registered, ingested_at
  ) VALUES (
    @id, @track_pool, @bucket, @title, @author, @source, @source_url, @audio_url,
    @audio_path, @license, @license_url, @license_evidence_url, @snapshot_path,
    @snapshot_sha256, @content_sha256, @duration_seconds, @size_bytes,
    @bitrate_kbps, @mime_type, @features_json, @bucket_rule_version,
    @pro_registered, @ingested_at
  );
`;

/**
 * Gated insert: the license gate runs first (missing field / NC / PRO /
 * malformed evidence are rejected before touching the database), then the
 * UNIQUE constraints on (source_url) and (track_pool, title, author) make
 * duplicate ingestion a hard rejection.
 */
export function insertLibraryTrack(
  database: SqliteDatabase,
  candidate: LibraryTrackCandidate,
  options: { readonly now?: Date } = {},
): InsertResult {
  const gate = validateTrackForIngestion(candidate);
  if (!gate.ok) {
    return { inserted: false, ...gate, rejectionCode: "gate" };
  }

  const existingByUrl = database
    .prepare(`SELECT id FROM library_tracks WHERE source_url = ?`)
    .get(candidate.source_url) as IdRow | undefined;
  if (existingByUrl !== undefined) {
    return {
      inserted: false,
      ok: false,
      rejectionCode: "duplicate_source_url",
      rejection: {
        code: "missing_field",
        field: "source_url",
        reason: `duplicate ingestion rejected: source_url already ingested as track ${existingByUrl.id}`,
      },
    };
  }

  const existingByWork = database
    .prepare(
      `SELECT id FROM library_tracks
       WHERE track_pool = ? AND title = ? AND author = ?`,
    )
    .get(candidate.track_pool, candidate.title, candidate.author) as
    IdRow | undefined;
  if (existingByWork !== undefined) {
    return {
      inserted: false,
      ok: false,
      rejectionCode: "duplicate_pool_title_author",
      rejection: {
        code: "missing_field",
        field: "title",
        reason: `duplicate ingestion rejected: (track_pool, title, author) already ingested as track ${existingByWork.id}`,
      },
    };
  }

  try {
    database.prepare(INSERT_SQL).run({
      id: candidate.id,
      track_pool: candidate.track_pool,
      bucket: candidate.bucket,
      title: candidate.title,
      author: candidate.author,
      source: candidate.source,
      source_url: candidate.source_url,
      audio_url: candidate.audio_url,
      audio_path: candidate.audio_path,
      license: candidate.license,
      license_url: candidate.license_url,
      license_evidence_url: candidate.license_evidence_url,
      snapshot_path: candidate.snapshot_path,
      snapshot_sha256: candidate.snapshot_sha256.toLowerCase(),
      content_sha256: candidate.content_sha256.toLowerCase(),
      duration_seconds: candidate.duration_seconds,
      size_bytes: candidate.size_bytes,
      bitrate_kbps: candidate.bitrate_kbps,
      mime_type: candidate.mime_type,
      features_json: candidate.features_json,
      bucket_rule_version: candidate.bucket_rule_version,
      pro_registered: candidate.pro_registered === true ? 1 : 0,
      ingested_at: (options.now ?? new Date()).toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("UNIQUE constraint failed: library_tracks.source_url")
    ) {
      return {
        inserted: false,
        ok: false,
        rejectionCode: "duplicate_source_url",
        rejection: {
          code: "missing_field",
          field: "source_url",
          reason: "duplicate ingestion rejected: source_url already ingested",
        },
      };
    }
    if (
      message.includes(
        "UNIQUE constraint failed: library_tracks.track_pool, library_tracks.title, library_tracks.author",
      )
    ) {
      return {
        inserted: false,
        ok: false,
        rejectionCode: "duplicate_pool_title_author",
        rejection: {
          code: "missing_field",
          field: "title",
          reason:
            "duplicate ingestion rejected: (track_pool, title, author) already ingested",
        },
      };
    }
    throw error;
  }

  return { inserted: true, ok: true };
}

export function rejectionText(result: InsertResult): string {
  return `${result.rejectionCode ?? "gate"}: ${rejectionReason(result)}`;
}

/** Audit query: per-(pool, bucket) counts, used to prove 9×≥4 + 6×≥4. */
export function bucketCounts(
  database: SqliteDatabase,
): ReadonlyMap<string, number> {
  const rows = database
    .prepare(
      `SELECT track_pool || '/' || bucket AS bucket, COUNT(*) AS count
       FROM library_tracks GROUP BY track_pool, bucket ORDER BY bucket`,
    )
    .all() as readonly { bucket: string; count: number }[];
  return new Map(rows.map((row) => [row.bucket, row.count]));
}

/**
 * Audit query: V2 requires the two pools to be physically disjoint
 * (两轨曲目物理上不重叠). Returns offending source_urls (expect none).
 */
export function poolOverlapSourceUrls(
  database: SqliteDatabase,
): readonly string[] {
  const rows = database
    .prepare(
      `SELECT source_url FROM library_tracks
       WHERE track_pool = 'self'
       INTERSECT
       SELECT source_url FROM library_tracks WHERE track_pool = 'public'`,
    )
    .all() as readonly { source_url: string }[];
  return rows.map((row) => row.source_url);
}
