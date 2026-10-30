import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "check-public.mjs",
);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "muses-public-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "README.md"), "Local synthetic soundscape.\n");
  return {
    root,
    run: () =>
      spawnSync(process.execPath, [checker, root], { encoding: "utf8" }),
    add: (name, bytes) => {
      const target = join(root, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    },
  };
}

test("a synthetic source tree and an example environment file pass", (t) => {
  const f = fixture(t);
  f.add(".env.example", "MUSES_PORT=3001\n");
  assert.equal(f.run().status, 0);
});

for (const [name, file, bytes] of [
  ["recording extension", "public/audio/clip.mp3", "synthetic"],
  ["database extension", "data.sqlite", "synthetic"],
  ["nested archive extension", "assets/archive.zip", "synthetic"],
  ["private Git metadata", ".git/config", "synthetic"],
  ["private runtime state", ".muses/state", "synthetic"],
  ["private dispatch record", ".dispatch-demo/receipt", "synthetic"],
  ["RIFF disguised as text", "assets/payload.txt", Buffer.from("RIFF1234WAVE")],
  [
    "ZIP disguised as text",
    "assets/payload.txt",
    Buffer.from([0x50, 0x4b, 3, 4]),
  ],
  [
    "gzip disguised as text",
    "assets/payload.txt",
    Buffer.from([0x1f, 0x8b, 0]),
  ],
  [
    "embedded audio",
    "public/cover.svg",
    `<svg>${"data:" + "audio/wav;base64,AAAA"}</svg>`,
  ],
  ["private home path", "docs/notes.md", "/" + "home/alice/private-file"],
]) {
  test(`reject ${name}`, (t) => {
    const f = fixture(t);
    f.add(file, bytes);
    assert.notEqual(f.run().status, 0);
  });
}
