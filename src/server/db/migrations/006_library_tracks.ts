/**
 * Migration 006 — Open Library pilot track table (v0.7 batch 1, B path).
 *
 * One physical table serves both track pools (V2: 一个曲库，两个互斥的分区).
 * `track_pool` is part of the access key, and mutual exclusion between the
 * self and public pools is enforced at the row level:
 *
 *   - `UNIQUE (source_url)` — the same upstream work can never be ingested
 *     twice, in the same pool or across pools (两轨曲目物理上不重叠).
 *   - `UNIQUE (track_pool, title, author)` — a re-ingest of the same work
 *     under a different source_url but identical pool/title/author is also
 *     rejected (duplicate protection within a pool).
 *
 * License gate columns (V5: 曲库来源只收 CC0 和 CC-BY):
 *   - `license` / `license_url` / `author` / `source_url` are NOT NULL —
 *     the four mandatory license fields; missing any one rejects the row
 *     before it reaches this table (see src/server/library/license-gate.ts;
 *     the DB constraints are the second line of defense).
 *   - CHECKs reject NC/ND/SA-style license names outright and require the
 *     license_url host to be creativecommons.org.
 *   - `pro_registered` — V5: 凡是标注了 PRO 注册的曲目，一律不进公开轨。
 *     The gate rejects PRO-marked tracks for the public pool; the column
 *     keeps the flag auditable for every row.
 *
 * Forensics (取证快照): every row carries the sha256 of the license-evidence
 * snapshot archived next to the library database, plus the URL the snapshot
 * was captured from. `snapshot_path` is relative to the snapshot directory
 * beside the DB file so the database directory is self-contained and
 * portable.
 *
 * Audio: files are pre-encoded Opus 96 kbps on the ingestion Mac (V6) and
 * served as static files over HTTP Range — the server never transcodes.
 * `content_sha256` pins the exact bytes; `bitrate_kbps`/`mime_type` record
 * the encoding contract for audits.
 *
 * `features_json` holds the librosa labeling output (BPM/RMS/spectral) and
 * `bucket_rule_version` names the bucket-mapping rule revision that assigned
 * `bucket`, so a later rule change can be re-derived deterministically.
 */
export const migration006LibraryTracks = {
  version: 6,
  name: "library_tracks",
  sql: `
    CREATE TABLE library_tracks (
      id TEXT PRIMARY KEY,
      track_pool TEXT NOT NULL CHECK (track_pool IN ('self', 'public')),
      bucket TEXT NOT NULL CHECK (
        bucket IN (
          'self_slow_low', 'self_slow_mid', 'self_slow_high',
          'self_mid_low', 'self_mid_mid', 'self_mid_high',
          'self_fast_low', 'self_fast_mid', 'self_fast_high',
          'public_warmup_low', 'public_warmup_high',
          'public_focus_low', 'public_focus_high',
          'public_deepwork_low', 'public_deepwork_high'
        )
      ),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      author TEXT NOT NULL CHECK (length(trim(author)) > 0),
      source TEXT NOT NULL CHECK (length(trim(source)) > 0),
      source_url TEXT NOT NULL CHECK (length(trim(source_url)) > 0),
      audio_url TEXT NOT NULL CHECK (length(trim(audio_url)) > 0),
      audio_path TEXT NOT NULL CHECK (length(trim(audio_path)) > 0),
      license TEXT NOT NULL CHECK (
        license IN ('CC0 1.0', 'CC-BY 2.5', 'CC-BY 3.0', 'CC-BY 4.0')
      ),
      license_url TEXT NOT NULL CHECK (
        license_url LIKE 'https://creativecommons.org/%'
      ),
      license_evidence_url TEXT NOT NULL CHECK (length(trim(license_evidence_url)) > 0),
      snapshot_path TEXT NOT NULL CHECK (length(snapshot_path) > 0),
      snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256) = 64
        AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      content_sha256 TEXT NOT NULL CHECK (
        length(content_sha256) = 64
        AND content_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
      size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
      bitrate_kbps INTEGER NOT NULL CHECK (bitrate_kbps > 0),
      mime_type TEXT NOT NULL CHECK (mime_type = 'audio/ogg'),
      features_json TEXT NOT NULL CHECK (json_valid(features_json)),
      bucket_rule_version TEXT NOT NULL CHECK (length(bucket_rule_version) > 0),
      pro_registered INTEGER NOT NULL DEFAULT 0 CHECK (pro_registered IN (0, 1)),
      ingested_at TEXT NOT NULL,
      UNIQUE (source_url),
      UNIQUE (track_pool, title, author)
    ) STRICT;

    CREATE INDEX idx_library_tracks_pool_bucket
      ON library_tracks (track_pool, bucket);
  `,
} as const;
