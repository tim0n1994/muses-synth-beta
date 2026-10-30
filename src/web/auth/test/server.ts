import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/**
 * Default handler set: a backend built WITHOUT auth answers /api/auth/me
 * with 404 — the AuthChrome "open" path. Every other endpoint is mocked
 * per-test via server.use so unhandled requests stay loud.
 */
export const handlers = [
  http.get("/api/auth/me", () =>
    HttpResponse.json(
      { error: { code: "NOT_FOUND", message: "auth is not enabled" } },
      { status: 404 },
    ),
  ),
  // The v0.7 surface probe a sign-in makes: by default this account is
  // not admitted (concealment 404), so LoginPage keeps its client-side
  // navigation. Tests of the reboot path override it with 200.
  http.get("/api/v1/features", () =>
    HttpResponse.json(
      { error: { code: "NOT_FOUND", message: "Route not found" } },
      { status: 404 },
    ),
  ),
];

export const server = setupServer(...handlers);
