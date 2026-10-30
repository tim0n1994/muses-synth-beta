import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { git, hash, inventory, root, verifyBuild } from "../build-identity.mjs";
import { withoutAuditExemptions } from "./dependency-policy.mjs";
import { assertNoticeReady } from "./notice-policy.mjs";
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    sha: { type: "string" },
    tag: { type: "string" },
    "local-preview": { type: "boolean", default: false },
  },
});
const build = verifyBuild();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.license !== "MIT" || pkg.private !== true)
  throw new Error("MIT/private package required");
const preview = values["local-preview"];
assertNoticeReady(
  readFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "utf8"),
  preview,
);
if (!preview) {
  execFileSync(process.execPath, ["scripts/release/security.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (
    !build.source.clean ||
    !/^[a-f0-9]{40}$/.test(values.sha ?? "") ||
    build.source.head !== values.sha
  )
    throw new Error("Release requires clean checkout and exact --sha");
  if (
    values.tag !== `v${pkg.version}` ||
    git("rev-parse", `refs/tags/${values.tag}^{commit}`) !== values.sha
  )
    throw new Error("Release tag/version/SHA mismatch");
}
if (!values.out) throw new Error("--out NEW_DIRECTORY required");
execFileSync(process.execPath, ["scripts/release/check-public.mjs"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, ["scripts/release/check-browser-notices.mjs"], {
  cwd: root,
  stdio: "inherit",
});
const out = resolve(values.out);
mkdirSync(out);
const stage = mkdtempSync(join(tmpdir(), "muses-package-"));
const name = `muses-${pkg.version}-${preview ? "preview" : "synth-beta"}`;
const bundle = join(stage, name);
mkdirSync(bundle);
for (const file of [
  "dist",
  "package.json",
  "pnpm-lock.yaml",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
])
  cpSync(join(root, file), join(bundle, file), { recursive: true });
// Conventional bundle commands also use the guarded launcher; no accidental
// pnpm start path may adopt a foreign default database.
writeFileSync(
  join(bundle, "package.json"),
  JSON.stringify(
    {
      ...pkg,
      scripts: {
        start: "node runtime.mjs start",
        watch: "node runtime.mjs watch",
      },
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(bundle, "pnpm-workspace.yaml"),
  withoutAuditExemptions(
    readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
  ),
);
for (const file of ["runtime.mjs", "data-guard.mjs", "LOCAL-BETA.md"])
  cpSync(join(root, "scripts/release", file), join(bundle, file));
// Include the actual installed dependency license texts, never absolute package paths.
// Full dependency graph includes browser build dependencies bundled by Vite.
const licenses = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }),
);
let notices =
  "Third-party dependencies (server, browser and build graph)\nDRAFT: installed local graph only. Linux, browser build and native component licensing remain unverified. See THIRD-PARTY-NOTICES.md.\n\n";
for (const entries of Object.values(licenses))
  for (const entry of entries) {
    notices += `${entry.name} ${entry.versions.join(", ")} — ${entry.license}\n${entry.author ?? ""}\n${entry.homepage ?? ""}\n`;
    for (const path of entry.paths ?? []) {
      for (const file of readdirSync(path).filter((f) =>
        /^(licen[cs]e|copying|notice)([.-]|$)/i.test(f),
      )) {
        if (lstatSync(join(path, file)).isFile())
          notices += readFileSync(join(path, file), "utf8") + "\n";
      }
    }
    notices += "\n";
  }
writeFileSync(join(bundle, "THIRD-PARTY-NOTICES.txt"), notices);
const manifest = {
  schema: "muses-local-beta/v1",
  version: pkg.version,
  license: "MIT",
  source_sha: build.source.head,
  source_tree: build.source.tree,
  source_digest: build.source.digest,
  local_preview: preview,
  tag: preview ? null : values.tag,
  delivery: "synth-only; v0.7/replay recording library NOT delivered",
  files: Object.entries(inventory(bundle)).map(([path, sha256]) => ({
    path,
    sha256,
  })),
};
writeFileSync(
  join(bundle, "release.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
execFileSync(
  process.execPath,
  [join(root, "scripts/release/check-public.mjs"), bundle],
  { cwd: root, stdio: "inherit" },
);
execFileSync(
  "gitleaks",
  [
    "dir",
    bundle,
    "--config",
    join(root, "scripts/release/gitleaks.toml"),
    "--gitleaks-ignore-path",
    "/dev/null",
    "--ignore-gitleaks-allow",
    "--redact=100",
  ],
  { stdio: "inherit" },
);
const archive = `${name}.tar.gz`;
execFileSync("tar", ["-czf", join(out, archive), "-C", stage, name]);
writeFileSync(
  join(out, "SHA256SUMS"),
  `${hash(readFileSync(join(out, archive)))}  ${archive}\n`,
);
for (const file of [
  "release.json",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "THIRD-PARTY-NOTICES.txt",
])
  cpSync(join(bundle, file), join(out, file));
console.log(JSON.stringify({ out, bundle, local_preview: preview }));
