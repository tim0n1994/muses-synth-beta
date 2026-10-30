import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { createArchive } from "./archive.mjs";

test("portable archive contains its files without host metadata", (t) => {
  const root = mkdtempSync(join(tmpdir(), "muses-archive-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  mkdirSync(bundle);
  const file = join(bundle, "fixture.txt");
  writeFileSync(file, "synthetic fixture\n");
  if (process.platform === "darwin") {
    execFileSync("xattr", ["-w", "com.muses.fixture", "local-only", file]);
  }
  const archive = join(root, "fixture.tar.gz");
  createArchive(archive, root, "bundle");
  const entries = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
  });
  assert.match(entries, /bundle\/fixture\.txt/);
  assert.doesNotMatch(entries, /(^|\/)\._/m);
  const raw = gunzipSync(readFileSync(archive));
  assert(!raw.includes(Buffer.from("SCHILY.xattr.")));
  assert(!raw.includes(Buffer.from("LIBARCHIVE.xattr.")));
  assert.equal(
    execFileSync("tar", ["-xOzf", archive, "bundle/fixture.txt"], {
      encoding: "utf8",
    }),
    "synthetic fixture\n",
  );
});
