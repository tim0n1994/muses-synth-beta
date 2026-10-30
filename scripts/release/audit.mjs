import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withoutAuditExemptions } from "./dependency-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2]
  ? resolve(process.argv[2])
  : mkdtempSync(join(tmpdir(), "muses-audit-"));
if (process.argv[2]) mkdirSync(out);
for (const file of ["package.json", "pnpm-lock.yaml"])
  cpSync(join(root, file), join(out, file));
writeFileSync(
  join(out, "pnpm-workspace.yaml"),
  withoutAuditExemptions(
    readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
  ),
);
// No install and no lifecycle hooks. pnpm reads the copied frozen dependency
// graph and queries the registry; no DB or application process is involved.
const result = spawnSync(
  "pnpm",
  ["audit", "--prod", "--audit-level=moderate", "--json"],
  { cwd: out, encoding: "utf8" },
);
writeFileSync(join(out, "audit.json"), result.stdout ?? "");
writeFileSync(join(out, "stderr.log"), result.stderr ?? "");
if (result.error) throw result.error;
console.log(
  JSON.stringify({
    result: result.status === 0 ? "PASS" : "FAIL",
    exit_code: result.status,
    report: join(out, "audit.json"),
    exemptions: false,
    threshold: "moderate",
  }),
);
process.exitCode = result.status ?? 1;
