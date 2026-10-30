export type ShutdownReason = NodeJS.Signals | "startup-error";

export interface ShutdownLogger {
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
  warn(bindings: Readonly<Record<string, unknown>>, message: string): void;
}

export interface ShutdownController {
  readonly shutdown: (reason: ShutdownReason) => Promise<void>;
}

export function createShutdownController(options: {
  close: () => Promise<void>;
  logger: ShutdownLogger;
  timeoutMs: number;
}): ShutdownController {
  let currentShutdown: Promise<void> | undefined;

  const runShutdown = async (reason: ShutdownReason): Promise<void> => {
    options.logger.info({ reason }, "Shutdown requested");

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Shutdown exceeded ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      timer.unref();
    });

    try {
      await Promise.race([options.close(), timeout]);
      options.logger.info({ reason }, "Shutdown complete");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown shutdown error";
      options.logger.error({ message, reason }, "Shutdown failed");
      throw error;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };

  return {
    shutdown(reason) {
      currentShutdown ??= runShutdown(reason);
      return currentShutdown;
    },
  };
}

export function registerProcessShutdownHandlers(
  controller: ShutdownController,
  target: NodeJS.Process = process,
): () => void {
  const listeners = new Map<NodeJS.Signals, () => void>();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const listener = (): void => {
      void controller.shutdown(signal).catch(() => {
        target.exitCode = 1;
      });
    };
    listeners.set(signal, listener);
    target.once(signal, listener);
  }

  return () => {
    for (const [signal, listener] of listeners) {
      target.off(signal, listener);
    }
  };
}
