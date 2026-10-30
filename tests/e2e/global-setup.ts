import type { FullConfig } from "@playwright/test";
import { startTestRuntime } from "../../scripts/lib/test-runtime.mjs";

export default async function globalSetup(
  _config: FullConfig,
): Promise<() => Promise<void>> {
  const runtime = await startTestRuntime();
  process.env.MUSES_BASE_URL = runtime.baseUrl;
  process.env.MUSES_WEB_URL = runtime.webUrl;
  if (runtime.logPath !== undefined)
    process.env.MUSES_TEST_LOG_PATH = runtime.logPath;
  return async () => await runtime.stop();
}
