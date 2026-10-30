import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { apiRequest, asRecord } from "../helpers/api-client.js";
import { poll } from "../helpers/poll.js";
import { getBaseUrl } from "../helpers/test-config.js";

const WATCH_SOURCE = "urn:muses:watch";

/**
 * The dogfood path: `muses watch` observes a real directory and the running
 * server ingests what it produces.
 *
 * Ordering contract: this file drives the shared local server and is named to
 * sort after `belief-transition.spec.ts`, which requires a virgin belief
 * state. Belief *movement* from these signals is covered by the projector unit
 * tests and the replay spec; asserting it here would mean waiting out the
 * 90-second sustained-editing span for no extra confidence.
 */
test("muses watch turns real file changes into ingested context events", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "muses-watch-"));
  let child: ChildProcess | null = null;

  try {
    child = spawn(
      // `.bin/tsx` is an executable shim, not a JS entry point, so it is the
      // command rather than an argument to node.
      resolve(process.cwd(), "node_modules/.bin/tsx"),
      [
        resolve(process.cwd(), "src/server/cli/main.ts"),
        "watch",
        "--dir",
        workspace,
        "--server",
        getBaseUrl(),
        "--debounce",
        "200",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let childOutput = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      childOutput += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      childOutput += chunk.toString("utf8");
    });

    const exited = new Promise<never>((_resolve, reject) => {
      child?.once("exit", (code) => {
        reject(
          new Error(
            `muses watch exited early with code ${String(code)}: ${childOutput}`,
          ),
        );
      });
    });

    // Give fs.watch time to attach before touching anything.
    await Promise.race([
      new Promise((resolveWait) => setTimeout(resolveWait, 1_500)),
      exited,
    ]);

    for (let index = 0; index < 3; index += 1) {
      writeFileSync(
        join(workspace, `note-${index}.ts`),
        `export const x = ${index};\n`,
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    }

    const page = await poll(
      async () =>
        await apiRequest(
          `/api/v1/context/events?source=${encodeURIComponent(WATCH_SOURCE)}&limit=50`,
          { method: "GET" },
        ),
      (response) => {
        if (response.status !== 200) {
          return false;
        }
        const items = asRecord(response.json, "event page").items;
        return Array.isArray(items) && items.length > 0;
      },
      20_000,
    );

    const items = asRecord(page.json, "event page").items as Array<
      Record<string, unknown>
    >;
    expect(items.length).toBeGreaterThan(0);

    const types = new Set(items.map((item) => String(item.type)));
    expect(types.has("muses.editor.activity")).toBe(true);
    // The session becomes active the moment the first edit lands, so the
    // dashboard can distinguish "quiet" from "not being watched at all".
    expect(types.has("muses.session.activity")).toBe(true);

    for (const item of items) {
      expect(item.source).toBe(WATCH_SOURCE);
      // No path is sent unless --include-paths was passed.
      const data = asRecord(item.data, "event data");
      expect(data.path).toBeUndefined();
    }
  } finally {
    child?.kill("SIGTERM");
    rmSync(workspace, { recursive: true, force: true });
  }
});
