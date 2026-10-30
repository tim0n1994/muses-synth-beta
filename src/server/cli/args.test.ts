import { describe, expect, it } from "vitest";

import {
  ArgumentError,
  DEFAULT_WATCH_ARGS,
  parseDuration,
  parseWatchArgs,
} from "./args.js";

describe("watch argument parsing", () => {
  it("falls back to safe local defaults", () => {
    const args = parseWatchArgs([]);

    expect(args.serverUrl).toBe("http://127.0.0.1:3001");
    expect(args.includePaths).toBe(false);
    expect(args.debounceMs).toBe(DEFAULT_WATCH_ARGS.debounceMs);
  });

  it("accepts human durations", () => {
    expect(parseDuration("500", "--x")).toBe(500);
    expect(parseDuration("30s", "--x")).toBe(30_000);
    expect(parseDuration("5m", "--x")).toBe(300_000);
    expect(parseDuration("1h", "--x")).toBe(3_600_000);
    expect(() => parseDuration("soon", "--x")).toThrow(ArgumentError);
  });

  it("refuses a non-loopback server without an explicit opt-in", () => {
    // Muses has no authentication; a stream of developer activity must not
    // leave the machine by accident.
    expect(() => parseWatchArgs(["--server", "https://example.com"])).toThrow(
      ArgumentError,
    );

    expect(
      parseWatchArgs(["--server", "https://example.com", "--allow-remote"])
        .serverUrl,
    ).toBe("https://example.com");
  });

  it("accepts every loopback spelling", () => {
    for (const url of [
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://[::1]:3001",
    ]) {
      expect(parseWatchArgs(["--server", url]).serverUrl).toBe(url);
    }
  });

  it("rejects an inactive threshold that is not after the idle threshold", () => {
    expect(() =>
      parseWatchArgs(["--idle-after", "10m", "--inactive-after", "5m"]),
    ).toThrow(ArgumentError);
  });

  it("collects repeated --ignore values", () => {
    const args = parseWatchArgs(["--ignore", "tmp", "--ignore", "fixtures"]);
    expect(args.extraIgnored).toEqual(["tmp", "fixtures"]);
  });

  it("ignores the bare -- that pnpm forwards", () => {
    // `pnpm watch -- --dir foo` arrives as ["--", "--dir", "foo"].
    expect(parseWatchArgs(["--", "--dir", "foo"]).directory).toBe("foo");
  });

  it("rejects unknown options and missing values instead of guessing", () => {
    expect(() => parseWatchArgs(["--nope"])).toThrow(ArgumentError);
    expect(() => parseWatchArgs(["--dir"])).toThrow(ArgumentError);
    expect(() => parseWatchArgs(["--dir", "--server"])).toThrow(ArgumentError);
    expect(() => parseWatchArgs(["--max-events-per-minute", "0"])).toThrow(
      ArgumentError,
    );
  });
});
