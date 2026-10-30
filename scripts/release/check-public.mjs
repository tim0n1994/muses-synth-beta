import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inventory, root } from "../build-identity.mjs";

// No history baseline: scan the current candidate, including untracked files.
const target = process.argv[2] ? resolve(process.argv[2]) : root;
const files =
  target === root
    ? execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd: root, encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean)
    : Object.keys(inventory(target));
const failures = [];
for (const file of files) {
  if (!lstatSync(join(target, file)).isFile()) {
    failures.push(`${file}: non-regular file`);
    continue;
  }
  if (
    /\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|aif|aiff|wma|mp4|mov|webm|zip|tar|tgz|gz|7z|rar|sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|dump|bak)$/i.test(
      file,
    ) ||
    /(^|\/)(\.git|\.muses|\.ai-bridge|\.dispatch[^/]*)(\/|$)/i.test(file) ||
    (file !== ".env.example" &&
      /(^|\/)(\.env(?:\..*)?|staging|v07-library-pilot)(\/|$)/i.test(file))
  )
    failures.push(`${file}: media or private data`);
  const bytes = readFileSync(join(target, file));
  const header = bytes.subarray(0, 16).toString("latin1");
  if (
    /^(ID3|fLaC|OggS|SQLite format 3)/.test(header) ||
    (bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04) ||
    (bytes[0] === 0x1f && bytes[1] === 0x8b) ||
    (header.startsWith("RIFF") && header.slice(8, 12) === "WAVE") ||
    header.slice(4, 8) === "ftyp"
  )
    failures.push(`${file}: media/database signature`);
  let text = bytes.toString("utf8");
  // Exact public documentation placeholder and synthetic prompt-attack inputs.
  if (file === "docs/USAGE.md")
    text = text.replaceAll("/" + "Users/you/Proj/xxx", "<example>");
  if (file === "src/server/llm/__tests__/prompt.test.ts") {
    for (const value of [
      "/" + "Users/alice/secret",
      "C:/" + "Users/bob",
      "C:" + "\\\\Users\\\\bob\\\\keys",
    ])
      text = text.replaceAll(value, "<synthetic>");
  }
  // Construct patterns in pieces so the checker can scan its own source.
  const leaks = [
    new RegExp("/" + "Users/[^/\\s]+/"),
    new RegExp("/" + "home/[^/\\s]+/"),
    new RegExp("[A-Z]:\\\\" + "Users\\\\", "i"),
    new RegExp("(?:" + "100\\.68\\.252\\.6|100\\.107\\.223\\.2)"),
    new RegExp("argus" + "-thinkpad", "i"),
  ];
  if (leaks.some((pattern) => pattern.test(text)))
    failures.push(`${file}: private host/path`);
  const inlineAudio = new RegExp("data:" + "audio/[^;\\s]+;base64,", "i");
  if (inlineAudio.test(text)) failures.push(`${file}: embedded audio data`);
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  `PASS: ${files.length} files; no recording/data/private-path payload`,
);
