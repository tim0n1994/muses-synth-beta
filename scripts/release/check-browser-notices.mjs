import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const reviewedRuntimeHash =
  "5db5ba82eef00d1dee7e86e663098c9427d01183a88d357437daff295aec3e75";
const reviewedCssHash =
  "8295cd0eda31adddb58d1fab6e2320a7d0397aa3e4dbda572af58d14f2b22815";
const reviewedRolldownTexts = new Map([
  [
    "### Rolldown package license",
    "93a675c915fd5846a0d9956bfc10cea9b2deeacf59074abf398f0fdcce10a19b",
  ],
  [
    "### Rolldown upstream third-party licenses",
    "a877291d800ed43692f3f9ae09d8e01cc6f7293ad39d43896059c188ffbb8b7c",
  ],
]);
const digest = (data) => createHash("sha256").update(data).digest("hex");
const normalize = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

// Bind mapped JS dependencies and reviewed unmapped assets to the notice
// inventory. The CSS hash changes only after a fresh provenance review.
export function checkBrowserNotices(root, { cssHash = reviewedCssHash } = {}) {
  const rootPath = realpathSync(root);
  const assets = join(rootPath, "dist/web/assets");
  const notices = readFileSync(
    join(rootPath, "THIRD-PARTY-NOTICES.md"),
    "utf8",
  );
  const headings = new Set(
    notices
      .split("\n")
      .filter((line) => /^### \d+\. /.test(line))
      .map((line) => line.replace(/^### \d+\. /, "").trim()),
  );
  const names = readdirSync(assets);
  const scripts = names.filter((name) => name.endsWith(".js"));
  const maps = names.filter((name) => name.endsWith(".js.map"));
  if (!maps.length)
    throw new Error("Browser JavaScript source maps are missing.");
  if (
    !scripts.length ||
    maps.some((name) => !scripts.includes(name.slice(0, -4)))
  ) {
    throw new Error("A browser source map has no matching JavaScript asset.");
  }
  for (const name of scripts) {
    if (maps.includes(`${name}.map`)) continue;
    if (
      !/^rolldown-runtime-[a-zA-Z0-9_-]+\.js$/.test(name) ||
      digest(readFileSync(join(assets, name))) !== reviewedRuntimeHash
    ) {
      throw new Error(`Unreviewed browser asset without a source map: ${name}`);
    }
    if (!notices.includes("rolldown@1.1.5"))
      throw new Error("Rolldown notice is missing.");
    for (const [heading, expected] of reviewedRolldownTexts) {
      const after = notices.split(heading)[1];
      const block = after && /```text\n([\s\S]*?)\n```/.exec(after)?.[1];
      if (!block || digest(normalize(block)) !== expected) {
        throw new Error(
          "Reviewed Rolldown license text is missing or changed.",
        );
      }
    }
  }
  const styles = names.filter((name) => name.endsWith(".css"));
  if (
    styles.length !== 1 ||
    digest(readFileSync(join(assets, styles[0]))) !== cssHash
  ) {
    throw new Error("Browser CSS asset changed and needs provenance review.");
  }
  const packages = new Set();
  for (const name of maps) {
    const map = JSON.parse(readFileSync(join(assets, name), "utf8"));
    if (!Array.isArray(map.sources))
      throw new Error("Invalid browser source map.");
    for (const source of map.sources) {
      if (typeof source !== "string" || !source.includes("node_modules/"))
        continue;
      const file = realpathSync(resolve(assets, source));
      if (
        !file.startsWith(`${rootPath}${sep}`) ||
        !file.includes(`${sep}node_modules${sep}`)
      )
        throw new Error("Mapped dependency resolves outside the checkout.");
      let dir = dirname(file);
      let pkg;
      while (dir.startsWith(`${rootPath}${sep}`)) {
        const manifest = join(dir, "package.json");
        if (existsSync(manifest)) {
          const candidate = JSON.parse(readFileSync(manifest, "utf8"));
          if (candidate.name && candidate.version) {
            pkg = `${candidate.name}@${candidate.version}`;
            break;
          }
        }
        dir = dirname(dir);
      }
      if (!pkg || !headings.has(pkg))
        throw new Error(
          "Mapped browser dependency has no matching notice entry.",
        );
      packages.add(pkg);
    }
  }
  if (!packages.size) throw new Error("No browser dependencies were mapped.");
  return { sourceMaps: maps.length, packages: packages.size };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  console.log(JSON.stringify(checkBrowserNotices(root)));
}
