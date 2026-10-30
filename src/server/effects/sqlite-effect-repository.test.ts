import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import type { EffectOutcome, EffectRequest } from "./contracts.js";
import {
  SqliteEffectRepository,
  type SqliteDatabasePort,
} from "./sqlite-effect-repository.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "muses-effects-"));
  directories.push(directory);
  return join(directory, "effects.sqlite");
}

function open(filename: string): {
  repository: SqliteEffectRepository;
  close: () => void;
} {
  const database = new Database(filename);
  const repository = new SqliteEffectRepository(
    database as unknown as SqliteDatabasePort,
  );
  return { repository, close: () => database.close() };
}

const request: EffectRequest = {
  effectId: "effect_1",
  decisionId: "decision_1",
  actionId: "audio.adjust",
  adjustment: {
    actionId: "audio.adjust",
    profile: "flow",
    targetGain: 0.3,
    rampMs: 1_000,
  },
  issuedAt: "2026-08-21T10:00:00.000Z",
  status: "issued",
};

function outcome(
  overrides: Partial<EffectOutcome> & Pick<EffectOutcome, "reason">,
): EffectOutcome {
  return {
    outcomeId: `outcome_${overrides.reason}_${overrides.observedAt ?? "0"}`,
    effectId: "effect_1",
    status: "applied",
    detail: null,
    observedAt: "2026-08-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteEffectRepository manual override lookup", () => {
  it("returns null when the user has never touched the transport", () => {
    const { repository, close } = open(createFile());
    repository.recordIssued(request);
    repository.recordOutcome(
      outcome({
        reason: "PROFILE_APPLIED",
        observedAt: "2026-08-21T10:01:00.000Z",
      }),
    );

    expect(repository.getLastManualOverrideAt()).toBeNull();
    close();
  });

  it("survives a restart, so a mid-cooldown override is not forgotten", () => {
    // The whole point of persisting this: a dev-server restart used to drop
    // the override and let automation resume a full cooldown early.
    const filename = createFile();
    const first = open(filename);
    first.repository.recordIssued(request);
    first.repository.recordOutcome(
      outcome({
        reason: "MANUAL_PAUSE",
        status: "skipped",
        observedAt: "2026-08-21T10:05:00.000Z",
      }),
    );
    expect(first.repository.getLastManualOverrideAt()).toBe(
      "2026-08-21T10:05:00.000Z",
    );
    first.close();

    const second = open(filename);
    expect(second.repository.getLastManualOverrideAt()).toBe(
      "2026-08-21T10:05:00.000Z",
    );
    second.close();
  });

  it("reports the most recent manual action, not the first", () => {
    const { repository, close } = open(createFile());
    repository.recordIssued(request);
    for (const [reason, at] of [
      ["MANUAL_START", "2026-08-21T10:00:00.000Z"],
      ["MANUAL_VOLUME", "2026-08-21T10:07:00.000Z"],
      ["MANUAL_PAUSE", "2026-08-21T10:03:00.000Z"],
    ] as const) {
      repository.recordOutcome(outcome({ reason, observedAt: at }));
    }

    expect(repository.getLastManualOverrideAt()).toBe(
      "2026-08-21T10:07:00.000Z",
    );
    close();
  });

  it("ignores automated outcomes so automation cannot cool itself down", () => {
    const { repository, close } = open(createFile());
    repository.recordIssued(request);
    repository.recordOutcome(
      outcome({
        reason: "MANUAL_PAUSE",
        observedAt: "2026-08-21T10:02:00.000Z",
      }),
    );
    repository.recordOutcome(
      outcome({
        reason: "PROFILE_APPLIED",
        observedAt: "2026-08-21T10:09:00.000Z",
      }),
    );

    expect(repository.getLastManualOverrideAt()).toBe(
      "2026-08-21T10:02:00.000Z",
    );
    close();
  });

  it("answers from the partial index rather than scanning every outcome", () => {
    const filename = createFile();
    const { repository, close } = open(filename);
    repository.recordIssued(request);
    close();

    const database = new Database(filename, { readonly: true });
    const plan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT observed_at FROM effect_outcomes
         WHERE json_extract(outcome_json, '$.reason')
           IN ('MANUAL_START', 'MANUAL_PAUSE', 'MANUAL_VOLUME', 'MANUAL_REVERT')
         ORDER BY observed_at DESC, outcome_id DESC LIMIT 1`,
      )
      .all() as Array<{ detail: string }>;
    database.close();

    expect(plan.map((row) => row.detail).join(" ")).toContain(
      "idx_effect_outcomes_manual",
    );
  });
});
