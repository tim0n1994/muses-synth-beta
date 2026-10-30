import { expect, test } from "vitest";

import manifestText from "../../package.json?raw";

import { CONTRACT_DEPENDENCIES } from "./constants.js";

test("contract dependency metadata matches pinned package versions", () => {
  const manifest = JSON.parse(manifestText) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  for (const [name, dependency] of Object.entries(CONTRACT_DEPENDENCIES)) {
    expect(
      manifest.dependencies[name] ?? manifest.devDependencies[name],
      name,
    ).toBe(dependency.version);
  }
});
