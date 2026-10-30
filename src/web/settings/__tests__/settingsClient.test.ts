import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  createSettingsClient,
  SettingsApiError,
  SettingsConflictError,
} from "../api/settingsClient";
import { draftDocument } from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

describe("settingsClient", () => {
  it("loads the snapshot from the route the server actually registers", async () => {
    // Regression guard for the v0.2 wiring gap: the client used to call
    // GET /api/settings/snapshot, which the plugin never registered, so the
    // whole workspace 404'd on load.
    const snapshot = await createSettingsClient().getSnapshot();

    expect(snapshot.draft.revision).toBe(2);
    expect(snapshot.currentRelease.releaseNumber).toBe(1);
  });

  it("maps the server's 409 envelope to SettingsConflictError", async () => {
    server.use(
      http.put("/api/settings/draft", () =>
        HttpResponse.json(
          {
            code: "SETTINGS_CONFLICT",
            message: "Draft revision changed.",
            details: { field: "revision", expected: 2, actual: 5 },
          },
          { status: 409 },
        ),
      ),
    );

    const client = createSettingsClient();

    await expect(
      client.saveDraft({
        actor: "test",
        reason: "conflict probe",
        expectedRevision: 2,
        document: draftDocument,
      }),
    ).rejects.toBeInstanceOf(SettingsConflictError);
  });

  it("surfaces Ajv issues from a 422 as dotted field violations", async () => {
    server.use(
      http.put("/api/settings/draft", () =>
        HttpResponse.json(
          {
            code: "SETTINGS_VALIDATION_FAILED",
            message: "Settings document is invalid.",
            details: {
              issues: [
                {
                  instancePath: "/audio/masterGain",
                  keyword: "maximum",
                  message: "must be <= 1",
                },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );

    const client = createSettingsClient();

    try {
      await client.saveDraft({
        actor: "test",
        reason: "validation probe",
        expectedRevision: 2,
        document: draftDocument,
      });
      throw new Error("Expected saveDraft to reject.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SettingsApiError);
      if (!(error instanceof SettingsApiError)) {
        return;
      }
      expect(error.status).toBe(422);
      expect(error.violations).toEqual([
        {
          path: "audio.masterGain",
          message: "must be <= 1",
          code: "maximum",
        },
      ]);
    }
  });
});
