import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Do not adopt or migrate a database copied into a bundle by accident. This is
// an ownership marker for the bundle's own first-run state, not a backup or a
// cryptographic guarantee against a user who can modify local files.
export function guardBundleDatabase(root, release) {
  if (
    release?.schema !== "muses-local-beta/v1" ||
    typeof release.version !== "string" ||
    (release.local_preview !== true &&
      (!/^[a-f0-9]{40}$/u.test(release.source_sha ?? "") ||
        !/^[a-f0-9]{40}$/u.test(release.source_tree ?? ""))) ||
    !/^[a-f0-9]{64}$/u.test(release.source_digest ?? "")
  ) {
    throw new Error("Bundle release identity is missing or invalid.");
  }
  const state = join(root, ".muses");
  const marker = join(state, ".bundle-identity.json");
  const statIfPresent = (path) => {
    try {
      return lstatSync(path);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };
  const stateStat = statIfPresent(state);
  if (stateStat === null) mkdirSync(state, { mode: 0o700 });
  else if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
    throw new Error("Bundle state directory must be a real directory.");
  } else if ((stateStat.mode & 0o077) !== 0) {
    throw new Error("Bundle state directory must be private to the owner.");
  }
  let databasePresent = false;
  for (const suffix of ["", "-wal", "-shm"]) {
    const info = statIfPresent(join(state, `muses.sqlite${suffix}`));
    if (info !== null) {
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
        throw new Error(
          "Bundle database and sidecars must be unshared regular files.",
        );
      }
      databasePresent = true;
    }
  }
  const identity = {
    schema: "muses-bundle-state/v1",
    source_sha: release.source_sha,
    source_tree: release.source_tree,
    version: release.version,
    source_digest: release.source_digest,
  };
  const markerStat = statIfPresent(marker);
  if (markerStat === null) {
    if (databasePresent) {
      throw new Error(
        "Existing database has no bundle ownership marker; refusing to open it.",
      );
    }
    writeFileSync(marker, `${JSON.stringify(identity, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } else {
    if (
      !markerStat.isFile() ||
      markerStat.isSymbolicLink() ||
      !existsSync(marker)
    ) {
      throw new Error("Bundle ownership marker must be a regular file.");
    }
    const previous = JSON.parse(readFileSync(marker, "utf8"));
    if (JSON.stringify(previous) !== JSON.stringify(identity)) {
      throw new Error(
        "Bundle identity differs from existing state; refusing migration.",
      );
    }
  }
  return join(state, "muses.sqlite");
}
