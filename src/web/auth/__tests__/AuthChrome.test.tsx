import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import {
  setUnauthorizedHandler,
  type UnauthorizedHandler,
} from "../api-client";
import { AuthChrome } from "../AuthChrome";
import { getStoredSession, setStoredSession } from "../auth-store";
import { adminUser, authResult, memberUser } from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderChrome(element: React.ReactElement): ReturnType<typeof render> {
  return render(
    <I18nProvider lang="en">
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={element} path="/" />
          <Route element={<LocationProbe />} path="/login" />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("AuthChrome", () => {
  let unauthorizedPaths: string[];
  let restore: () => void;

  beforeEach(() => {
    unauthorizedPaths = [];
    const handler: UnauthorizedHandler = (path) => {
      unauthorizedPaths.push(path);
    };
    restore = setUnauthorizedHandler(handler);
  });

  afterEach(() => {
    restore();
  });

  it("stays open when the backend answers without auth (404)", async () => {
    renderChrome(
      <AuthChrome>
        <p>dashboard content</p>
      </AuthChrome>,
    );

    expect(await screen.findByText("dashboard content")).toBeVisible();
    expect(unauthorizedPaths).toEqual([]);
  });

  it("stays open when the probe cannot reach the server", async () => {
    server.use(http.get("/api/auth/me", () => HttpResponse.error()));
    renderChrome(
      <AuthChrome>
        <p>dashboard content</p>
      </AuthChrome>,
    );

    expect(await screen.findByText("dashboard content")).toBeVisible();
  });

  it("holds the checking state on a 401 instead of flashing content", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json(
          { error: { code: "AUTH_REQUIRED", message: "Sign in first." } },
          { status: 401 },
        ),
      ),
    );
    renderChrome(
      <AuthChrome>
        <p>dashboard content</p>
      </AuthChrome>,
    );

    expect(await screen.findByText("Checking your session…")).toBeVisible();
    await waitFor(() => expect(unauthorizedPaths).toEqual(["/api/auth/me"]));
    expect(screen.queryByText("dashboard content")).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("renders the session bar with an admin link for admins, and signs out", async () => {
    setStoredSession(authResult(adminUser));
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ user: adminUser })),
    );
    const user = userEvent.setup();
    renderChrome(
      <AuthChrome>
        <p>dashboard content</p>
      </AuthChrome>,
    );

    expect(await screen.findByText("root@muses.local")).toBeVisible();
    expect(screen.getByRole("link", { name: "User admin" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(screen.getByText("dashboard content")).toBeVisible();
    expect(getStoredSession()?.user.email).toBe("root@muses.local");

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/login"),
    );
    expect(getStoredSession()).toBeNull();
  });

  it("hides the admin link for regular users", async () => {
    setStoredSession(authResult(memberUser));
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ user: memberUser })),
    );
    renderChrome(
      <AuthChrome>
        <p>dashboard content</p>
      </AuthChrome>,
    );

    expect(await screen.findByText("ada@muses.local")).toBeVisible();
    expect(screen.queryByRole("link", { name: "User admin" })).toBeNull();
  });

  it("denies the admin surface to non-admin sessions", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ user: memberUser })),
    );
    renderChrome(
      <AuthChrome requireAdmin>
        <p>admin content</p>
      </AuthChrome>,
    );

    expect(await screen.findByText("Admins only")).toBeVisible();
    expect(screen.queryByText("admin content")).toBeNull();
  });

  it("keeps a persisted admin session without an extra probe round trip", async () => {
    setStoredSession(authResult(adminUser));
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ user: adminUser })),
    );
    renderChrome(
      <AuthChrome requireAdmin>
        <p>admin content</p>
      </AuthChrome>,
    );

    expect(await screen.findByText("admin content")).toBeVisible();
  });
});
