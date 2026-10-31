import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { guardBundleDatabase } from "./data-guard.mjs";
import { withoutAuditExemptions } from "./dependency-policy.mjs";
const release = {
  schema: "muses-local-beta/v1",
  version: "0.3.3-beta.1",
  source_sha: "a".repeat(40),
  source_tree: "b".repeat(40),
  source_digest: "c".repeat(64),
  local_preview: false,
};
const fresh = () => mkdtempSync(join(tmpdir(), "muses-guard-test-"));
test("first-run ownership allows same-bundle restart", () => {
  const root = fresh();
  const db = guardBundleDatabase(root, release);
  writeFileSync(db, "synthetic state");
  assert.equal(guardBundleDatabase(root, release), db);
  assert.throws(
    () =>
      guardBundleDatabase(root, { ...release, source_digest: "d".repeat(64) }),
    /differs/,
  );
  assert.equal(readFileSync(db, "utf8"), "synthetic state");
});
test("foreign database and orphan sidecars are rejected unchanged", () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const root = fresh();
    mkdirSync(join(root, ".muses"), { mode: 0o700 });
    const path = join(root, ".muses/muses.sqlite" + suffix);
    writeFileSync(path, "foreign sentinel");
    assert.throws(
      () => guardBundleDatabase(root, release),
      /no bundle ownership marker/,
    );
    assert.equal(readFileSync(path, "utf8"), "foreign sentinel");
  }
});
test("symlink state cannot redirect database writes", () => {
  const root = fresh(),
    other = fresh();
  symlinkSync(other, join(root, ".muses"));
  assert.throws(() => guardBundleDatabase(root, release), /real directory/);
});
test("unborn preview is explicit; null identity fails closed for release", () => {
  const preview = {
    ...release,
    source_sha: null,
    source_tree: null,
    local_preview: true,
  };
  assert(guardBundleDatabase(fresh(), preview));
  assert.throws(
    () => guardBundleDatabase(fresh(), { ...preview, local_preview: false }),
    /identity/,
  );
});
test("audit exemptions removed while build approvals and overrides survive", () => {
  const stripped = withoutAuditExemptions(
    "allowBuilds:\n  better-sqlite3: true\nauditConfig:\n  ignoreCves: [anything]\noverrides:\n  x: 1\n",
  );
  assert(!stripped.includes("ignoreCves"));
  assert(stripped.includes("better-sqlite3: true"));
  assert(stripped.includes("overrides:"));
});
