import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Contract tests live next to whichever side owns the boundary. The unit
    // config excludes the same glob, so nothing runs twice.
    include: ["src/**/*.contract.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
