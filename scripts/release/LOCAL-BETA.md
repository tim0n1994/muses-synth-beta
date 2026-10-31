# Compiled synth beta bundle

This is the MIT, single-user, loopback-only synthetic soundscape beta for Node
22.13+ (below 23) and pnpm 11.4.0. Linux/macOS are target platforms; check the
release evidence for the platforms actually tested. Windows requires WSL2.
The v0.7/replay recording library is **not delivered or covered**. SPA shell route
checks are not recording-library acceptance. No public/audio directory or audio
HTTP fetch is required for Web Audio synthesis.

Check SHA256SUMS before extraction; it covers the archive and every separately
downloadable license, notice and release manifest. Inside the extracted directory:

```sh
node runtime.mjs install
node runtime.mjs start
# In another terminal, explicitly opt a project into observation:
node runtime.mjs watch --dir /path/to/your/project --server http://127.0.0.1:3001
```

Install uses the frozen lockfile and builds the locked SQLite dependency from
source. Python 3, `make`, a C/C++ compiler and Node headers are required; install
Xcode Command Line Tools on macOS or native build tools on Linux. The registry
and Node header download need network access unless already cached or locally
provided (`install --offline`). No TypeScript compiler or JavaScript development
dependencies are required. Browser sound requires a user gesture.
The watcher sends activity metadata without relative file paths by default;
the watched directory's basename is still included in the event subject.
Relative file paths require explicit opt-in.

Start clears inherited `MUSES_` and `LLM_` settings, binds loopback, disables
authentication and v0.7, and keeps its own private `.muses` directory. It
refuses an unmarked, linked, shared or mismatched existing database. The marker
protects against accidental adoption; it is not a cryptographic guarantee
against someone who can change local files. Preview bundles are explicitly
marked and are not tagged release provenance.

Maintainers: `pnpm build`, then `pnpm release:package --local-preview --out NEW_DIR`
works in an initialized Git repository without HEAD. Rebuild after any source change. A non-preview package requires
a clean checkout, a build from that same checkout, full `--sha`, and an existing
`--tag vPACKAGE_VERSION` resolving to that SHA. No fixed historical baseline is
required. `pnpm release:smoke ASSET_DIR NEW_EVIDENCE_DIR` verifies hashes, installs
in a fresh directory, starts compiled code, checks HTTP health/assets, ingests a
real watched filesystem edit, and rejects a foreign database unchanged. An
incomplete smoke run is not installation/runtime acceptance.

CI builds and tests a temporary compiled preview without uploading it. The
manually dispatched release workflow uploads compiled assets only after its
non-preview license gate passes. Neither workflow publishes an npm package or a
GitHub release. Public publication needs authorization and verification of
tag/SHA/assets. Run the full CI gates before using the release
workflow; do not bypass failed tests or audit.

`THIRD-PARTY-NOTICES.md` is included verbatim as a draft (177 production dependency
versions, 176 local license texts and one upstream-linked license text).
`THIRD-PARTY-NOTICES.txt` additionally inventories this machine's installed build
graph. Neither file proves license closure: Linux platform packages, frontend
bundling and native components still require review before public distribution.
Non-preview packaging refuses a notice still marked DRAFT; removing that marker
is a human review decision, not proof produced by the packaging script.
