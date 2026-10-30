import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const root = resolve(import.meta.dirname, "..");
export const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function inventory(directory) {
  const result = {};
  function walk(dir, prefix = "") {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name),
        key = prefix + name,
        stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${key}`);
      if (stat.isDirectory()) walk(path, key + "/");
      else if (stat.isFile()) result[key] = hash(readFileSync(path));
      else throw new Error(`Unsupported file: ${key}`);
    }
  }
  walk(directory);
  return result;
}
export function sourceState() {
  let head = null,
    tree = null,
    clean = false;
  try {
    head = git("rev-parse", "--verify", "HEAD");
    tree = git("rev-parse", "HEAD^{tree}");
    clean = git("status", "--porcelain", "--untracked-files=all") === "";
  } catch {
    /* Unborn Git repository is supported for development only. */
  }
  const files = git(
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const source = Object.fromEntries(
    files.map((file) => {
      if (!lstatSync(join(root, file)).isFile())
        throw new Error(`Non-regular source: ${file}`);
      return [file, hash(readFileSync(join(root, file)))];
    }),
  );
  return { head, tree, clean, digest: hash(JSON.stringify(source)) };
}
export function verifyBuild() {
  const saved = JSON.parse(
    readFileSync(join(root, ".muses-build.json"), "utf8"),
  );
  if (
    JSON.stringify(saved.source) !== JSON.stringify(sourceState()) ||
    saved.dist !== hash(JSON.stringify(inventory(join(root, "dist"))))
  )
    throw new Error("Source or compiled output changed since build");
  return saved;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv[2] !== "build")
    throw new Error("Usage: build-identity.mjs build");
  const source = sourceState();
  for (const task of ["clean", "build:web", "build:server"])
    execFileSync("pnpm", [task], { cwd: root, stdio: "inherit" });
  if (JSON.stringify(source) !== JSON.stringify(sourceState()))
    throw new Error("Source changed during build; retry after edits settle");
  writeFileSync(
    join(root, ".muses-build.json"),
    JSON.stringify(
      {
        schema: "muses-build/v2",
        source,
        dist: hash(JSON.stringify(inventory(join(root, "dist")))),
      },
      null,
      2,
    ) + "\n",
  );
}
