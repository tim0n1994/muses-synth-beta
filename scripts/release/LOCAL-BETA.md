# Compiled synth beta bundle / 合成音景发布包

## 中文快速开始与隐私说明

本发布包面向受信任的单用户本机环境，使用浏览器 Web Audio 合成声音，不包含
私有录音曲库及其播放器、回放。需要 Node `>=22.13 <23`、pnpm `11.4.0`；支持
Linux/macOS，Windows 需使用 WSL2。安装 SQLite 依赖还需 Python 3、`make`、
C/C++ 编译器及 Node 头文件，未缓存时安装需要联网。

解压前核对 `SHA256SUMS`。在解压目录执行下方命令：先安装、启动，再在另一终端
显式选择监听目录。启动后打开 `http://127.0.0.1:3001`，中文网页指南位于
`http://127.0.0.1:3001/guide-beta.html`（自定义端口时请替换端口）。声音需要点击启动。

发布包启动器清除继承的认证设置并强制关闭认证，设置 `MUSES_AUTH_ENABLED=true`
不会开启认证；可选认证仅适用于源码模式。默认不读取文件内容或发送相对路径，
但事件 subject 包含监听目录名；相对路径需显式使用 `--include-paths`。
同机其他进程仍可访问本地 API，不要通过隧道或代理向外暴露。

发布的原始事件保留期默认 24 小时，只影响新事件；设为零停止新事件入库。
启动时清理一批到期的受管理事件，此后每 60 秒最多清理 500 条，积压可能延迟删除。
旧历史保留；SQLite 空闲页、WAL 和备份不保证擦除。清理前，`includeExpired=true`
或历史 `asOf` 查询仍可能返回过期记录；保留期不是访问控制。
信号开关、原始信号保留开关、信号权重、应用排除、会话历史保留以及屏幕采集及其
控制尚未实现；更改这些设置会被拒绝（HTTP 409 `SETTINGS_PRIVACY_UNSUPPORTED`），
已保存的值不代表实际执行。数据库及日志保存在发布包自己的 `.muses/` 中，请保管并备份。

## English quick start and privacy

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

Setting `MUSES_AUTH_ENABLED=true` does not enable authentication in this
bundle; optional authentication is supported in source mode only. Other local
processes can still reach the API. Do not expose it through a tunnel or proxy.
Open `http://127.0.0.1:3001` after starting; the bilingual browser guide is at
`http://127.0.0.1:3001/guide-beta.html` (replace the port if customized).

Published raw-event retention defaults to 24 hours and applies only to new
events. Zero disables new-event ingestion. Cleanup runs one batch at startup,
then removes at most 500 expired managed events every 60 seconds; backlog may
delay deletion. Legacy history is preserved; erasure of SQLite free pages, WAL
and backups is not guaranteed. Before cleanup, `includeExpired=true` or a
historical `asOf` query can still return expired rows; retention is not access
control. Signal enable/disable, raw-signal retention switches, signal weights,
application exclusions, session-history retention, and screen collection and
its controls are not implemented. Changes to these settings are rejected with
HTTP 409 `SETTINGS_PRIVACY_UNSUPPORTED`; stored values do not establish
enforcement. Keep the bundle's database and logs private and back them up.

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

`THIRD-PARTY-NOTICES.md` is included verbatim with the owner's reviewed scope
(177 production dependency versions, 176 local license texts and one
upstream-linked license text).
`THIRD-PARTY-NOTICES.txt` additionally inventories this machine's installed build
graph. Packaging rechecks the installed production versions and license texts,
mapped browser dependencies, the reviewed unmapped build helper and CSS asset.
A changed graph or asset requires review; these checks do not approve untested platforms.
Non-preview packaging refuses a notice marked DRAFT.
