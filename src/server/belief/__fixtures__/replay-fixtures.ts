import type { ContextEventRecord, JsonValue } from "../../context/model.js";

export const record = (
  sequence: number,
  id: string,
  type: string,
  occurredAt: string,
  data: JsonValue,
  options: Readonly<{
    source?: string;
    expiresAt?: string;
    outOfOrder?: boolean;
  }> = {},
): ContextEventRecord => ({
  specversion: "1.0",
  id,
  source: options.source ?? "urn:muses:test",
  type,
  subject: "workspace:alpha",
  time: occurredAt,
  datacontenttype: "application/json",
  data,
  extensions: {},
  contentHash: `hash-${id}-${sequence}`,
  occurredAt,
  receivedAt: occurredAt,
  expiresAt: options.expiresAt ?? "2026-08-30T00:00:00.000Z",
  outOfOrder: options.outOfOrder ?? false,
  serverSequence: sequence,
});

export const sustainedEditingFixture = [
  record(1, "edit-1", "muses.editor.activity", "2026-07-30T00:00:00.000Z", {
    action: "edit",
  }),
  record(2, "edit-2", "muses.editor.activity", "2026-07-30T00:02:00.000Z", {
    action: "save",
  }),
  record(3, "edit-3", "muses.editor.activity", "2026-07-30T00:04:00.000Z", {
    action: "edit",
  }),
] as const;

export const failingTestFixture = [
  ...sustainedEditingFixture,
  record(
    4,
    "test-fail",
    "muses.test.run.completed",
    "2026-07-30T00:05:00.000Z",
    {
      status: "failed",
      failed: 2,
      total: 20,
    },
  ),
] as const;

export const recoveredReviewFixture = [
  ...failingTestFixture,
  record(
    5,
    "test-pass",
    "muses.test.run.completed",
    "2026-07-30T00:08:00.000Z",
    {
      status: "passed",
      failed: 0,
      total: 20,
    },
  ),
  record(6, "review-1", "muses.review.activity", "2026-07-30T00:08:30.000Z", {
    action: "diff-opened",
  }),
] as const;

export const conflictingTestsFixture = [
  record(
    1,
    "test-pass",
    "muses.test.run.completed",
    "2026-07-30T01:00:00.000Z",
    {
      status: "passed",
    },
  ),
  record(
    2,
    "test-fail",
    "muses.test.run.completed",
    "2026-07-30T01:01:00.000Z",
    {
      status: "failed",
    },
  ),
] as const;
