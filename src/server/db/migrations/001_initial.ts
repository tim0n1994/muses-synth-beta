export const migration001Initial = {
  version: 1,
  name: "initial_local_runtime_schema",
  sql: `
CREATE TABLE muses_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

INSERT INTO muses_metadata (key, value) VALUES
  ('database_kind', 'muses-v0.1'),
  ('created_by_migration', '1');

CREATE TABLE context_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  dedupe_key TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source, dedupe_key)
) STRICT;

CREATE INDEX context_events_occurred_at_idx
  ON context_events (occurred_at DESC, id DESC);
CREATE INDEX context_events_type_occurred_at_idx
  ON context_events (event_type, occurred_at DESC);
CREATE INDEX context_events_correlation_idx
  ON context_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE TABLE belief_snapshots (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
  state TEXT NOT NULL CHECK (state IN ('EXPLORE', 'BUILD', 'DEBUG', 'REVIEW', 'WAIT', 'BREAK', 'UNKNOWN')),
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  distribution_json TEXT NOT NULL CHECK (json_valid(distribution_json)),
  factors_json TEXT NOT NULL CHECK (json_valid(factors_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  explanation_json TEXT NOT NULL CHECK (json_valid(explanation_json)),
  window_started_at TEXT NOT NULL,
  window_ended_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (window_started_at <= window_ended_at)
) STRICT;

CREATE INDEX belief_snapshots_created_at_idx
  ON belief_snapshots (created_at DESC, sequence DESC);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  belief_snapshot_id TEXT NOT NULL REFERENCES belief_snapshots(id) ON DELETE RESTRICT,
  decision_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ACTION', 'NO_ACTION')),
  reason_code TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX decisions_created_at_idx
  ON decisions (created_at DESC, id DESC);
CREATE INDEX decisions_belief_snapshot_idx
  ON decisions (belief_snapshot_id);

CREATE TABLE effects (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE RESTRICT,
  effect_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'APPLIED', 'REVERTED', 'FAILED', 'CANCELLED')),
  reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  previous_state_json TEXT CHECK (previous_state_json IS NULL OR json_valid(previous_state_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  requested_at TEXT NOT NULL,
  applied_at TEXT,
  reverted_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (reverted_at IS NULL OR reversible = 1)
) STRICT;

CREATE INDEX effects_decision_idx ON effects (decision_id);
CREATE INDEX effects_status_updated_at_idx ON effects (status, updated_at DESC);

CREATE TABLE settings_releases (
  id TEXT PRIMARY KEY,
  release_number INTEGER NOT NULL UNIQUE CHECK (release_number > 0),
  parent_release_id TEXT REFERENCES settings_releases(id) ON DELETE RESTRICT,
  rollback_of_release_id TEXT REFERENCES settings_releases(id) ON DELETE RESTRICT,
  source_draft_revision INTEGER NOT NULL CHECK (source_draft_revision > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (parent_release_id IS NULL OR parent_release_id <> id),
  CHECK (rollback_of_release_id IS NULL OR rollback_of_release_id <> id)
) STRICT;

CREATE INDEX settings_releases_published_at_idx
  ON settings_releases (published_at DESC, release_number DESC);

CREATE TABLE settings_drafts (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  base_release_id TEXT REFERENCES settings_releases(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE settings_history (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('SEED', 'DRAFT_UPDATED', 'PUBLISHED', 'ROLLED_BACK')),
  draft_revision INTEGER,
  release_id TEXT REFERENCES settings_releases(id) ON DELETE RESTRICT,
  target_release_id TEXT REFERENCES settings_releases(id) ON DELETE RESTRICT,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX settings_history_occurred_at_idx
  ON settings_history (occurred_at DESC, id DESC);
CREATE INDEX settings_history_release_idx
  ON settings_history (release_id)
  WHERE release_id IS NOT NULL;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  correlation_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_events_entity_idx
  ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_type_occurred_at_idx
  ON audit_events (event_type, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx
  ON audit_events (correlation_id)
  WHERE correlation_id IS NOT NULL;
`,
} as const;
