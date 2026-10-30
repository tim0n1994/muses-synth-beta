import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { setUnauthorizedHandler } from "../api-client";
import { setStoredSession } from "../auth-store";
import { UsersAdminView } from "../UsersAdminView";
import {
  adminUser,
  authResult,
  disabledUser,
  memberUser,
} from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

let restoreUnauthorized: () => void;

beforeEach(() => {
  // The failed-load test triggers the 401 interceptor; keep it inert in jsdom.
  restoreUnauthorized = setUnauthorizedHandler(vi.fn());
});

afterEach(() => {
  restoreUnauthorized();
});

function renderAdmin(): ReturnType<typeof render> {
  return render(
    <I18nProvider lang="en">
      <MemoryRouter>
        <UsersAdminView />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mockUsers(): void {
  server.use(
    http.get("/api/admin/users", () =>
      HttpResponse.json({ users: [adminUser, memberUser, disabledUser] }),
    ),
  );
}

async function findRow(email: string): Promise<HTMLElement> {
  const row = (await screen.findByText(email)).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe("UsersAdminView", () => {
  it("renders the roster with stats, roles, status, and dates", async () => {
    mockUsers();
    renderAdmin();

    expect(await screen.findByText("root@muses.local")).toBeVisible();
    expect(screen.getByText("ada@muses.local")).toBeVisible();
    expect(screen.getByText("eve@muses.local")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "User administration" }),
    ).toBeVisible();
    expect(screen.getByText("3")).toBeInTheDocument(); // total stat
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
    // "Disabled" appears both as the stat label and as Eve's status badge.
    expect(screen.getAllByText("Disabled").length).toBeGreaterThanOrEqual(2);
  });

  it("deactivates a user through PATCH and refreshes the row", async () => {
    mockUsers();
    const user = userEvent.setup();
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      http.patch("/api/admin/users/:id", async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          user: { ...memberUser, isActive: false },
        });
      }),
    );

    renderAdmin();
    const row = await findRow("ada@muses.local");
    await user.click(within(row).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => expect(patchBody).toEqual({ isActive: false }));
    await waitFor(() =>
      expect(within(row).getByText("Disabled")).toBeInTheDocument(),
    );
  });

  it("deletes a user only after the inline confirmation", async () => {
    mockUsers();
    const user = userEvent.setup();
    let deletedId = "";
    server.use(
      http.delete("/api/admin/users/:id", ({ params }) => {
        deletedId = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderAdmin();
    const row = await findRow("eve@muses.local");

    await user.click(within(row).getByRole("button", { name: "Delete" }));
    expect(
      within(row).getByRole("button", { name: "Confirm delete" }),
    ).toBeVisible();

    await user.click(
      within(row).getByRole("button", { name: "Confirm delete" }),
    );
    await waitFor(() => expect(deletedId).toBe("u-eve"));
    await waitFor(() =>
      expect(screen.queryByText("eve@muses.local")).toBeNull(),
    );
  });

  it("protects the signed-in admin's own row", async () => {
    mockUsers();
    setStoredSession(authResult(adminUser));
    renderAdmin();

    const row = await findRow("root@muses.local");
    expect(
      within(row).getByRole("button", { name: "Deactivate" }),
    ).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("offers a retry after a failed load", async () => {
    server.use(
      http.get("/api/admin/users", () =>
        HttpResponse.json(
          { error: { code: "AUTH_REQUIRED", message: "Admins only." } },
          { status: 401 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderAdmin();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session has expired — sign in again.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();

    mockUsers();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("root@muses.local")).toBeVisible();
  });
});
