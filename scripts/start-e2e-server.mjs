import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Compile server build, then boot prod-mode server with isolated DB + log file.
// This script is spawned by Playwright's `webServer` option as
// `pnpm start:e2e`; it must keep the process alive (it spawns the real server
// as a child on this same process group by awaiting it).

const runId = mkdtempSync(join(tmpdir(), "muses-e2e-"));
const databasePath = join(runId, "muses.sqlite");
const logPath = join(runId, "muses.log");
const statePath = join(runId, "state.json");
mkdirSync(runId, { recursive: true });

writeFileSync(
  statePath,
  JSON.stringify({ databasePath, logPath, runId }, null, 2),
);

// Advertise paths to the Playwright test workers via the well-known file.
writeFileSync(
  resolve(process.cwd(), ".muses-e2e-state.json"),
  JSON.stringify({ databasePath, logPath, runId }, null, 2),
);

const { spawn } = await import("node:child_process");
const child = spawn(
  process.execPath,
  [resolve(process.cwd(), "dist/server/index.js")],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      MUSES_PORT: "4173",
      MUSES_SERVE_STATIC: "true",
      MUSES_DATABASE_PATH: databasePath,
      MUSES_LOG_PATH: logPath,
      MUSES_LOG_LEVEL: "info",
      MUSES_ALLOWED_ORIGINS: "http://127.0.0.1:4173,http://localhost:4173",
    },
    stdio: "inherit",
  },
);

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
