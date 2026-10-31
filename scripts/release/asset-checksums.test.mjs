import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  verifyAssetChecksums,
  writeAssetChecksums,
} from "./asset-checksums.mjs";

const archive = "muses-0.1.0-synth-beta.tar.gz";
const files = [
  archive,
  "release.json",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "THIRD-PARTY-NOTICES.txt",
];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "muses-checksums-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of files)
    writeFileSync(join(root, file), `fixture: ${file}\n`);
  writeAssetChecksums(root, archive);
  return root;
}

test("validates every downloadable asset", (t) => {
  const root = fixture(t);
  assert.equal(verifyAssetChecksums(root).archive, archive);
  writeFileSync(join(root, "LICENSE"), "changed\n");
  assert.throws(() => verifyAssetChecksums(root), /checksum mismatch/);
});

test("rejects incomplete, duplicate and unsafe checksum entries", (t) => {
  const root = fixture(t);
  const path = join(root, "SHA256SUMS");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.split("\n").slice(0, -2).join("\n") + "\n");
  assert.throws(() => verifyAssetChecksums(root), /asset set/);
  writeFileSync(path, original + original.split("\n")[0] + "\n");
  assert.throws(() => verifyAssetChecksums(root), /Invalid SHA256SUMS/);
  writeFileSync(path, original + `${"a".repeat(64)}  ../outside\n`);
  assert.throws(() => verifyAssetChecksums(root), /Invalid SHA256SUMS/);
});
