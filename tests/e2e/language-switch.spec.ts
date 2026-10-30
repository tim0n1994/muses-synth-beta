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

async function publishDocument(
  anchor: DraftAnchor,
  document: Record<string, unknown>,
  reason: string,
): Promise<void> {
  const draftResponse = await putJson("/api/settings/draft", {
    actor: "e2e-language-switch",
    reason,
    expectedRevision: anchor.revision,
    document,
  });
  expect(draftResponse.status).toBe(200);
  const staged = parseDraftAnchor(draftResponse.json);

  const publishResponse = await postJson("/api/settings/publish", {
    actor: "e2e-language-switch",
    reason,
    expectedDraftRevision: staged.revision,
    expectedDraftChecksum: staged.checksum,
  });
  expect(publishResponse.status).toBe(201);
}

function withLanguage(
  document: Record<string, unknown>,
  language: string,
): Record<string, unknown> {
  return {
    ...document,
    appearance: {
      ...asRecord(document.appearance, "settings appearance"),
      language,
    },
  };
}

/**
 * The published `appearance.language` drives the whole web surface. This spec
 * flips it to Chinese through the real draft -> publish API, verifies the
 * dashboard renders Chinese chrome after a reload, then restores English.
 *
 * Requires settings schema v4 (server-side `appearance.language`); against a
 * v3 server the draft PUT is rejected with 422 by design.
 */
test("appearance.language switches the dashboard language end to end", async ({
  page,
}) => {
  // Sanity: the default runtime ships English chrome before we touch it.
  await page.goto(getWebUrl());
  await expect(
    page.getByRole("heading", {
      name: "Context, belief, and reversible action",
    }),
  ).toBeVisible();

  const before = await apiRequest("/api/settings/draft", { method: "GET" });
  expect(before.status).toBe(200);
  const anchor = parseDraftAnchor(before.json);
  const originalDocument = anchor.document;

  // --- switch to zh and publish -------------------------------------------
  await publishDocument(
    anchor,
    withLanguage(originalDocument, "zh"),
    "E2E: switch interface language to zh.",
  );

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "上下文、信念与可逆行动" }),
  ).toBeVisible();
  await expect(page.getByText("本地运行时").first()).toBeVisible();
  await expect(page.getByText("实时刷新")).toBeVisible();
  await expect(page.getByLabel("观测台刷新控制")).toBeVisible();

  // --- restore en and publish back ----------------------------------------
  const after = await apiRequest("/api/settings/draft", { method: "GET" });
  expect(after.status).toBe(200);
  const restoreAnchor = parseDraftAnchor(after.json);
  await publishDocument(
    restoreAnchor,
    originalDocument,
    "E2E: restore interface language to the previous release.",
  );

  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Context, belief, and reversible action",
    }),
  ).toBeVisible();
  await expect(page.getByText("Local runtime").first()).toBeVisible();
  await expect(page.getByText("Live refresh")).toBeVisible();
});
