import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, runMigrations } from "../db/index.js";
import { DEFAULT_SETTINGS } from "./default-settings.js";
import { settingsRoutesPlugin } from "./plugin.js";
import { SettingsRepository } from "./repository.js";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const action = cleanup.pop();
    if (action !== undefined) {
      await action();
    }
  }
});

async function createApp() {
  const directory = mkdtempSync(join(tmpdir(), "muses-settings-api-test-"));
  const opened = openDatabase(join(directory, "muses.sqlite"));
  runMigrations(opened.connection, { purpose: "test" });
  const repository = SettingsRepository.initialize(opened.connection);
  const app = Fastify({ logger: false });
  await app.register(settingsRoutesPlugin, { repository, prefix: "/api" });
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => opened.close());
  cleanup.push(async () => app.close());
  return { app, repository };
}

describe("settings Fastify plugin", () => {
  // Each heavy test here boots its own temp-dir SQLite database and drives a
  // full draft → preview → publish → rollback sweep through Fastify. On the
  // shared CI runner that measured ~5.1s for the first sweep (≈24x slower
  // than a dev machine), so these integration sweeps get an explicit,
  // generous timeout instead of the 5s default.
  it("serves draft, preview, publish, history, and rollback endpoints", async () => {
    const { app, repository } = await createApp();
    const initial = repository.getDraft();
    const changed = {
      ...DEFAULT_SETTINGS,
      belief: { ...DEFAULT_SETTINGS.belief, minimumConfidence: 0.8 },
    };

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      payload: {
        expectedRevision: initial.revision,
        document: changed,
        actor: "api.test",
        reason: "tighten confidence",
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json<{
      revision: number;
      checksum: string;
    }>();

    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/settings/preview",
      payload: { document: changed },
    });
    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json<{ changed: boolean }>().changed).toBe(true);

    const publishResponse = await app.inject({
      method: "POST",
      url: "/api/settings/publish",
      payload: {
        expectedDraftRevision: updated.revision,
        expectedDraftChecksum: updated.checksum,
        actor: "api.test",
        reason: "publish confidence policy",
      },
    });
    expect(publishResponse.statusCode).toBe(201);
    const published = publishResponse.json<{
      release: { id: string; releaseNumber: number };
      draft: { revision: number };
    }>();
    expect(published.release.releaseNumber).toBe(2);

    const releasesResponse = await app.inject({
      method: "GET",
      url: "/api/settings/releases",
    });
    expect(releasesResponse.statusCode).toBe(200);
    const releases =
      releasesResponse.json<Array<{ id: string; releaseNumber: number }>>();
    const seedRelease = releases.find((release) => release.releaseNumber === 1);
    expect(seedRelease).toBeDefined();

    const rollbackResponse = await app.inject({
      method: "POST",
      url: `/api/settings/releases/${seedRelease?.id ?? "missing"}/rollback`,
      payload: {
        expectedCurrentReleaseId: published.release.id,
        expectedDraftRevision: published.draft.revision,
        actor: "api.test",
        reason: "rollback via API",
      },
    });
    expect(rollbackResponse.statusCode).toBe(201);
    expect(
      rollbackResponse.json<{ release: { releaseNumber: number } }>().release
        .releaseNumber,
    ).toBe(3);

    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/settings/history",
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(
      historyResponse
        .json<Array<{ action: string }>>()
        .map((entry) => entry.action),
    ).toEqual(["ROLLED_BACK", "PUBLISHED", "DRAFT_UPDATED", "SEED"]);
  }, 20_000);

  it("returns 409 for stale draft revision", async () => {
    const { app, repository } = await createApp();
    const initial = repository.getDraft();
    repository.updateDraft({
      expectedRevision: initial.revision,
      document: DEFAULT_SETTINGS,
      actor: "direct.writer",
      reason: "advance revision",
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      payload: {
        expectedRevision: initial.revision,
        document: DEFAULT_SETTINGS,
        actor: "api.stale",
        reason: "stale writer",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("SETTINGS_CONFLICT");
  });

  it("round-trips the v3 llm section through draft, publish and rollback", async () => {
    const { app, repository } = await createApp();
    expect(repository.getCurrentRelease().document.llm).toEqual({
      enabled: false,
      model: "auto",
    });

    const initial = repository.getDraft();
    const enabled = {
      ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, enabled: true },
    };

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      payload: {
        expectedRevision: initial.revision,
        document: enabled,
        actor: "api.test",
        reason: "enable llm narration",
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(
      updateResponse.json<{ document: { llm: { enabled: boolean } } }>()
        .document.llm.enabled,
    ).toBe(true);

    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/settings/preview",
      payload: { document: enabled },
    });
    expect(previewResponse.statusCode).toBe(200);
    expect(
      previewResponse.json<{ changedPaths: string[] }>().changedPaths,
    ).toContain("/llm/enabled");

    const updated = updateResponse.json<{
      revision: number;
      checksum: string;
    }>();
    const publishResponse = await app.inject({
      method: "POST",
      url: "/api/settings/publish",
      payload: {
        expectedDraftRevision: updated.revision,
        expectedDraftChecksum: updated.checksum,
        actor: "api.test",
        reason: "publish llm enablement",
      },
    });
    expect(publishResponse.statusCode).toBe(201);
    const published = publishResponse.json<{
      release: { id: string };
      draft: { revision: number };
    }>();

    const settingsResponse = await app.inject({
      method: "GET",
      url: "/api/settings",
    });
    expect(settingsResponse.statusCode).toBe(200);
    expect(
      settingsResponse.json<{
        currentRelease: { document: { llm: { enabled: boolean } } };
      }>().currentRelease.document.llm.enabled,
    ).toBe(true);

    const seedReleaseId = repository
      .listReleases(10)
      .find((release) => release.releaseNumber === 1)?.id;
    const rollbackResponse = await app.inject({
      method: "POST",
      url: `/api/settings/releases/${seedReleaseId ?? "missing"}/rollback`,
      payload: {
        expectedCurrentReleaseId: published.release.id,
        expectedDraftRevision: published.draft.revision,
        actor: "api.test",
        reason: "disable llm again",
      },
    });
    expect(rollbackResponse.statusCode).toBe(201);
    expect(repository.getCurrentRelease().document.llm.enabled).toBe(false);
  }, 20_000);

  it("rejects an llm section with an invalid model alias", async () => {
    const { app, repository } = await createApp();
    const initial = repository.getDraft();
    const invalid: unknown = {
      ...DEFAULT_SETTINGS,
      llm: { enabled: true, model: "not a valid alias!" },
    };

    const response = await app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      payload: {
        expectedRevision: initial.revision,
        document: invalid,
        actor: "api.test",
        reason: "must be rejected",
      },
    });
    // The alias pattern is structural (schema.ts LlmSectionSchema), so the
    // route's body schema rejects it before the repository layer — the same
    // 400 INVALID_REQUEST envelope as any other malformed document, never a
    // domain 422 (semantic invariants have no llm rules by design).
    expect(response.statusCode).toBe(400);
    const body = response.json<{
      code: string;
      details?: { issues?: Array<{ instancePath?: string }> };
    }>();
    expect(body.code).toBe("INVALID_REQUEST");
    expect(
      body.details?.issues?.some(
        (issue) => issue.instancePath === "/document/llm/model",
      ),
    ).toBe(true);
  });

  it("round-trips appearance.language through draft, publish and rollback", async () => {
    const { app, repository } = await createApp();
    expect(repository.getCurrentRelease().document.appearance.language).toBe(
      "en",
    );

    const initial = repository.getDraft();
    const localized = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, language: "ja" },
    };

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/settings/draft",
      payload: {
        expectedRevision: initial.revision,
        document: localized,
        actor: "api.test",
        reason: "switch ui language",
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(
      updateResponse.json<{
        document: { appearance: { language: string } };
      }>().document.appearance.language,
    ).toBe("ja");

    const updated = updateResponse.json<{
      revision: number;
      checksum: string;
    }>();
    const publishResponse = await app.inject({
      method: "POST",
      url: "/api/settings/publish",
      payload: {
        expectedDraftRevision: updated.revision,
        expectedDraftChecksum: updated.checksum,
        actor: "api.test",
        reason: "publish language switch",
      },
    });
    expect(publishResponse.statusCode).toBe(201);
    const published = publishResponse.json<{
      release: { id: string };
      draft: { revision: number };
    }>();

    expect(repository.getCurrentRelease().document.appearance.language).toBe(
      "ja",
    );

    const seedReleaseId = repository
      .listReleases(10)
      .find((release) => release.releaseNumber === 1)?.id;
    const rollbackResponse = await app.inject({
      method: "POST",
      url: `/api/settings/releases/${seedReleaseId ?? "missing"}/rollback`,
      payload: {
        expectedCurrentReleaseId: published.release.id,
        expectedDraftRevision: published.draft.revision,
        actor: "api.test",
        reason: "restore default language",
      },
    });
    expect(rollbackResponse.statusCode).toBe(201);
    expect(repository.getCurrentRelease().document.appearance.language).toBe(
      "en",
    );
  }, 20_000);

  it("rejects an appearance section with an unknown language code", async () => {
    const { app, repository } = await createApp();
    const initial = repository.getDraft();

    for (const language of ["xx", "EN"]) {
      const invalid: unknown = {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, language },
      };

      const response = await app.inject({
        method: "PUT",
        url: "/api/settings/draft",
        payload: {
          expectedRevision: initial.revision,
          document: invalid,
          actor: "api.test",
          reason: "must be rejected",
        },
      });
      // The language enum is structural (schema.ts LanguageCodeSchema), so
      // the route's body schema rejects it before the repository layer — the
      // same 400 INVALID_REQUEST envelope as any other malformed document,
      // never a domain 422 (semantic invariants have no language rules).
      expect(response.statusCode).toBe(400);
      const body = response.json<{
        code: string;
        details?: { issues?: Array<{ instancePath?: string }> };
      }>();
      expect(body.code).toBe("INVALID_REQUEST");
      expect(
        body.details?.issues?.some(
          (issue) => issue.instancePath === "/document/appearance/language",
        ),
      ).toBe(true);
    }
  });
});
