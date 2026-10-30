import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { clearStoredSession } from "../auth-store";
import { server } from "./server";

const ORIGIN = "http://localhost:5173";

// jsdom's fetch cannot resolve relative URLs. Wrap it to prepend the origin.
const jsdomFetch = globalThis.fetch;

function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (typeof input === "string" && input.startsWith("/")) {
    input = ORIGIN + input;
  }
  return jsdomFetch(input, init);
}

beforeAll(() => {
  globalThis.fetch = patchedFetch;
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
  clearStoredSession();
});

afterAll(() => {
  globalThis.fetch = jsdomFetch;
  server.close();
});
