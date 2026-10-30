import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This binds emitted JS source-map package versions to the notice inventory.
// It does not establish CSS, native binary or legal-rights completeness.
export function checkBrowserNotices(root) {
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
  const maps = readdirSync(assets).filter((name) => name.endsWith(".js.map"));
  if (!maps.length)
    throw new Error("Browser JavaScript source maps are missing.");
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
