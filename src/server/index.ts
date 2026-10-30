import { startServer } from "./foundation/start-server.js";

try {
  await startServer();
} catch (error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  console.error(`[muses] startup failed: ${message}`);
  process.exitCode = 1;
}
