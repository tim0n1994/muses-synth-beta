import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEFAULT_ORIGIN = "http://127.0.0.1:4173";

function readE2eRunState(): { logPath?: string } {
  const statePath = resolve(process.cwd(), ".muses-e2e-state.json");
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as {
      logPath?: string;
    };
  } catch {
    return {};
  }
}

export function assertLoopbackUrl(rawUrl: string, label: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "ws:") {
    throw new Error(`${label} must use http or ws.`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must be loopback; refusing ${parsed.hostname}.`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(`${label} must not contain credentials.`);
  }
  return parsed;
}

export function getBaseUrl(): string {
  const value = process.env.MUSES_BASE_URL ?? "http://127.0.0.1:4173";
  assertLoopbackUrl(value, "MUSES_BASE_URL");
  return value.replace(/\/$/u, "");
}

export function getWebUrl(): string {
  const value = process.env.MUSES_WEB_URL ?? getBaseUrl();
  assertLoopbackUrl(value, "MUSES_WEB_URL");
  return value.replace(/\/$/u, "");
}

export function getOrigin(): string {
  return process.env.MUSES_ORIGIN ?? DEFAULT_ORIGIN;
}

export function getLogPath(): string {
  const value = process.env.MUSES_TEST_LOG_PATH ?? readE2eRunState().logPath;
  if (value === undefined || value.length === 0) {
    throw new Error(
      "MUSES_HOOK_MISSING: MUSES_TEST_LOG_PATH is required (or provide .muses-e2e-state.json produced by scripts/start-e2e-server.mjs).",
    );
  }
  return value;
}
