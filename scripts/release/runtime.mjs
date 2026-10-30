import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardBundleDatabase } from "./data-guard.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 13) throw new Error("Requires Node >=22.13.0 <23");
if (!["linux", "darwin"].includes(process.platform)) {
  throw new Error(
    "Beta supports Linux/macOS only; Windows requires WSL2 Linux",
  );
}
process.chdir(root);
const command = process.argv[2];
if (command === "install") {
  // Do not let an older pnpm silently bootstrap a different version while
  // probing it; require the actual pinned executable to be available.
  const pnpmEnv = {
    ...process.env,
    npm_config_manage_package_manager_versions: "false",
  };
  let pnpm;
  try {
    pnpm = execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      timeout: 20_000,
      env: pnpmEnv,
    }).trim();
  } catch {
    throw new Error(
      "pnpm 11.4.0 was not available within 20 seconds; install it before retrying.",
    );
  }
  if (pnpm !== "11.4.0") throw new Error("Requires pnpm 11.4.0");
  execFileSync(
    "pnpm",
    [
      "install",
      "--prod",
      "--frozen-lockfile",
      ...(process.argv.includes("--offline") ? ["--offline"] : []),
    ],
    {
      cwd: root,
      stdio: "inherit",
      timeout: 180_000,
      env: pnpmEnv,
    },
  );
} else if (command === "start") {
  const port = process.env.MUSES_PORT ?? "3001";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("MUSES_PORT must be 1..65535");
  }
  // This launcher is deliberately the single-user, no-cloud local beta.
  // Do not inherit a developer's production DB, auth or provider settings.
  for (const key of Object.keys(process.env)) {
    if (/^(MUSES_|LLM_)/.test(key)) delete process.env[key];
  }
  const release = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
  const databasePath = guardBundleDatabase(root, release);
  Object.assign(process.env, {
    NODE_ENV: "production",
    MUSES_HOST: "127.0.0.1",
    MUSES_PORT: port,
    MUSES_SERVE_STATIC: "true",
    MUSES_STATIC_ROOT: join(root, "dist/web"),
    MUSES_DATABASE_PATH: databasePath,
    MUSES_LOG_PATH: join(root, ".muses/muses.log"),
    MUSES_AUTH_ENABLED: "false",
    MUSES_V07: "false",
    MUSES_V07_REPLAY: "false",
  });
  await import("./dist/server/index.js");
} else if (command === "watch") {
  // Run the compiled collector without requiring tsx or source files in the
  // bundle. Arguments (including optional --token-stdin) go to the real CLI.
  const { runCli } = await import("./dist/server/cli/main.js");
  process.exitCode = await runCli(["watch", ...process.argv.slice(3)]);
} else {
  throw new Error(
    "Usage: node runtime.mjs install|start|watch [watch options]",
  );
}
