import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { getStoredSession } from "../auth-store";
import { RegisterPage } from "../RegisterPage";
import { adminUser, authResult } from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderRegister(route: string): ReturnType<typeof render> {
  return render(
    <I18nProvider lang="en">
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<RegisterPage />} path="/register" />
          <Route element={<LocationProbe />} path="/" />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const EMAIL = "newbie@muses.local";

describe("RegisterPage", () => {
  it("rejects a malformed email before calling the server", async () => {
    const user = userEvent.setup();
    renderRegister("/register");

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid email address.",
    );
  });

  it("walks the three steps: send code with devCode hint, register, done", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/auth/send-code", () =>
        HttpResponse.json({ status: "sent", devCode: "424242" }),
      ),
      http.post("/api/auth/register", () =>
        HttpResponse.json(
          authResult({ ...adminUser, email: EMAIL, displayName: "Newbie" }),
          { status: 201 },
        ),
      ),
    );

    renderRegister("/register?returnUrl=/");

    // Step 1: email.
    await user.type(screen.getByLabelText("Email"), EMAIL);
    await user.click(screen.getByRole("button", { name: "Send code" }));

    // Step 2: code + password + display name, with dev code surfaced.
    expect(
      await screen.findByText("Development code: 424242"),
    ).toBeInTheDocument();
    expect(screen.getByText("Code sent — check your inbox.")).toBeVisible();
    const resend = screen.getByRole("button", { name: /Resend in \d+s/ });
    expect(resend).toBeDisabled();

    await user.type(screen.getByLabelText("Verification code"), "424242");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.type(screen.getByLabelText("Display name (optional)"), "Newbie");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Step 3: done, signed in.
    expect(await screen.findByText("Account created")).toBeVisible();
    expect(
      screen.getByText("Welcome, Newbie — you are signed in."),
    ).toBeVisible();
    expect(getStoredSession()?.token).toBe("jwt-test-token");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/"),
    );
  });

  it("flags a short password locally before submitting", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/auth/send-code", () =>
        HttpResponse.json({ status: "sent" }),
      ),
    );

    renderRegister("/register");
    await user.type(screen.getByLabelText("Email"), EMAIL);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(
      await screen.findByLabelText("Verification code"),
      "000000",
    );
    await user.type(screen.getByLabelText("Password"), "123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passwords need at least 6 characters.",
    );
    expect(getStoredSession()).toBeNull();
  });

  it("surfaces a rejected code from the server", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/auth/send-code", () =>
        HttpResponse.json({ status: "sent" }),
      ),
      http.post("/api/auth/register", () =>
        HttpResponse.json(
          { code: "INVALID_CODE", message: "That code is not valid." },
          { status: 400 },
        ),
      ),
    );

    renderRegister("/register");
    await user.type(screen.getByLabelText("Email"), EMAIL);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(
      await screen.findByLabelText("Verification code"),
      "999999",
    );
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code is not valid.",
    );
    expect(screen.queryByText("Account created")).toBeNull();
  });
});
