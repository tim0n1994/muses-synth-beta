import { describe, expect, it } from "vitest";

import { createIgnoreFilter } from "./ignore.js";

describe("ignore filter", () => {
  const shouldIgnore = createIgnoreFilter();

  it("ignores the directories that produce change storms", () => {
    for (const path of [
      "node_modules/react/index.js",
      ".git/objects/ab/cdef",
      "dist/server/index.js",
      "coverage/lcov-report/index.html",
      "test-results/spec/trace.zip",
      "src/.muses/muses.sqlite",
    ]) {
      expect(shouldIgnore(path), `${path} should be ignored`).toBe(true);
    }
  });

  it("ignores editor scratch and OS metadata", () => {
    for (const path of [
      ".DS_Store",
      "src/.a.ts.swp",
      "src/index.ts~",
      "src/4913",
      "src/.#index.ts",
    ]) {
      expect(shouldIgnore(path), `${path} should be ignored`).toBe(true);
    }
  });

  it("keeps real source changes", () => {
    for (const path of [
      "src/server/policy/engine.ts",
      "README.md",
      "docs/product/PRD-v0.3.md",
      "src/web/dashboard/Dashboard.tsx",
    ]) {
      expect(shouldIgnore(path), `${path} should be watched`).toBe(false);
    }
  });

  it("does not ignore a source file whose name merely contains a noisy word", () => {
    expect(shouldIgnore("src/distribution-helpers.ts")).toBe(false);
    expect(shouldIgnore("src/build-info.ts")).toBe(false);
  });

  it("appends caller-supplied directories", () => {
    const filter = createIgnoreFilter({ extraDirectories: ["fixtures"] });
    expect(filter("tests/fixtures/replay/a.jsonl")).toBe(true);
    expect(shouldIgnore("tests/fixtures/replay/a.jsonl")).toBe(false);
  });

  it("ignores an empty path rather than emitting for it", () => {
    expect(shouldIgnore("")).toBe(true);
  });
});
