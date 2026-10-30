// @vitest-environment node
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { parseWatchArgs } from "./args.js";
import { readSessionToken } from "./credentials.js";
import { buildEnvelope, EventEmitter } from "./emitter.js";

describe("collector security and delivery", () => {
  it("reads only bounded, single-line piped tokens", async () => {
    await expect(
      readSessionToken(Readable.from(["test.token.value\n"])),
    ).resolves.toBe("test.token.value");
    for (const value of ["", "a\nb", "secret\rheader", "a".repeat(8193)]) {
      await expect(readSessionToken(Readable.from([value]))).rejects.toThrow(
        "Cannot read session token",
      );
    }
    const terminal = Object.assign(Readable.from(["secret"]), { isTTY: true });
    await expect(readSessionToken(terminal)).rejects.toThrow("requires a pipe");
  });

  it("replaces the directory default and rejects secret-bearing URLs and argv without echo", () => {
    expect(parseWatchArgs([]).directory).toBe(".");
    expect(parseWatchArgs(["--dir", "project with spaces"]).directory).toBe(
      "project with spaces",
    );
    for (const server of [
      "http://user:secret@localhost",
      "http://localhost?token=secret",
      "http://localhost/#secret",
      "file:///secret",
    ]) {
      expect(() => parseWatchArgs(["--server", server])).toThrow(
        "without credentials",
      );
    }
    expect(() =>
      parseWatchArgs([
        "--token-stdin",
        "--server",
        "https://example.com",
        "--allow-remote",
      ]),
    ).toThrow("not loopback");
    expect(() => parseWatchArgs(["--password=secret"])).toThrow(
      "values are not echoed",
    );
  });

  it("keeps same-time and independent-run IDs distinct", () => {
    const ids = Array.from(
      { length: 100 },
      () =>
        buildEnvelope(
          { kind: "editor", action: "save" },
          1,
          "workspace:test",
          new Date(0),
        ).id,
    );
    expect(new Set(ids).size).toBe(100);
  });

  it("retries transient failures three times with the SAME ID and no secret output", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("secret-token network error"))
      .mockResolvedValue(new Response("secret-token", { status: 503 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onWarning = vi.fn();
    const emitter = new EventEmitter({
      serverUrl: "http://localhost:3001",
      subject: "workspace:test",
      token: "secret-token",
      fetchImpl,
      sleep,
      onWarning,
    });
    expect(await emitter.emit({ kind: "editor", action: "save" })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
    const bodies = fetchImpl.mock.calls.map((call) => call[1]?.body);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain("secret-token");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer secret-token" },
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403])(
    "stops permanently on HTTP %i without retry, login or response disclosure",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("secret-token", { status }));
      const onAuthFailure = vi.fn();
      const onWarning = vi.fn();
      const emitter = new EventEmitter({
        serverUrl: "http://localhost:3001",
        subject: "workspace:test",
        fetchImpl,
        onAuthFailure,
        onWarning,
      });
      expect(await emitter.emit({ kind: "editor", action: "save" })).toBe(
        false,
      );
      expect(await emitter.emit({ kind: "session", status: "active" })).toBe(
        false,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(onWarning.mock.calls)).not.toContain(
        "secret-token",
      );
    },
  );

  it("accepts an anonymous local success without Authorization", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const emitter = new EventEmitter({
      serverUrl: "http://localhost:3001",
      subject: "workspace:test",
      fetchImpl,
    });
    expect(await emitter.emit({ kind: "editor", action: "save" })).toBe(true);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "authorization",
    );
  });
});
