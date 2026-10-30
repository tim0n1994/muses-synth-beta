import { randomUUID } from "node:crypto";

import type { Clock, SqliteDatabase } from "../db/index.js";
import { systemClock, toIsoTimestamp } from "../db/index.js";
import {
  canonicalizeJson,
  checksumJson,
  diffJsonPointers,
} from "./canonical.js";
import { DEFAULT_SETTINGS } from "./default-settings.js";
import {
  SettingsConflictError,
  SettingsIntegrityError,
  SettingsNotFoundError,
  SettingsValidationError,
} from "./errors.js";
import {
  parseSettings,
  upgradeSettingsDocument,
  validateSettings,
  type SettingsDocument,
} from "./schema.js";

const PRIMARY_DRAFT_ID = "primary";
const DEFAULT_ACTOR = "system";
const DEFAULT_SEED_REASON = "validated default settings seed";
const MAX_ACTOR_LENGTH = 128;
const MAX_REASON_LENGTH = 1_000;

export interface SettingsRepositoryOptions {
  readonly clock?: Clock;
  readonly idFactory?: () => string;
}

export interface SettingsDraft {
  readonly id: "primary";
  readonly baseReleaseId: string | null;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly document: SettingsDocument;
  readonly checksum: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SettingsRelease {
  readonly id: string;
  readonly releaseNumber: number;
  readonly parentReleaseId: string | null;
  readonly rollbackOfReleaseId: string | null;
  readonly sourceDraftRevision: number;
  readonly schemaVersion: number;
  readonly document: SettingsDocument;
  readonly checksum: string;
  readonly actor: string;
  readonly reason: string;
  readonly publishedAt: string;
  readonly createdAt: string;
}

export type SettingsHistoryAction =
  "SEED" | "DRAFT_UPDATED" | "PUBLISHED" | "ROLLED_BACK";

export interface SettingsHistoryEntry {
  readonly id: string;
  readonly action: SettingsHistoryAction;
  readonly draftRevision: number | null;
  readonly releaseId: string | null;
  readonly targetReleaseId: string | null;
  readonly checksum: string;
  readonly actor: string;
  readonly reason: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface UpdateDraftInput {
  readonly expectedRevision: number;
  readonly document: unknown;
  readonly actor: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface PreviewSettingsInput {
  readonly document: unknown;
  readonly againstReleaseId?: string;
}

export interface SettingsPreview {
  readonly valid: true;
  readonly checksum: string;
  readonly againstReleaseId: string;
  readonly againstChecksum: string;
  readonly changedPaths: readonly string[];
  readonly changed: boolean;
  readonly document: SettingsDocument;
}

export interface PublishDraftInput {
  readonly expectedDraftRevision: number;
  readonly expectedDraftChecksum: string;
  readonly actor: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface PublishResult {
  readonly release: SettingsRelease;
  readonly draft: SettingsDraft;
}

export interface RollbackInput {
  readonly targetReleaseId: string;
  readonly expectedCurrentReleaseId: string;
  readonly expectedDraftRevision: number;
  readonly actor: string;
  readonly reason: string;
  readonly correlationId?: string;
}

interface DraftRow {
  id: string;
  base_release_id: string | null;
  revision: number;
  schema_version: number;
  document_json: string;
  checksum: string;
  created_at: string;
  updated_at: string;
}

interface ReleaseRow {
  id: string;
  release_number: number;
  parent_release_id: string | null;
  rollback_of_release_id: string | null;
  source_draft_revision: number;
  schema_version: number;
  document_json: string;
  checksum: string;
  actor: string;
  reason: string;
  published_at: string;
  created_at: string;
}

interface HistoryRow {
  id: string;
  action: SettingsHistoryAction;
  draft_revision: number | null;
  release_id: string | null;
  target_release_id: string | null;
  checksum: string;
  actor: string;
  reason: string;
  metadata_json: string;
  occurred_at: string;
}

interface CountRow {
  count: number;
}

function normalizeText(
  value: string,
  label: string,
  maximumLength: number,
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  if (normalized.length > maximumLength) {
    throw new RangeError(
      `${label} must be at most ${maximumLength} characters`,
    );
  }
  return normalized;
}

function normalizeChecksum(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(
      "expectedDraftChecksum must be a lowercase SHA-256 hex digest",
    );
  }
  return normalized;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function requireSettings(value: unknown): SettingsDocument {
  const validation = validateSettings(value);
  if (!validation.valid) {
    throw new SettingsValidationError(validation.issues);
  }
  return structuredClone(value as SettingsDocument);
}

function parseStoredJson(json: string, label: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error: unknown) {
    throw new SettingsIntegrityError(`${label} is not valid JSON`, {
      cause: error,
    });
  }
}

/**
 * Reads one stored settings row into an effective, current-version document.
 *
 * Integrity is checked against the bytes actually on disk — schema version and
 * checksum are compared to the stored value *before* any upgrade — so a row
 * written by an older build still proves it has not been tampered with. Only
 * then is the document widened to `SETTINGS_SCHEMA_VERSION`. Rows already at
 * the current version take an identity upgrade, so the common path is
 * unchanged.
 */
function readStoredDocument(
  json: string,
  schemaVersion: number,
  checksum: string,
  label: string,
): SettingsDocument {
  const stored = parseStoredJson(json, label);
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new SettingsIntegrityError(
      `${label} checksum is not canonical SHA-256 hex`,
    );
  }
  if (checksumJson(stored) !== checksum) {
    throw new SettingsIntegrityError(
      `${label} checksum does not match its document`,
    );
  }
  const storedVersion = (stored as { schemaVersion?: unknown }).schemaVersion;
  if (storedVersion !== schemaVersion) {
    throw new SettingsIntegrityError(
      `${label} schema version does not match its document`,
    );
  }
  try {
    return parseSettings(upgradeSettingsDocument(stored));
  } catch (error: unknown) {
    if (error instanceof SettingsIntegrityError) {
      throw error;
    }
    throw new SettingsIntegrityError(`${label} failed schema validation`, {
      cause: error,
    });
  }
}

function parseMetadata(json: string): Readonly<Record<string, unknown>> {
  const value = parseStoredJson(json, "Stored settings history metadata");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SettingsIntegrityError(
      "Stored settings history metadata is not an object",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function mapDraft(row: DraftRow): SettingsDraft {
  if (row.id !== PRIMARY_DRAFT_ID) {
    throw new SettingsIntegrityError(`Unexpected draft id ${row.id}`);
  }
  const document = readStoredDocument(
    row.document_json,
    row.schema_version,
    row.checksum,
    "Stored settings draft",
  );
  return {
    id: PRIMARY_DRAFT_ID,
    baseReleaseId: row.base_release_id,
    revision: row.revision,
    // Version and checksum describe the document as returned, not as stored,
    // so a caller can re-derive the checksum from `document` and match. They
    // differ only for a row an older build wrote; conflict detection keys on
    // `revision`, so an upgraded checksum never affects concurrency.
    schemaVersion: document.schemaVersion,
    document,
    checksum: checksumJson(document),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelease(row: ReleaseRow): SettingsRelease {
  const document = readStoredDocument(
    row.document_json,
    row.schema_version,
    row.checksum,
    "Stored settings release",
  );
  return {
    id: row.id,
    releaseNumber: row.release_number,
    parentReleaseId: row.parent_release_id,
    rollbackOfReleaseId: row.rollback_of_release_id,
    sourceDraftRevision: row.source_draft_revision,
    schemaVersion: document.schemaVersion,
    document,
    checksum: checksumJson(document),
    actor: row.actor,
    reason: row.reason,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

function mapHistory(row: HistoryRow): SettingsHistoryEntry {
  return {
    id: row.id,
    action: row.action,
    draftRevision: row.draft_revision,
    releaseId: row.release_id,
    targetReleaseId: row.target_release_id,
    checksum: row.checksum,
    actor: row.actor,
    reason: row.reason,
    metadata: parseMetadata(row.metadata_json),
    occurredAt: row.occurred_at,
  };
}

export class SettingsRepository {
  private readonly database: SqliteDatabase;
  private readonly clock: Clock;
  private readonly idFactory: () => string;

  private constructor(
    database: SqliteDatabase,
    options: SettingsRepositoryOptions,
  ) {
    this.database = database;
    this.clock = options.clock ?? systemClock;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  public static initialize(
    database: SqliteDatabase,
    options: SettingsRepositoryOptions = {},
  ): SettingsRepository {
    const repository = new SettingsRepository(database, options);
    repository.assertRequiredTables();
    repository.ensureDefaultSeed();
    return repository;
  }

  private assertRequiredTables(): void {
    const requiredTables = [
      "settings_drafts",
      "settings_releases",
      "settings_history",
      "audit_events",
    ] as const;
    const statement = this.database.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?`,
    );
    for (const table of requiredTables) {
      const row = statement.get(table) as CountRow;
      if (row.count !== 1) {
        throw new SettingsIntegrityError(
          `Required table ${table} is missing; run database migrations before initializing settings`,
        );
      }
    }
  }

  private ensureDefaultSeed(): void {
    const releaseCount = (
      this.database
        .prepare(`SELECT COUNT(*) AS count FROM settings_releases`)
        .get() as CountRow
    ).count;
    const draftCount = (
      this.database
        .prepare(`SELECT COUNT(*) AS count FROM settings_drafts`)
        .get() as CountRow
    ).count;

    if (releaseCount > 0 || draftCount > 0) {
      if (releaseCount === 0 || draftCount !== 1) {
        throw new SettingsIntegrityError(
          "Settings storage is partially initialized; refusing to repair it implicitly",
        );
      }
      return;
    }

    const document = requireSettings(DEFAULT_SETTINGS);
    const documentJson = canonicalizeJson(document);
    const checksum = checksumJson(document);
    const now = toIsoTimestamp(this.clock.now());
    const releaseId = this.idFactory();
    const historyId = this.idFactory();
    const auditId = this.idFactory();

    const seed = this.database.transaction((): void => {
      const currentReleaseCount = (
        this.database
          .prepare(`SELECT COUNT(*) AS count FROM settings_releases`)
          .get() as CountRow
      ).count;
      const currentDraftCount = (
        this.database
          .prepare(`SELECT COUNT(*) AS count FROM settings_drafts`)
          .get() as CountRow
      ).count;
      if (currentReleaseCount !== 0 || currentDraftCount !== 0) {
        return;
      }

      this.database
        .prepare(
          `INSERT INTO settings_releases (
             id, release_number, parent_release_id, rollback_of_release_id,
             source_draft_revision, schema_version, document_json, checksum,
             actor, reason, published_at, created_at
           ) VALUES (?, 1, NULL, NULL, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          releaseId,
          document.schemaVersion,
          documentJson,
          checksum,
          DEFAULT_ACTOR,
          DEFAULT_SEED_REASON,
          now,
          now,
        );

      this.database
        .prepare(
          `INSERT INTO settings_drafts (
             id, base_release_id, revision, schema_version, document_json,
             checksum, created_at, updated_at
           ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          PRIMARY_DRAFT_ID,
          releaseId,
          document.schemaVersion,
          documentJson,
          checksum,
          now,
          now,
        );

      this.insertHistory({
        id: historyId,
        action: "SEED",
        draftRevision: 1,
        releaseId,
        targetReleaseId: null,
        checksum,
        actor: DEFAULT_ACTOR,
        reason: DEFAULT_SEED_REASON,
        metadata: { releaseNumber: 1 },
        occurredAt: now,
      });
      this.insertAudit({
        id: auditId,
        eventType: "settings.seeded",
        entityType: "settings_release",
        entityId: releaseId,
        actor: DEFAULT_ACTOR,
        correlationId: null,
        payload: { checksum, releaseNumber: 1 },
        occurredAt: now,
      });
    });

    seed.immediate();
  }

  public getDraft(): SettingsDraft {
    const row = this.database
      .prepare(`SELECT * FROM settings_drafts WHERE id = ?`)
      .get(PRIMARY_DRAFT_ID) as DraftRow | undefined;
    if (row === undefined) {
      throw new SettingsIntegrityError("Primary settings draft is missing");
    }
    return mapDraft(row);
  }

  public getCurrentRelease(): SettingsRelease {
    const row = this.database
      .prepare(
        `SELECT * FROM settings_releases ORDER BY release_number DESC LIMIT 1`,
      )
      .get() as ReleaseRow | undefined;
    if (row === undefined) {
      throw new SettingsIntegrityError("Current settings release is missing");
    }
    return mapRelease(row);
  }

  public getRelease(releaseId: string): SettingsRelease {
    const row = this.database
      .prepare(`SELECT * FROM settings_releases WHERE id = ?`)
      .get(releaseId) as ReleaseRow | undefined;
    if (row === undefined) {
      throw new SettingsNotFoundError("settings release", releaseId);
    }
    return mapRelease(row);
  }

  public listReleases(limit = 50): readonly SettingsRelease[] {
    const normalizedLimit = Math.min(
      requirePositiveInteger(limit, "limit"),
      200,
    );
    const rows = this.database
      .prepare(
        `SELECT * FROM settings_releases ORDER BY release_number DESC LIMIT ?`,
      )
      .all(normalizedLimit) as readonly ReleaseRow[];
    return rows.map(mapRelease);
  }

  public listHistory(limit = 100): readonly SettingsHistoryEntry[] {
    const normalizedLimit = Math.min(
      requirePositiveInteger(limit, "limit"),
      500,
    );
    const rows = this.database
      .prepare(
        `SELECT * FROM settings_history ORDER BY occurred_at DESC, id DESC LIMIT ?`,
      )
      .all(normalizedLimit) as readonly HistoryRow[];
    return rows.map(mapHistory);
  }

  public updateDraft(input: UpdateDraftInput): SettingsDraft {
    const expectedRevision = requirePositiveInteger(
      input.expectedRevision,
      "expectedRevision",
    );
    const actor = normalizeText(input.actor, "actor", MAX_ACTOR_LENGTH);
    const reason = normalizeText(input.reason, "reason", MAX_REASON_LENGTH);
    const document = requireSettings(input.document);
    const documentJson = canonicalizeJson(document);
    const checksum = checksumJson(document);
    const now = toIsoTimestamp(this.clock.now());
    const historyId = this.idFactory();
    const auditId = this.idFactory();

    const update = this.database.transaction((): SettingsDraft => {
      const current = this.getDraft();
      if (current.revision !== expectedRevision) {
        throw new SettingsConflictError(
          "draftRevision",
          expectedRevision,
          current.revision,
        );
      }
      const nextRevision = current.revision + 1;
      const result = this.database
        .prepare(
          `UPDATE settings_drafts
           SET revision = ?, schema_version = ?, document_json = ?, checksum = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          nextRevision,
          document.schemaVersion,
          documentJson,
          checksum,
          now,
          PRIMARY_DRAFT_ID,
          expectedRevision,
        );
      if (result.changes !== 1) {
        const actual = this.getDraft().revision;
        throw new SettingsConflictError(
          "draftRevision",
          expectedRevision,
          actual,
        );
      }

      const changedPaths = diffJsonPointers(current.document, document);
      this.insertHistory({
        id: historyId,
        action: "DRAFT_UPDATED",
        draftRevision: nextRevision,
        releaseId: current.baseReleaseId,
        targetReleaseId: null,
        checksum,
        actor,
        reason,
        metadata: { previousChecksum: current.checksum, changedPaths },
        occurredAt: now,
      });
      this.insertAudit({
        id: auditId,
        eventType: "settings.draft.updated",
        entityType: "settings_draft",
        entityId: PRIMARY_DRAFT_ID,
        actor,
        correlationId: input.correlationId ?? null,
        payload: {
          previousRevision: current.revision,
          revision: nextRevision,
          checksum,
          changedPaths,
        },
        occurredAt: now,
      });
      return this.getDraft();
    });

    return update.immediate();
  }

  public preview(input: PreviewSettingsInput): SettingsPreview {
    const document = requireSettings(input.document);
    const against = input.againstReleaseId
      ? this.getRelease(input.againstReleaseId)
      : this.getCurrentRelease();
    const checksum = checksumJson(document);
    const changedPaths = diffJsonPointers(against.document, document);
    return {
      valid: true,
      checksum,
      againstReleaseId: against.id,
      againstChecksum: against.checksum,
      changedPaths,
      changed: changedPaths.length > 0,
      document,
    };
  }

  public publishDraft(input: PublishDraftInput): PublishResult {
    const expectedRevision = requirePositiveInteger(
      input.expectedDraftRevision,
      "expectedDraftRevision",
    );
    const expectedChecksum = normalizeChecksum(input.expectedDraftChecksum);
    const actor = normalizeText(input.actor, "actor", MAX_ACTOR_LENGTH);
    const reason = normalizeText(input.reason, "reason", MAX_REASON_LENGTH);
    const now = toIsoTimestamp(this.clock.now());
    const releaseId = this.idFactory();
    const historyId = this.idFactory();
    const auditId = this.idFactory();

    const publish = this.database.transaction((): PublishResult => {
      const draft = this.getDraft();
      if (draft.revision !== expectedRevision) {
        throw new SettingsConflictError(
          "draftRevision",
          expectedRevision,
          draft.revision,
        );
      }
      if (draft.checksum !== expectedChecksum) {
        throw new SettingsConflictError(
          "draftChecksum",
          expectedChecksum,
          draft.checksum,
        );
      }
      const validatedDocument = requireSettings(draft.document);
      const canonicalDocument = canonicalizeJson(validatedDocument);
      const recalculatedChecksum = checksumJson(validatedDocument);
      if (recalculatedChecksum !== draft.checksum) {
        throw new SettingsIntegrityError(
          "Stored draft checksum does not match its document",
        );
      }

      const currentRelease = this.getCurrentRelease();
      const nextReleaseNumber = currentRelease.releaseNumber + 1;
      this.database
        .prepare(
          `INSERT INTO settings_releases (
             id, release_number, parent_release_id, rollback_of_release_id,
             source_draft_revision, schema_version, document_json, checksum,
             actor, reason, published_at, created_at
           ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          releaseId,
          nextReleaseNumber,
          currentRelease.id,
          draft.revision,
          validatedDocument.schemaVersion,
          canonicalDocument,
          recalculatedChecksum,
          actor,
          reason,
          now,
          now,
        );

      const nextDraftRevision = draft.revision + 1;
      const updateResult = this.database
        .prepare(
          `UPDATE settings_drafts
           SET base_release_id = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          releaseId,
          nextDraftRevision,
          now,
          PRIMARY_DRAFT_ID,
          draft.revision,
        );
      if (updateResult.changes !== 1) {
        throw new SettingsConflictError(
          "draftRevision",
          draft.revision,
          this.getDraft().revision,
        );
      }

      this.insertHistory({
        id: historyId,
        action: "PUBLISHED",
        draftRevision: draft.revision,
        releaseId,
        targetReleaseId: null,
        checksum: recalculatedChecksum,
        actor,
        reason,
        metadata: {
          parentReleaseId: currentRelease.id,
          releaseNumber: nextReleaseNumber,
        },
        occurredAt: now,
      });
      this.insertAudit({
        id: auditId,
        eventType: "settings.published",
        entityType: "settings_release",
        entityId: releaseId,
        actor,
        correlationId: input.correlationId ?? null,
        payload: {
          checksum: recalculatedChecksum,
          parentReleaseId: currentRelease.id,
          releaseNumber: nextReleaseNumber,
          sourceDraftRevision: draft.revision,
        },
        occurredAt: now,
      });

      return { release: this.getRelease(releaseId), draft: this.getDraft() };
    });

    return publish.immediate();
  }

  public rollback(input: RollbackInput): PublishResult {
    const expectedDraftRevision = requirePositiveInteger(
      input.expectedDraftRevision,
      "expectedDraftRevision",
    );
    const actor = normalizeText(input.actor, "actor", MAX_ACTOR_LENGTH);
    const reason = normalizeText(input.reason, "reason", MAX_REASON_LENGTH);
    const now = toIsoTimestamp(this.clock.now());
    const releaseId = this.idFactory();
    const historyId = this.idFactory();
    const auditId = this.idFactory();

    const rollback = this.database.transaction((): PublishResult => {
      const currentRelease = this.getCurrentRelease();
      if (currentRelease.id !== input.expectedCurrentReleaseId) {
        throw new SettingsConflictError(
          "currentReleaseId",
          input.expectedCurrentReleaseId,
          currentRelease.id,
        );
      }
      const draft = this.getDraft();
      if (draft.revision !== expectedDraftRevision) {
        throw new SettingsConflictError(
          "draftRevision",
          expectedDraftRevision,
          draft.revision,
        );
      }
      const target = this.getRelease(input.targetReleaseId);
      const nextReleaseNumber = currentRelease.releaseNumber + 1;
      const canonicalDocument = canonicalizeJson(target.document);
      const recalculatedChecksum = checksumJson(target.document);
      if (recalculatedChecksum !== target.checksum) {
        throw new SettingsIntegrityError(
          "Target release checksum does not match its document",
        );
      }

      this.database
        .prepare(
          `INSERT INTO settings_releases (
             id, release_number, parent_release_id, rollback_of_release_id,
             source_draft_revision, schema_version, document_json, checksum,
             actor, reason, published_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          releaseId,
          nextReleaseNumber,
          currentRelease.id,
          target.id,
          draft.revision,
          target.schemaVersion,
          canonicalDocument,
          recalculatedChecksum,
          actor,
          reason,
          now,
          now,
        );

      const nextDraftRevision = draft.revision + 1;
      const updateResult = this.database
        .prepare(
          `UPDATE settings_drafts
           SET base_release_id = ?, revision = ?, schema_version = ?, document_json = ?,
               checksum = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          releaseId,
          nextDraftRevision,
          target.schemaVersion,
          canonicalDocument,
          recalculatedChecksum,
          now,
          PRIMARY_DRAFT_ID,
          draft.revision,
        );
      if (updateResult.changes !== 1) {
        throw new SettingsConflictError(
          "draftRevision",
          draft.revision,
          this.getDraft().revision,
        );
      }

      this.insertHistory({
        id: historyId,
        action: "ROLLED_BACK",
        draftRevision: draft.revision,
        releaseId,
        targetReleaseId: target.id,
        checksum: recalculatedChecksum,
        actor,
        reason,
        metadata: {
          parentReleaseId: currentRelease.id,
          releaseNumber: nextReleaseNumber,
          targetReleaseNumber: target.releaseNumber,
        },
        occurredAt: now,
      });
      this.insertAudit({
        id: auditId,
        eventType: "settings.rolled_back",
        entityType: "settings_release",
        entityId: releaseId,
        actor,
        correlationId: input.correlationId ?? null,
        payload: {
          checksum: recalculatedChecksum,
          parentReleaseId: currentRelease.id,
          releaseNumber: nextReleaseNumber,
          targetReleaseId: target.id,
          targetReleaseNumber: target.releaseNumber,
        },
        occurredAt: now,
      });

      return { release: this.getRelease(releaseId), draft: this.getDraft() };
    });

    return rollback.immediate();
  }

  private insertHistory(input: {
    readonly id: string;
    readonly action: SettingsHistoryAction;
    readonly draftRevision: number | null;
    readonly releaseId: string | null;
    readonly targetReleaseId: string | null;
    readonly checksum: string;
    readonly actor: string;
    readonly reason: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly occurredAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO settings_history (
           id, action, draft_revision, release_id, target_release_id, checksum,
           actor, reason, metadata_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.action,
        input.draftRevision,
        input.releaseId,
        input.targetReleaseId,
        input.checksum,
        input.actor,
        input.reason,
        canonicalizeJson(input.metadata),
        input.occurredAt,
      );
  }

  private insertAudit(input: {
    readonly id: string;
    readonly eventType: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly actor: string;
    readonly correlationId: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly occurredAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO audit_events (
           id, event_type, entity_type, entity_id, actor, correlation_id,
           payload_json, occurred_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.eventType,
        input.entityType,
        input.entityId,
        input.actor,
        input.correlationId,
        canonicalizeJson(input.payload),
        input.occurredAt,
        input.occurredAt,
      );
  }
}
