import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:5173",
      },
    },
    exclude: ["src/**/*.contract.test.ts", "node_modules/**", "dist/**"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: false,
    restoreMocks: true,
    setupFiles: ["./src/web/foundation/test-setup.ts"],
  },
});
