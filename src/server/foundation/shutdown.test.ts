import { describe, expect, it, vi } from "vitest";

import { createShutdownController, type ShutdownLogger } from "./shutdown.js";

function logger(): ShutdownLogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("createShutdownController", () => {
  it("closes exactly once when shutdown is requested repeatedly", async () => {
    const close = vi.fn(async () => undefined);
    const controller = createShutdownController({
      close,
      logger: logger(),
      timeoutMs: 1000,
    });

    await Promise.all([
      controller.shutdown("SIGINT"),
      controller.shutdown("SIGTERM"),
    ]);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects when close exceeds the configured deadline", async () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn(() => new Promise<void>(() => undefined));
      const controller = createShutdownController({
        close,
        logger: logger(),
        timeoutMs: 100,
      });
      const result = controller.shutdown("SIGTERM");
      const rejection = expect(result).rejects.toThrow(
        /Shutdown exceeded 100ms/,
      );

      await vi.advanceTimersByTimeAsync(100);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
