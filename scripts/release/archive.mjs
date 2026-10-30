import { execFileSync } from "node:child_process";

// Avoid platform-specific metadata and AppleDouble files in portable bundles.
export function createArchive(output, stage, name) {
  execFileSync(
    "tar",
    ["--no-xattrs", "--no-acls", "-czf", output, "-C", stage, name],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
}
