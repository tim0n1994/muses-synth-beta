import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as FeatureFlagsModule from "../../foundation/feature-flags";
import { I18nProvider } from "../../i18n";
import { LoginPage } from "../LoginPage";
import { adminUser, authResult } from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

/**
 * Round-2 per-user allowlist: the route table is decided at boot. When the
 * server answers the signed-in account a different v0.7 surface than the
 * signed-out boot mounted, LoginPage must boot again (full navigation)
 * instead of a client-side route change that would keep the stale table.
 * jsdom does not implement navigation, so the reboot seam is mocked.
 */
const { rebootInto } = vi.hoisted(() => ({ rebootInto: vi.fn() }));
vi.mock("../../foundation/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof FeatureFlagsModule>();
  return { ...actual, rebootInto };
});

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
          <Route element={<LocationProbe />} path="/self-track" />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function signIn(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "jc@muses.local");
  await user.type(screen.getByLabelText("Password"), "correct-horse");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginPage x v0.7 per-user surface", () => {
  afterEach(() => {
    rebootInto.mockClear();
  });

  it("reboots into the return URL when the account is admitted to a surface the boot did not mount", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(authResult(adminUser)),
      ),
      http.get("/api/v1/features", () =>
        HttpResponse.json({ selfTrack: true, replay: false }),
      ),
    );

    renderLogin("/login?returnUrl=/self-track");
    await signIn();

    await waitFor(() => expect(rebootInto).toHaveBeenCalledWith("/self-track"));
    // No client-side navigation happened: the login page is still mounted.
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("keeps the client-side navigation when the account is concealed (default 404 probe)", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(authResult(adminUser)),
      ),
    );

    renderLogin("/login?returnUrl=/self-track");
    await signIn();

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/self-track"),
    );
    expect(rebootInto).not.toHaveBeenCalled();
  });
});
