import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";

import { enabledAuthConfig, registerViaApi } from "../../auth/test-support.js";
import { openDatabase } from "../../db/index.js";
import { loadRuntimeConfig } from "../../foundation/config.js";
import { createApp } from "../../foundation/create-app.js";
import { buildRuntimeModules } from "../../foundation/runtime-modules.js";
import { SELF_TRACK_BUCKETS } from "../../library/license-gate.js";

/**
 * Shared harness for wiring-level replay tests: the REAL production graph
 * (buildRuntimeModules + createApp, the exact catalog->planner injection
 * runtime-modules.ts performs) over one SQLite file that survives across
 * two process "lifetimes" — user ids are minted by the register API, so the
 * MUSES_V07_USERS allowlist is only known after the first open (the
 * production sequence: register, set the allowlist, restart).
 */

export const ORIGIN = "http://127.0.0.1:3001";

const FLAG_KEYS = [
  "MUSES_V07",
  "MUSES_V07_REPLAY",
  "MUSES_V07_USERS",
  "MUSES_DATABASE_PATH",
] as const;
type FlagKey = (typeof FLAG_KEYS)[number];
type Flags = Partial<Record<Exclude<FlagKey, "MUSES_DATABASE_PATH">, string>>;

export interface Opened {
  readonly app: FastifyInstance;
  readonly close: () => Promise<void>;
}

export function createWorkspace(): {
  readonly databasePath: string;
  open(flags: Flags): Promise<Opened>;
  /** Removes the temp workspace; call after every open() has closed. */
  destroy(): void;
} {
  const directory = mkdtempSync(join(tmpdir(), "muses-replay-wiring-"));
  const databasePath = join(directory, "muses.sqlite");
  return {
    databasePath,
    destroy() {
      rmSync(directory, { recursive: true, force: true });
    },
    async open(flags) {
      const saved: Partial<Record<FlagKey, string | undefined>> = {};
      for (const key of FLAG_KEYS) {
        saved[key] = process.env[key];
      }
      process.env.MUSES_DATABASE_PATH = databasePath;
      for (const key of [
        "MUSES_V07",
        "MUSES_V07_REPLAY",
        "MUSES_V07_USERS",
      ] as const) {
        const value = flags[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      const runtime = await buildRuntimeModules({
        auth: enabledAuthConfig({ MUSES_ADMIN_EMAILS: "root@example.com" }),
      });
      const app = await createApp({
        config: loadRuntimeConfig({
          MUSES_ALLOWED_ORIGINS: ORIGIN,
          NODE_ENV: "production",
          // These wiring tests exercise the API graph. Keep them independent
          // of the optional Vite artifact so a clean checkout can run
          // `pnpm test` before a production build exists.
          MUSES_SERVE_STATIC: "false",
          ...(flags.MUSES_V07 === undefined
            ? {}
            : { MUSES_V07: flags.MUSES_V07 }),
          ...(flags.MUSES_V07_REPLAY === undefined
            ? {}
            : { MUSES_V07_REPLAY: flags.MUSES_V07_REPLAY }),
          ...(flags.MUSES_V07_USERS === undefined
            ? {}
            : { MUSES_V07_USERS: flags.MUSES_V07_USERS }),
        }),
        logger: false,
        modules: runtime.modules,
        v07Access: runtime.v07Access,
      });
      let closed = false;
      const close = async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        await app.close();
        await runtime.close();
        for (const key of FLAG_KEYS) {
          const value = saved[key];
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      };
      return { app, close };
    },
  };
}

/**
 * The production self-pool shape (read-only SQL against the live DB on
 * 2026-10-21: 9 buckets x 4 tracks, audio_path "self/<bucket>/<id>.opus",
 * durations 107-406s). Returns the seeded ids per LIBRARY bucket for
 * membership assertions.
 */
export function seedSelfPool(
  databasePath: string,
): Readonly<Record<string, readonly string[]>> {
  const opened = openDatabase(databasePath);
  const hex = "a".repeat(64);
  const insert = opened.connection.prepare(`
    INSERT INTO library_tracks (
      id, track_pool, bucket, title, author, source, source_url, audio_url,
      audio_path, license, license_url, license_evidence_url, snapshot_path,
      snapshot_sha256, content_sha256, duration_seconds, size_bytes,
      bitrate_kbps, mime_type, features_json, bucket_rule_version,
      pro_registered, ingested_at
    ) VALUES (
      ?, 'self', ?, ?, 'Pilot Author', 'fma', ?, ?,
      ?, 'CC-BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
      'https://example.org/license', ?, ?, ?, 240, 1000, 96, 'audio/ogg',
      '{}', 'v1', 0, '2026-10-20T00:00:00.000Z'
    )
  `);
  const seeded: Record<string, string[]> = {};
  for (const [bucketIndex, bucket] of SELF_TRACK_BUCKETS.entries()) {
    seeded[bucket] = [];
    for (let n = 1; n <= 4; n += 1) {
      const id = `w${bucketIndex}${n}${"0".repeat(13)}`.slice(0, 16);
      insert.run(
        id,
        bucket,
        `Track ${bucket} ${n}`,
        `https://example.org/${bucket}/${n}`,
        `/library/self/${bucket}/${id}.opus`,
        `self/${bucket}/${id}.opus`,
        `snapshots/${id}.json`,
        hex,
        hex,
      );
      seeded[bucket].push(id);
    }
  }
  opened.close();
  return seeded;
}

export const authedHeaders = (token: string): Record<string, string> => ({
  origin: ORIGIN,
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

/**
 * One 1500s working session: 25s warmup cadence (pace low), 4s flow cadence
 * (pace high), 22s dip cadence (pace low) — at least two distinct journey
 * buckets, like the production replay (self:low:low + self:medium:low).
 */
export async function ingestSession(
  app: FastifyInstance,
  token: string,
  idPrefix: string,
): Promise<void> {
  const offsets: number[] = [];
  for (let t = 0; t < 600; t += 25) {
    offsets.push(t);
  }
  for (let t = 600; t < 1_200; t += 4) {
    offsets.push(t);
  }
  for (let t = 1_200; t < 1_500; t += 22) {
    offsets.push(t);
  }
  const sessionStartMs = Date.now() - 2_000 * 1_000;
  for (const [index, offset] of offsets.entries()) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/context/events",
      headers: authedHeaders(token),
      payload: {
        specversion: "1.0",
        id: `${idPrefix}-${index}`,
        source: "urn:muses:replay-wiring-test",
        type: "muses.editor.activity",
        subject: "workspace:test",
        time: new Date(sessionStartMs + offset * 1_000).toISOString(),
        data: { action: "edit" },
      },
    });
    if (response.statusCode !== 202) {
      throw new Error(
        `ingest ${idPrefix}-${index} failed: ${response.statusCode} ${response.body}`,
      );
    }
  }
}

export interface Session {
  readonly token: string;
  readonly userId: string;
}

/** open#1 + register + close; returns the allowlist-ready session. */
export async function registerInWorkspace(
  workspace: ReturnType<typeof createWorkspace>,
  email: string,
): Promise<Session> {
  const first = await workspace.open({});
  const session = await registerViaApi(first.app, email, "secret1");
  await first.close();
  return { token: session.token, userId: session.user.id };
}
