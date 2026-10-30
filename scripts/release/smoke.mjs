import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";

const [assetsArg, evidenceArg] = process.argv.slice(2);
if (!assetsArg || !evidenceArg)
  throw new Error("Usage: smoke.mjs ASSET_DIR NEW_EVIDENCE_DIR");
const assets = resolve(assetsArg);
const evidence = resolve(evidenceArg);
mkdirSync(evidence);
const checksum = readFileSync(join(assets, "SHA256SUMS"), "utf8").trim();
const match = /^([a-f0-9]{64}) {2}(muses-[a-zA-Z0-9.-]+\.tar\.gz)$/.exec(
  checksum,
);
assert(match, "Invalid SHA256SUMS");
const archive = join(assets, match[2]);
assert.equal(
  createHash("sha256").update(readFileSync(archive)).digest("hex"),
  match[1],
);
const members = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
  .trim()
  .split("\n");
const top = members[0].split("/")[0];
assert(top.startsWith("muses-"));
for (const member of members) {
  assert(member.startsWith(`${top}/`) && !member.split("/").includes(".."));
}
const sandbox = mkdtempSync(join(tmpdir(), "muses-beta-smoke-"));
execFileSync("tar", ["-xzf", archive, "-C", sandbox]);
const bundle = join(sandbox, top);
const manifest = JSON.parse(readFileSync(join(bundle, "release.json"), "utf8"));
assert.deepEqual(
  manifest,
  JSON.parse(readFileSync(join(assets, "release.json"), "utf8")),
  "External provenance must match the checksummed archive",
);
for (const { path: file, sha256: hash } of manifest.files) {
  assert(!file.startsWith("/") && !file.split("/").includes(".."));
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(bundle, file)))
      .digest("hex"),
    hash,
    file,
  );
}
assert(!existsSync(join(bundle, "node_modules")), "Must install independently");
const home = join(sandbox, "home");
mkdirSync(home);
const env = {
  PATH: process.env.PATH,
  HOME: home,
  CI: "true",
  TMPDIR: sandbox,
  NO_PROXY: "127.0.0.1,localhost",
};
// Fresh HOME must not inherit credentials. Network egress can still require a
// proxy; forward only parseable HTTP(S) proxy URLs without user information.
for (const name of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
]) {
  const value = process.env[name];
  if (!value) continue;
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      env[name] = value;
  } catch {
    // Ignore invalid proxy configuration rather than leaking it to a child.
  }
}
if (process.argv.includes("--offline")) {
  env.npm_config_store_dir = dirname(
    execFileSync("pnpm", ["store", "path"], { encoding: "utf8" }).trim(),
  );
  env.npm_config_offline = "true";
  // Native compilation must use local headers, never download them.
  env.npm_config_nodedir = resolve(dirname(process.execPath), "..");
}
// Both subprocesses receive no inherited app/provider secrets. The install
// writes only this fresh bundle and sandbox HOME (including pnpm's store).
async function run(command, args, log, extra = {}) {
  const output = createWriteStream(join(evidence, log));
  const child = spawn(command, args, {
    timeout: 240_000,
    killSignal: "SIGKILL",
    cwd: bundle,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const [code] = await once(child, "exit");
  output.end();
  await once(output, "finish");
  assert.equal(code, 0, `${command} ${args.join(" ")} (see ${log})`);
}
await run(
  process.execPath,
  [
    "runtime.mjs",
    "install",
    ...(process.argv.includes("--offline") ? ["--offline"] : []),
  ],
  "install.log",
);
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const output = createWriteStream(join(evidence, "server.log"));
const child = spawn(process.execPath, ["runtime.mjs", "start"], {
  cwd: bundle,
  env: {
    ...env,
    MUSES_PORT: String(port),
    MUSES_DATABASE_PATH: "/must-not-use/muses.sqlite",
    MUSES_V07: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(output, { end: false });
child.stderr.pipe(output, { end: false });
const exited = once(child, "exit");
const base = `http://127.0.0.1:${port}`;
let result;
try {
  let health;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error("Server exited before health");
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      /* Wait only for our fresh child. */
    }
    await setTimeout(100);
  }
  assert(health, "Health timeout");
  assert.equal(health.version, manifest.version);
  assert.equal(health.status, "ok");
  writeFileSync(
    join(evidence, "health.json"),
    `${JSON.stringify(health, null, 2)}\n`,
  );
  const html = await (await fetch(base)).text();
  assert(html.includes('<div id="root">'));
  assert(
    !html.includes('name="muses-features"'),
    "Inherited feature flags must be cleared",
  );
  writeFileSync(join(evidence, "index.html"), html);
  const script = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
  assert(script);
  const js = await fetch(`${base}${script}`);
  assert(js.ok && (await js.text()).length > 100);
  assert(
    !manifest.files.some(({ path: file }) =>
      /\.(wav|mp3|ogg|flac|m4a)$/i.test(file),
    ),
  );
  await run(
    process.execPath,
    ["runtime.mjs", "watch", "--help"],
    "observer-help.log",
  );
  const project = join(sandbox, "observed-project");
  mkdirSync(project);
  const watcher = spawn(
    process.execPath,
    [
      "runtime.mjs",
      "watch",
      "--dir",
      project,
      "--server",
      base,
      "--debounce",
      "200",
    ],
    { cwd: bundle, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const watcherExit = once(watcher, "exit");
  let watcherOutput = "";
  watcher.stdout.on("data", (chunk) => {
    watcherOutput += chunk;
  });
  watcher.stderr.on("data", (chunk) => {
    watcherOutput += chunk;
  });
  try {
    for (let i = 0; i < 100 && !watcherOutput.includes("Watching "); i++) {
      assert(watcher.exitCode === null, watcherOutput);
      await setTimeout(100);
    }
    assert(watcherOutput.includes("Watching "), "Observer readiness timeout");
    writeFileSync(
      join(project, "synthetic.ts"),
      "export const synthetic = true;\n",
    );
    let observed = false;
    for (let i = 0; i < 100; i++) {
      const events = await (
        await fetch(
          `${base}/api/v1/context/events?source=urn%3Amuses%3Awatch&limit=50`,
        )
      ).json();
      if (
        events.items?.some((event) => event.type === "muses.editor.activity")
      ) {
        observed = true;
        break;
      }
      await setTimeout(100);
    }
    assert(
      observed,
      "Compiled observer did not deliver a real filesystem event",
    );
  } finally {
    watcher.kill("SIGTERM");
    await watcherExit;
  }
  assert(existsSync(join(bundle, ".muses/muses.sqlite")));
  result = {
    result: "PASS",
    sandbox,
    bundle,
    base,
    source_sha: manifest.source_sha,
    local_preview: manifest.local_preview,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    health,
    observer: "real filesystem event ingested",
    recording_library: "NOT delivered",
    verified_files: manifest.files.length,
  };
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(12000, undefined, { ref: false }).then(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  // Do not let a completed child's timeout hold the script open.
  timer.catch(() => {});
  const [code, signal] = await exited;
  output.end();
  await once(output, "finish");
  assert.equal(code, 0, `Shutdown failed: ${signal}`);
}
// Separate fresh extraction: foreign DB is rejected before any server opens it.
const foreign = mkdtempSync(join(tmpdir(), "muses-foreign-"));
execFileSync("tar", ["-xzf", archive, "-C", foreign]);
const foreignBundle = join(foreign, top);
mkdirSync(join(foreignBundle, ".muses"), { mode: 0o700 });
const foreignDb = join(foreignBundle, ".muses/muses.sqlite");
writeFileSync(foreignDb, "synthetic foreign database sentinel");
const before = readFileSync(foreignDb);
const rejected = spawn(process.execPath, ["runtime.mjs", "start"], {
  timeout: 10_000,
  killSignal: "SIGKILL",
  cwd: foreignBundle,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let rejection = "";
rejected.stderr.on("data", (chunk) => {
  rejection += chunk;
});
const [exit] = await once(rejected, "exit");
assert.notEqual(exit, 0);
assert(rejection.includes("Existing database has no bundle ownership marker"));
assert.deepEqual(readFileSync(foreignDb), before);
result.foreign_database = "rejected unchanged";
writeFileSync(
  join(evidence, "smoke.json"),
  JSON.stringify(result, null, 2) + "\n",
);
