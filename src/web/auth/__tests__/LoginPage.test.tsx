import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { getStoredSession } from "../auth-store";
import { LoginPage } from "../LoginPage";
import { adminUser, authResult } from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderLogin(route: string): ReturnType<typeof render> {
  return render(
    <I18nProvider lang="en">
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<LoginPage />} path="/login" />
          <Route element={<LocationProbe />} path="/" />
          <Route element={<LocationProbe />} path="/settings" />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("LoginPage", () => {
  it("signs in, stores the session, and returns to the returnUrl", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(authResult(adminUser)),
      ),
    );

    renderLogin("/login?returnUrl=/settings");
    await user.type(screen.getByLabelText("Email"), "root@muses.local");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/settings"),
    );
    expect(getStoredSession()?.token).toBe("jwt-test-token");
  });

  it("falls back to / when the returnUrl is missing or off-site", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(authResult(adminUser)),
      ),
    );

    renderLogin("/login?returnUrl=https://evil.example");
    await user.type(screen.getByLabelText("Email"), "root@muses.local");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/"),
    );
  });

  it("shows the server error without navigating on bad credentials", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(
          {
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Wrong email or password.",
            },
          },
          { status: 401 },
        ),
      ),
    );

    renderLogin("/login?returnUrl=/settings");
    await user.type(screen.getByLabelText("Email"), "root@muses.local");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wrong email or password.",
    );
    expect(screen.queryByTestId("location")).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("links to the registration page", () => {
    renderLogin("/login");
    expect(
      screen.getByRole("link", { name: "No account yet? Create one" }),
    ).toHaveAttribute("href", "/register");
  });
});
