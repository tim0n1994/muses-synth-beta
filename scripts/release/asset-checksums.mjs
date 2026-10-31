import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sidecars = [
  "release.json",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "THIRD-PARTY-NOTICES.txt",
];
const archivePattern = /^muses-[a-zA-Z0-9.-]+\.tar\.gz$/;

function digestFile(directory, name) {
  const path = join(directory, name);
  if (!lstatSync(path).isFile())
    throw new Error(`Not a regular asset: ${name}`);
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function writeAssetChecksums(directory, archive) {
  if (!archivePattern.test(archive)) throw new Error("Invalid archive name");
  const content = [archive, ...sidecars]
    .map((name) => `${digestFile(directory, name)}  ${name}`)
    .join("\n");
  writeFileSync(join(directory, "SHA256SUMS"), `${content}\n`);
}

export function verifyAssetChecksums(directory) {
  const checksumPath = join(directory, "SHA256SUMS");
  if (!lstatSync(checksumPath).isFile()) throw new Error("Invalid SHA256SUMS");
  const entries = new Map();
  for (const line of readFileSync(checksumPath, "utf8").trim().split("\n")) {
    const match = /^([a-f0-9]{64}) {2}([a-zA-Z0-9.-]+)$/.exec(line);
    if (!match || entries.has(match[2])) throw new Error("Invalid SHA256SUMS");
    entries.set(match[2], match[1]);
  }
  const archives = [...entries.keys()].filter((name) =>
    archivePattern.test(name),
  );
  if (
    archives.length !== 1 ||
    entries.size !== sidecars.length + 1 ||
    sidecars.some((name) => !entries.has(name))
  ) {
    throw new Error("Unexpected release asset set");
  }
  for (const [name, expected] of entries) {
    if (digestFile(directory, name) !== expected) {
      throw new Error(`Asset checksum mismatch: ${name}`);
    }
  }
  return { archive: archives[0], sidecars };
}
