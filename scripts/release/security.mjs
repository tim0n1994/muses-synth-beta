import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, root } from "../build-identity.mjs";

const scratch = mkdtempSync(join(tmpdir(), "muses-secrets-"));
const tree = join(scratch, "tree");
mkdirSync(tree);
for (const file of git(
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
)
  .split("\0")
  .filter(Boolean))
  cpSync(join(root, file), join(tree, file), { recursive: true });
const args = [
  "--config",
  join(root, "scripts/release/gitleaks.toml"),
  "--gitleaks-ignore-path",
  "/dev/null",
  "--ignore-gitleaks-allow",
  "--redact=100",
];
execFileSync("gitleaks", ["dir", tree, ...args], { stdio: "inherit" });
let head;
try {
  head = git("rev-parse", "--verify", "HEAD");
} catch {
  /* No HEAD: scan candidate tree only. */
}
if (head) {
  if (git("rev-parse", "--is-shallow-repository") !== "false")
    throw new Error("Full history required for secret scan");
  execFileSync(
    "gitleaks",
    ["git", root, `--log-opts=${head} --full-history -m`, ...args],
    { stdio: "inherit" },
  );
}
