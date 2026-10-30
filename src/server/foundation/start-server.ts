import type { AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";

import { loadRuntimeConfig, type RuntimeConfig } from "./config.js";
import { createApp, type FoundationModule } from "./create-app.js";
import { buildRuntimeModules } from "./runtime-modules.js";
import {
  createShutdownController,
  registerProcessShutdownHandlers,
} from "./shutdown.js";

export interface StartServerOptions {
  readonly config?: RuntimeConfig;
  readonly modules?: readonly FoundationModule[];
}

export interface RunningServer {
  readonly address: AddressInfo;
  readonly app: FastifyInstance;
  readonly close: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const config = options.config ?? loadRuntimeConfig();
  // Caller-supplied modules win; otherwise build the full production graph
  // (context/belief/effects/policy/settings/llm) over one local SQLite
  // database. config.llm carries the optional gateway environment; null
  // leaves the LLM layer registered but unconfigured. The v0.7 access
  // policy travels with the built graph so the SPA shell and the bearer
  // gate judge the same allowlist.
  let runtimeClose: () => Promise<void> = async () => {};
  const app = await createApp({
    config,
    ...(options.modules === undefined
      ? await (async () => {
          const runtime = await buildRuntimeModules({ llmEnv: config.llm });
          runtimeClose = runtime.close;
          return { modules: runtime.modules, v07Access: runtime.v07Access };
        })()
      : { modules: options.modules }),
  });
  const signalHandlers: { remove: (() => void) | undefined } = {
    remove: undefined,
  };

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error: unknown) {
    await runtimeClose();
    await app.close();
    throw error;
  }

  const address = app.server.address();
  if (address === null || typeof address === "string") {
    await app.close();
    throw new Error("Fastify did not expose a TCP address after listen");
  }

  const shutdownController = createShutdownController({
    close: async () => {
      signalHandlers.remove?.();
      await app.close();
      await runtimeClose();
    },
    logger: app.log,
    timeoutMs: config.shutdownTimeoutMs,
  });
  signalHandlers.remove = registerProcessShutdownHandlers(shutdownController);

  app.log.info(
    {
      address: `http://${config.host}:${address.port}`,
      localOnly: true,
      mode: config.mode,
    },
    "Muses local authority started",
  );

  return {
    address,
    app,
    close: () => shutdownController.shutdown("SIGTERM"),
  };
}
