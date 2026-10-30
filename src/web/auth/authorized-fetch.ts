import { getStoredToken } from "./auth-store.js";

/**
 * Same-origin /api fetch that carries the stored bearer token when present.
 * Pre-auth data clients (dashboard snapshot, settings workspace) funnel their
 * requests through injectable fetch implementations; wiring this wrapper as
 * their default keeps every existing call site working unchanged once the
 * auth gate is enabled, and is a no-op when nobody is signed in.
 */
export function createAuthorizedFetch(): typeof fetch {
  return (input, init) => {
    const token = getStoredToken();
    if (token === null) {
      return globalThis.fetch(input, init);
    }
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const sameOriginApi =
      typeof location !== "undefined" &&
      (url.startsWith("/api") || url.startsWith(`${location.origin}/api`));
    if (!sameOriginApi) {
      return globalThis.fetch(input, init);
    }
    const headers = new Headers(init?.headers);
    if (input instanceof Request) {
      input.headers.forEach((value, key) => {
        if (!headers.has(key)) headers.set(key, value);
      });
    }
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return globalThis.fetch(input, { ...init, headers });
  };
}
