import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest does not enable Testing Library's automatic cleanup by default.
// Clear mounted trees between tests so queries cannot see stale dashboards.
afterEach(() => {
  cleanup();
});
