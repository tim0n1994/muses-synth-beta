import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openDatabase,
  runMigrations,
  type Clock,
  type SqliteDatabase,
} from "../db/index.js";
import { canonicalizeJson, checksumJson } from "./canonical.js";
import { DEFAULT_SETTINGS } from "./default-settings.js";
import {
  SettingsConflictError,
  SettingsIntegrityError,
  SettingsValidationError,
} from "./errors.js";
import { SettingsRepository } from "./repository.js";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_LLM_SECTION,
  DEFAULT_QUIET_HOURS,
  SETTINGS_SCHEMA_VERSION,
  upgradeSettingsDocument,
} from "./schema.js";

function createClock(): Clock {
  let milliseconds = Date.parse("2026-07-30T00:00:00.000Z");
  return {
    now: () => {
      const value = new Date(milliseconds);
      milliseconds += 1_000;
      return value;
    },
  };
}

function createIdFactory(): () => string {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

function withTempDatabase(
  run: (context: {
    filename: string;
    database: SqliteDatabase;
    repository: SettingsRepository;
    close: () => void;
  }) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "muses-settings-test-"));
  const filename = join(directory, "muses.sqlite");
  const opened = openDatabase(filename);
  runMigrations(opened.connection, { purpose: "test" });
  const repository = SettingsRepository.initialize(opened.connection, {
    clock: createClock(),
    idFactory: createIdFactory(),
  });
  try {
    run({
      filename,
      database: opened.connection,
      repository,
      close: (): void => opened.close(),
    });
  } finally {
    opened.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function changedSettings(masterGain: number) {
  return {
    ...DEFAULT_SETTINGS,
    audio: {
      ...DEFAULT_SETTINGS.audio,
      masterGain,
    },
  };
}

describe("SettingsRepository", () => {
  it("seeds one validated release and one draft, then persists across restart", () => {
    withTempDatabase(({ filename, repository, close }) => {
      const draft = repository.getDraft();
      const release = repository.getCurrentRelease();
      expect(draft.revision).toBe(1);
      expect(draft.baseReleaseId).toBe(release.id);
      expect(draft.document.decision.unknownOutcome).toBe("NO_ACTION");
      expect(
        draft.document.audio.profiles.find(
          (profile) => profile.state === "UNKNOWN",
        ),
      ).toMatchObject({
        soundscapeId: null,
        targetGain: 0,
      });

      close();
      const reopened = openDatabase(filename, { fileMustExist: true });
      try {
        runMigrations(reopened.connection, { purpose: "test" });
        const restarted = SettingsRepository.initialize(reopened.connection);
        expect(restarted.getDraft()).toEqual(draft);
        expect(restarted.getCurrentRelease()).toEqual(release);
      } finally {
        reopened.close();
      }
    });
  });

  it("detects optimistic concurrency conflicts between stale writers", () => {
    withTempDatabase(({ repository }) => {
      const initial = repository.getDraft();
      const updated = repository.updateDraft({
        expectedRevision: initial.revision,
        document: changedSettings(0.4),
        actor: "test.writer.one",
        reason: "first update",
      });
      expect(updated.revision).toBe(initial.revision + 1);

      expect(() =>
        repository.updateDraft({
          expectedRevision: initial.revision,
          document: changedSettings(0.5),
          actor: "test.writer.two",
          reason: "stale update",
        }),
      ).toThrow(SettingsConflictError);
      expect(repository.getDraft()).toEqual(updated);
    });
  });

  it("rejects invalid writes atomically without history or audit side effects", () => {
    withTempDatabase(({ database, repository }) => {
      const before = repository.getDraft();
      const historyBefore = repository.listHistory(100);
      const auditBefore = database
        .prepare(`SELECT COUNT(*) AS count FROM audit_events`)
        .get() as {
        count: number;
      };
      const invalid: unknown = {
        ...DEFAULT_SETTINGS,
        decision: {
          ...DEFAULT_SETTINGS.decision,
          unknownOutcome: "APPLY_EFFECT",
        },
      };

      expect(() =>
        repository.updateDraft({
          expectedRevision: before.revision,
          document: invalid,
          actor: "test.invalid",
          reason: "must fail",
        }),
      ).toThrow(SettingsValidationError);
      expect(repository.getDraft()).toEqual(before);
      expect(repository.listHistory(100)).toEqual(historyBefore);
      const auditAfter = database
        .prepare(`SELECT COUNT(*) AS count FROM audit_events`)
        .get() as {
        count: number;
      };
      expect(auditAfter.count).toBe(auditBefore.count);
    });
  });

  it("publishes immutable releases and rolls back by creating a new release", () => {
    withTempDatabase(({ database, repository }) => {
      const initialRelease = repository.getCurrentRelease();
      const initialDraft = repository.getDraft();
      const updatedDraft = repository.updateDraft({
        expectedRevision: initialDraft.revision,
        document: changedSettings(0.55),
        actor: "test.publisher",
        reason: "raise volume",
      });
      const published = repository.publishDraft({
        expectedDraftRevision: updatedDraft.revision,
        expectedDraftChecksum: updatedDraft.checksum,
        actor: "test.publisher",
        reason: "publish changed settings",
      });
      expect(published.release.releaseNumber).toBe(2);
      expect(published.release.parentReleaseId).toBe(initialRelease.id);
      expect(published.release.document.audio.masterGain).toBe(0.55);
      expect(() =>
        database
          .prepare(`UPDATE settings_releases SET reason = 'tampered'`)
          .run(),
      ).toThrow();

      const rolledBack = repository.rollback({
        targetReleaseId: initialRelease.id,
        expectedCurrentReleaseId: published.release.id,
        expectedDraftRevision: published.draft.revision,
        actor: "test.rollback",
        reason: "restore safe default",
      });
      expect(rolledBack.release.releaseNumber).toBe(3);
      expect(rolledBack.release.rollbackOfReleaseId).toBe(initialRelease.id);
      expect(rolledBack.release.id).not.toBe(initialRelease.id);
      expect(rolledBack.release.checksum).toBe(initialRelease.checksum);
      expect(
        repository.listReleases(10).map((release) => release.releaseNumber),
      ).toEqual([3, 2, 1]);
      expect(repository.listHistory(10).map((entry) => entry.action)).toEqual([
        "ROLLED_BACK",
        "PUBLISHED",
        "DRAFT_UPDATED",
        "SEED",
      ]);
    });
  });
});

describe("settings schema upgrade on read", () => {
  it("widens a stored v1 draft to the current version with safe defaults", () => {
    withTempDatabase(({ database, repository }) => {
      // Arrange: rewrite the seeded draft as the v1 document an older build
      // would have written — no `appearance`, no `decision.quietHours`, no
      // `llm`.
      const current = repository.getDraft().document;
      const {
        appearance: _appearance,
        llm: _llm,
        ...withoutAppearance
      } = current;
      const { quietHours: _quietHours, ...decisionV1 } = current.decision;
      const legacyDocument = {
        ...withoutAppearance,
        schemaVersion: 1,
        decision: decisionV1,
      };
      database
        .prepare(
          `UPDATE settings_drafts
             SET schema_version = 1, document_json = ?, checksum = ?
           WHERE id = 'primary'`,
        )
        .run(canonicalizeJson(legacyDocument), checksumJson(legacyDocument));

      // Act
      const draft = repository.getDraft();

      // Assert: current version, defaults filled, everything else preserved.
      expect(draft.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(draft.document.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(draft.document.appearance).toEqual(DEFAULT_APPEARANCE);
      expect(draft.document.decision.quietHours).toEqual(DEFAULT_QUIET_HOURS);
      // The chain must land the v4 field with the same guarantee.
      expect(draft.document.appearance.language).toBe("en");
      // N5: the chained upgrade must land the v3 section too — a v1 database
      // that upgraded to "v3 without llm" would fail read-path validation and
      // brick bootstrap for existing users.
      expect(draft.document.llm).toEqual(DEFAULT_LLM_SECTION);
      expect(draft.document.decision.cooldownMs).toBe(
        current.decision.cooldownMs,
      );
      expect(draft.document.audio).toEqual(current.audio);
      // The reported checksum describes the document as returned, so a caller
      // can re-derive it.
      expect(draft.checksum).toBe(checksumJson(draft.document));
    });
  });

  it("widens a stored v2 draft through the full chain to v4", () => {
    withTempDatabase(({ database, repository }) => {
      // Arrange: rewrite the seeded draft as the v2 document the previous
      // build wrote — no `llm` section, no `appearance.language`.
      const current = repository.getDraft().document;
      const { llm: _llm, ...withoutLlm } = current;
      const legacyDocument = { ...withoutLlm, schemaVersion: 2 };
      database
        .prepare(
          `UPDATE settings_drafts
             SET schema_version = 2, document_json = ?, checksum = ?
           WHERE id = 'primary'`,
        )
        .run(canonicalizeJson(legacyDocument), checksumJson(legacyDocument));

      // Act
      const draft = repository.getDraft();

      // Assert: the chain runs v2 → v3 → v4, so both later sections appear.
      expect(draft.document.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(draft.document.llm).toEqual(DEFAULT_LLM_SECTION);
      expect(draft.document.appearance.language).toBe("en");
      expect(draft.document.decision.quietHours).toEqual(
        current.decision.quietHours,
      );
      expect(draft.checksum).toBe(checksumJson(draft.document));
    });
  });

  it("widens a stored v3 draft to v4 with the default language", () => {
    withTempDatabase(({ database, repository }) => {
      // Arrange: rewrite the seeded draft as the v3 document the previous
      // build wrote — `llm` present, `appearance` without `language`.
      const current = repository.getDraft().document;
      const { language: _language, ...appearanceV3 } = current.appearance;
      const legacyDocument = {
        ...current,
        schemaVersion: 3,
        appearance: appearanceV3,
      };
      database
        .prepare(
          `UPDATE settings_drafts
             SET schema_version = 3, document_json = ?, checksum = ?
           WHERE id = 'primary'`,
        )
        .run(canonicalizeJson(legacyDocument), checksumJson(legacyDocument));

      // Act
      const draft = repository.getDraft();

      // Assert: v4 with the constant default language, everything else
      // preserved — a strict widening.
      expect(draft.document.schemaVersion).toBe(4);
      expect(draft.document.appearance.language).toBe("en");
      expect(draft.document.appearance.productName).toBe(
        current.appearance.productName,
      );
      expect(draft.document.llm).toEqual(current.llm);
      expect(draft.checksum).toBe(checksumJson(draft.document));
    });
  });

  it("injects constant upgrade defaults, never environment values", () => {
    withTempDatabase(({ database, repository }) => {
      const current = repository.getDraft().document;
      const { appearance: _appearance, llm: _llm, ...withoutV2V3 } = current;
      const { quietHours: _quietHours, ...decisionV1 } = current.decision;
      const legacyDocument = {
        ...withoutV2V3,
        schemaVersion: 1,
        decision: decisionV1,
      };
      database
        .prepare(
          `UPDATE settings_drafts
             SET schema_version = 1, document_json = ?, checksum = ?
           WHERE id = 'primary'`,
        )
        .run(canonicalizeJson(legacyDocument), checksumJson(legacyDocument));

      const previous = { ...process.env };
      process.env.LLM_MODEL = "env-should-never-leak-into-storage";
      try {
        const draft = repository.getDraft();
        expect(draft.document.llm).toEqual({ enabled: false, model: "auto" });
        expect(draft.document.appearance).toEqual(DEFAULT_APPEARANCE);
      } finally {
        for (const key of Object.keys(process.env)) {
          if (!(key in previous)) {
            delete process.env[key];
          }
        }
        Object.assign(process.env, previous);
      }
    });
  });

  it("passes current-version and unrecognized documents through untouched", () => {
    const v4 = { ...DEFAULT_SETTINGS };
    expect(upgradeSettingsDocument(v4)).toBe(v4);

    const garbage = { schemaVersion: 99, nonsense: true };
    expect(upgradeSettingsDocument(garbage)).toBe(garbage);
    expect(upgradeSettingsDocument(null)).toBe(null);
    expect(upgradeSettingsDocument([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("rejects a stored document whose checksum does not match", () => {
    withTempDatabase(({ database, repository }) => {
      const current = repository.getDraft().document;
      const tampered = {
        ...current,
        profile: { ...current.profile, name: "tampered" },
      };
      database
        .prepare(
          `UPDATE settings_drafts SET document_json = ? WHERE id = 'primary'`,
        )
        .run(canonicalizeJson(tampered));

      expect(() => repository.getDraft()).toThrow(SettingsIntegrityError);
    });
  });
});
