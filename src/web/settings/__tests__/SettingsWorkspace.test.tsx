// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { SettingsWorkspace } from "../SettingsWorkspace";
import type { SettingsDocument } from "../model/document";
import { currentRelease, draft } from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

describe("SettingsWorkspace", () => {
  it("renders the document's own sections and separates draft from published", async () => {
    render(<SettingsWorkspace />);

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    for (const label of [
      "Appearance",
      "Belief",
      "Decision",
      "Signals",
      "Audio",
      "Privacy",
      "AI narration",
      "Dashboard",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("Draft — not active")).toBeInTheDocument();
    expect(screen.getByText("Published — active")).toBeInTheDocument();
    expect(screen.getByText("revision 2")).toBeInTheDocument();
    expect(
      within(
        document.querySelector(".settings-version-published") as HTMLElement,
      ).getByText("r1"),
    ).toBeInTheDocument();
  });

  it("saves an edited document against the current draft revision", async () => {
    const user = userEvent.setup();
    let receivedRevision = 0;
    let receivedTheme = "";
    server.use(
      http.put("/api/settings/draft", async ({ request }) => {
        const body = (await request.json()) as {
          expectedRevision: number;
          document: SettingsDocument;
        };
        receivedRevision = body.expectedRevision;
        receivedTheme = body.document.appearance.theme;
        return HttpResponse.json({
          ...draft,
          revision: body.expectedRevision + 1,
          document: body.document,
        });
      }),
    );

    render(<SettingsWorkspace />);
    const theme = await screen.findByLabelText("Theme");
    await user.selectOptions(theme, "light");
    expect(screen.getByText("Unsaved local edits")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(screen.getByText(/Draft revision 3 saved/)).toBeInTheDocument(),
    );
    expect(receivedRevision).toBe(2);
    expect(receivedTheme).toBe("light");
    expect(screen.getByText("Draft saved on server")).toBeInTheDocument();
  });

  it("exposes only implemented privacy controls and preserves unsupported values", async () => {
    const user = userEvent.setup();
    let saved: SettingsDocument | undefined;
    server.use(
      http.put("/api/settings/draft", async ({ request }) => {
        const body = (await request.json()) as { document: SettingsDocument };
        saved = body.document;
        return HttpResponse.json({
          ...draft,
          revision: 3,
          document: body.document,
        });
      }),
    );
    render(<SettingsWorkspace />);
    await user.click(await screen.findByRole("button", { name: /Signals/ }));
    expect(
      screen.getByText(
        /Signal enablement, weights and raw-payload switches are not enforced/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Retain raw payload"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Privacy/ }));
    expect(
      screen.getByText(/Published changes affect new events only/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Session history retention (days)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Excluded applications"),
    ).not.toBeInTheDocument();
    const retention = screen.getByLabelText("Raw event retention (hours)");
    await user.clear(retention);
    await user.type(retention, "12");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saved?.privacy.rawEventRetentionHours).toBe(12));
    expect(saved?.signals).toEqual(draft.document.signals);
    expect(saved?.privacy.excludedApplications).toEqual(
      draft.document.privacy.excludedApplications,
    );
    expect(saved?.privacy.sessionHistoryRetentionDays).toBe(
      draft.document.privacy.sessionHistoryRetentionDays,
    );
  });

  it("edits and saves the optional AI narration section", async () => {
    const user = userEvent.setup();
    let receivedLlm: unknown = null;
    server.use(
      http.put("/api/settings/draft", async ({ request }) => {
        const body = (await request.json()) as {
          expectedRevision: number;
          document: SettingsDocument;
        };
        receivedLlm = body.document.llm;
        return HttpResponse.json({
          ...draft,
          revision: body.expectedRevision + 1,
          document: body.document,
        });
      }),
    );

    render(<SettingsWorkspace />);
    await user.click(
      await screen.findByRole("button", { name: /AI narration/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "AI narration" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Gateway address and credentials come from the deployment environment and are never stored in settings. Generated text is display-only.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("Enable AI narration (optional)"));
    const model = screen.getByLabelText("Model alias");
    await user.clear(model);
    await user.type(model, "gateway-alias");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(screen.getByText(/Draft revision 3 saved/)).toBeInTheDocument(),
    );
    expect(receivedLlm).toEqual({ enabled: true, model: "gateway-alias" });
  });

  it("surfaces server field violations and jumps to the owning section", async () => {
    const user = userEvent.setup();
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

    render(<SettingsWorkspace />);
    const theme = await screen.findByLabelText("Theme");
    await user.selectOptions(theme, "light");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await user.click(screen.getByRole("button", { name: /Audio/ }));
    expect(
      await screen.findByRole("heading", { name: "Audio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("must be <= 1")).toBeInTheDocument();
  });

  it("previews against the published release before allowing publish", async () => {
    const user = userEvent.setup();
    const publishSpy = vi.fn();
    server.use(
      http.post("/api/settings/publish", async ({ request }) => {
        publishSpy(await request.json());
        return HttpResponse.json({
          release: { ...currentRelease, id: "release-2", releaseNumber: 2 },
          draft: { ...draft, revision: 3 },
        });
      }),
    );

    render(<SettingsWorkspace />);
    await screen.findByRole("heading", { name: "Appearance" });

    // Publish is gated until a preview exists for the saved draft.
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Preview draft" }));
    expect(
      await screen.findByText("Draft preview — not active"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The published release remains/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(publishSpy).toHaveBeenCalledTimes(1));
    expect(publishSpy.mock.calls[0]?.[0]).toMatchObject({
      expectedDraftRevision: 2,
      expectedDraftChecksum: draft.checksum,
    });
  });

  it("requires the destructive rollback phrase and calls rollback", async () => {
    const user = userEvent.setup();
    const rollbackSpy = vi.fn();
    const olderRelease = {
      ...currentRelease,
      id: "release-0",
      releaseNumber: 0,
      publishedAt: "2026-07-28T18:00:00.000Z",
    };
    server.use(
      http.get("/api/settings/releases", () =>
        HttpResponse.json([currentRelease, olderRelease]),
      ),
      http.post(
        "/api/settings/releases/:releaseId/rollback",
        async ({ params, request }) => {
          rollbackSpy({
            releaseId: params.releaseId,
            body: await request.json(),
          });
          return HttpResponse.json({
            release: {
              ...currentRelease,
              id: "release-3",
              releaseNumber: 3,
              rollbackOfReleaseId: String(params.releaseId),
            },
            draft: { ...draft, revision: 4 },
          });
        },
      ),
    );

    render(<SettingsWorkspace />);
    await user.click(
      await screen.findByRole("button", { name: "Roll back to this release" }),
    );
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Roll back",
    });
    expect(confirmButton).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Confirmation phrase"),
      "ROLLBACK",
    );
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => expect(rollbackSpy).toHaveBeenCalledTimes(1));
    expect(rollbackSpy.mock.calls[0]?.[0]).toMatchObject({
      releaseId: "release-0",
      body: {
        expectedCurrentReleaseId: currentRelease.id,
        expectedDraftRevision: draft.revision,
      },
    });
  });

  it("offers a reload instead of overwriting on a server conflict", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/api/settings/draft", () =>
        HttpResponse.json(
          {
            code: "SETTINGS_CONFLICT",
            message: "Draft revision changed.",
            details: { field: "revision", expected: 2, actual: 9 },
          },
          { status: 409 },
        ),
      ),
    );

    render(<SettingsWorkspace />);
    const theme = await screen.findByLabelText("Theme");
    await user.selectOptions(theme, "light");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Nothing was overwritten/),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /Reload from server/ }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Reloaded the server draft/)).toBeInTheDocument(),
    );
  });

  it("reports an unreachable settings server instead of rendering an empty shell", async () => {
    server.use(
      http.get("/api/settings", () =>
        HttpResponse.json(
          { code: "NOT_FOUND", message: "Route not found." },
          { status: 404 },
        ),
      ),
    );

    render(<SettingsWorkspace />);

    expect(
      await screen.findByRole("heading", { name: "Settings unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
