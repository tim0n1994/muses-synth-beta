import { expect, test } from "@playwright/test";
import {
  apiRequest,
  asRecord,
  postJson,
  putJson,
} from "../helpers/api-client.js";
import { getWebUrl } from "../helpers/test-config.js";

interface DraftAnchor {
  readonly revision: number;
  readonly checksum: string;
  readonly document: Record<string, unknown>;
}

function parseDraftAnchor(value: unknown): DraftAnchor {
  const draft = asRecord(value, "settings draft");
  if (typeof draft.revision !== "number") {
    throw new Error("settings draft revision must be a number.");
  }
  if (typeof draft.checksum !== "string") {
    throw new Error("settings draft checksum must be a string.");
  }
  const document = asRecord(draft.document, "settings draft document");
  return { revision: draft.revision, checksum: draft.checksum, document };
}

test("settings draft, preview, publish, history, and rollback preserve static schema", async ({
  page,
}) => {
  // Anchor on the real settings API. The plugin mounts under /api; every
  // envelope here is the raw plugin payload (no additional { ok, data }
  // wrapper — assertion shape comes from schemas in src/server/settings).
  const before = await apiRequest("/api/settings/draft", { method: "GET" });
  expect(before.status).toBe(200);
  const anchor = parseDraftAnchor(before.json);

  // Mutate a harmless scalar (profile name) so preview -> publish produces a
  // distinct document without tripping any semantic invariant.
  const nextDocument = {
    ...anchor.document,
    profile: {
      ...(asRecord(anchor.document.profile, "settings profile") as Record<
        string,
        unknown
      >),
      name: `E2E Lifecycle ${Date.now().toString(36)}`,
    },
  };

  const draftResponse = await putJson("/api/settings/draft", {
    actor: "e2e-settings-lifecycle",
    reason: "Verify draft -> preview -> publish -> rollback flow.",
    expectedRevision: anchor.revision,
    document: nextDocument,
  });
  expect(draftResponse.status).toBe(200);
  const staged = parseDraftAnchor(draftResponse.json);
  expect(staged.revision).toBe(anchor.revision + 1);

  const previewResponse = await postJson("/api/settings/preview", {
    document: staged.document,
  });
  expect(previewResponse.status).toBe(200);
  const preview = asRecord(previewResponse.json, "preview response");
  expect(preview.valid).toBe(true);

  const publishResponse = await postJson("/api/settings/publish", {
    actor: "e2e-settings-lifecycle",
    reason: "Publish staged settings.",
    expectedDraftRevision: staged.revision,
    expectedDraftChecksum: staged.checksum,
  });
  expect(publishResponse.status).toBe(201);
  const publishBody = asRecord(publishResponse.json, "publish response");
  const release = asRecord(publishBody.release, "published release");
  if (typeof release.id !== "string") {
    throw new Error("published release id must be a string.");
  }
  const publishedId = release.id;
  const draftAfterPublish = parseDraftAnchor(publishBody.draft);

  // The settings workspace must reflect the freshly published release id.
  await page.goto(`${getWebUrl()}/settings`);
  const publishedCard = page.locator(".settings-version-published");
  await expect(publishedCard).toBeVisible();

  // Roll back to the anchor document we started from.
  // First we need the release id of the document we started from: publish
  // history is keyed by id, so use GET /api/settings to look up the
  // currentRelease, which is the release we just published; we want to walk
  // its parent chain until we find the prerelease that matches our anchor
  // document checksum.
  const afterPublish = await apiRequest("/api/settings", { method: "GET" });
  expect(afterPublish.status).toBe(200);
  const afterPublishBody = asRecord(afterPublish.json, "settings snapshot");
  const currentRelease = asRecord(
    afterPublishBody.currentRelease,
    "current release",
  );
  if (currentRelease.id !== publishedId) {
    throw new Error(
      `expected current release to equal ${publishedId}, got ${String(
        currentRelease.id,
      )}`,
    );
  }

  // Roll the published release back to whatever the parent release was. If
  // the seeded default is the only prior release this will restore it.
  const parentId = currentRelease.parentReleaseId;
  if (parentId === null || typeof parentId !== "string") {
    throw new Error(
      "expected anchor publish to have a parent release to rollback to",
    );
  }
  const rollbackResponse = await postJson(
    `/api/settings/releases/${parentId}/rollback`,
    {
      actor: "e2e-settings-lifecycle",
      reason: "Restore pre-e2e settings state.",
      expectedCurrentReleaseId: publishedId,
      expectedDraftRevision: draftAfterPublish.revision,
    },
  );
  expect(rollbackResponse.status).toBe(201);

  const restored = await apiRequest("/api/settings", { method: "GET" });
  expect(restored.status).toBe(200);
  const restoredRelease = asRecord(
    asRecord(restored.json, "restored settings").currentRelease,
    "restored current release",
  );

  // Rollback is forward-only: it publishes a NEW release carrying the target's
  // document, rather than reactivating the old row. History is append-only, so
  // the restored release has its own id and points back at the target.
  expect(restoredRelease.id).not.toBe(parentId);
  expect(restoredRelease.rollbackOfReleaseId).toBe(parentId);

  const parentRelease = await apiRequest(`/api/settings/releases/${parentId}`, {
    method: "GET",
  });
  expect(parentRelease.status).toBe(200);
  expect(restoredRelease.checksum).toBe(
    asRecord(parentRelease.json, "parent release").checksum,
  );
  expect(restoredRelease.document).toEqual(anchor.document);
});
