import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ABSTRACT_README_SHA256 =
  "e1a86711fb5055c0e66901276b7d2c843554bf5f1dab218c069c8b9d17148e81";
const ABSTRACT_NOTICE_SHA256 =
  "af15a41ce02371f77476b7a201e036c0ae6c5d6d2a233b4e5f0fd5fca123457e";
const digest = (data) => createHash("sha256").update(data).digest("hex");
const normalize = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

// A change to a production dependency or its actual license text must not be
// silently covered by a previously reviewed notice for a different graph.
export function validateProductionNotices(notice, inventory) {
  const headings = [...notice.matchAll(/^### \d+\. ([^\n]+)$/gm)];
  const sections = new Map();
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const key = h[1];
    if (sections.has(key)) throw new Error(`Duplicate notice: ${key}`);
    sections.set(
      key,
      notice.slice(
        h.index + h[0].length,
        headings[i + 1]?.index ?? notice.length,
      ),
    );
  }

  const packages = new Map();
  for (const [declared, entries] of Object.entries(inventory)) {
    for (const entry of entries) {
      const seenVersions = new Set();
      for (const path of entry.paths ?? []) {
        const manifest = JSON.parse(
          readFileSync(join(path, "package.json"), "utf8"),
        );
        if (
          manifest.name !== entry.name ||
          !entry.versions.includes(manifest.version)
        ) {
          throw new Error("License inventory and package manifest disagree");
        }
        seenVersions.add(manifest.version);
        const key = `${manifest.name}@${manifest.version}`;
        const record = packages.get(key) ?? { declared, paths: [] };
        if (record.declared !== declared)
          throw new Error(`Ambiguous license: ${key}`);
        record.paths.push(path);
        packages.set(key, record);
      }
      if (
        !entry.versions?.length ||
        entry.versions.some((v) => !seenVersions.has(v))
      ) {
        throw new Error(
          `Inventory version missing installed package: ${entry.name}`,
        );
      }
    }
  }
  if (!packages.size || packages.size !== sections.size) {
    throw new Error("Production dependency and notice counts differ");
  }

  for (const [key, { declared, paths }] of packages) {
    const section = sections.get(key);
    if (!section)
      throw new Error(`Production dependency has no notice: ${key}`);
    const spdx = /^Declared SPDX: `([^`]+)`\./m.exec(section)?.[1];
    if (spdx !== declared)
      throw new Error(`License declaration differs: ${key}`);
    if (key === "abstract-logging@2.0.1") {
      const text = /```text\n([\s\S]*?)\n```/.exec(section)?.[1];
      if (
        declared !== "MIT" ||
        !section.includes("https://jsumners.mit-license.org/") ||
        !text ||
        digest(normalize(text)) !== ABSTRACT_NOTICE_SHA256 ||
        paths.some(
          (path) =>
            digest(readFileSync(join(path, "Readme.md"))) !==
            ABSTRACT_README_SHA256,
        )
      ) {
        throw new Error("abstract-logging upstream notice does not match");
      }
      continue;
    }

    const source = /^Source: `([^`]+)`\./m.exec(section)?.[1];
    const expected = /^Original-file SHA-256: `([a-f0-9]{64})`\./m.exec(
      section,
    )?.[1];
    if (!source || !expected) throw new Error(`License source missing: ${key}`);
    const file = basename(source);
    let licenseText;
    for (const path of paths) {
      const target = join(path, file);
      if (!existsSync(target))
        throw new Error(`Installed license missing: ${key}`);
      const data = readFileSync(target);
      if (digest(data) !== expected)
        throw new Error(`Installed license changed: ${key}`);
      licenseText = data.toString("utf8");
    }
    const block = /```text\n([\s\S]*?)\n```/.exec(section)?.[1];
    if (key === "@isaacs/nonrecursive-glob-match@1.0.3") {
      const referenced = sections.get("path-scurry@3.0.0");
      const shared =
        referenced && /```text\n([\s\S]*?)\n```/.exec(referenced)?.[1];
      if (
        !section.includes("#dependency-123") ||
        !shared ||
        normalize(shared) !== normalize(licenseText)
      ) {
        throw new Error(`Cross-referenced license differs: ${key}`);
      }
    } else if (!block || normalize(block) !== normalize(licenseText)) {
      throw new Error(`Reproduced license text differs: ${key}`);
    }
  }
  return { productionPackages: packages.size };
}

export function checkProductionNotices(root) {
  const notice = readFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "utf8");
  const inventory = JSON.parse(
    execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
  return validateProductionNotices(notice, inventory);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(
    JSON.stringify(
      checkProductionNotices(
        resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
      ),
    ),
  );
}
