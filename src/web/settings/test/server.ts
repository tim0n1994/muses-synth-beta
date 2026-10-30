import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { SettingsDocument } from "../model/document";
import {
  currentRelease,
  draft,
  previewResult,
  releases,
  settingsSnapshot,
} from "./fixtures";

interface SaveDraftBody {
  actor: string;
  reason: string;
  expectedRevision: number;
  document: SettingsDocument;
}

export const handlers = [
  http.get("/api/settings", () => HttpResponse.json(settingsSnapshot)),
  http.get("/api/settings/releases", () => HttpResponse.json(releases)),
  http.put("/api/settings/draft", async ({ request }) => {
    const body = (await request.json()) as SaveDraftBody;
    return HttpResponse.json({
      ...draft,
      revision: body.expectedRevision + 1,
      updatedAt: "2026-07-29T19:10:00.000Z",
      document: body.document,
    });
  }),
  http.post("/api/settings/preview", () => HttpResponse.json(previewResult)),
  http.post("/api/settings/publish", () =>
    HttpResponse.json({
      release: {
        ...currentRelease,
        id: "release-2",
        releaseNumber: 2,
        parentReleaseId: currentRelease.id,
        sourceDraftRevision: draft.revision,
        document: draft.document,
        publishedAt: "2026-07-29T19:12:00.000Z",
      },
      draft: { ...draft, revision: draft.revision + 1 },
    }),
  ),
  http.post("/api/settings/releases/:releaseId/rollback", ({ params }) =>
    HttpResponse.json({
      release: {
        ...currentRelease,
        id: "release-3",
        releaseNumber: 3,
        parentReleaseId: "release-2",
        rollbackOfReleaseId: String(params.releaseId),
        publishedAt: "2026-07-29T19:15:00.000Z",
      },
      draft: { ...draft, revision: draft.revision + 2 },
    }),
  ),
];

export const server = setupServer(...handlers);
