# Muses local beta — usage / 使用指南

The public beta uses synthesized Web Audio and is intended for one trusted user
on one machine. It does not include the private recording library or its
player/replay experience. / 公开 beta 使用合成音景，面向受信任的单用户本机环境；不包含私有录音曲库及其播放、回放体验。

## Start / 启动

Install Node `>=22.13 <23` and pnpm `11.4.0`. The locked `better-sqlite3`
builds from source during installation: Python 3, `make`, a C/C++ compiler and
Node headers are required. On macOS, install Xcode Command Line Tools; on Linux,
install the distribution's native build tools. `node-gyp` downloads Node headers
unless they are already available locally. The npm registry and header download
normally need network access unless the required files are cached.
The intended platforms are macOS and Linux; see the release evidence for
combinations actually verified. From a new checkout:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. The development API defaults to
`http://127.0.0.1:3001`. Start a watcher in a second terminal:

```bash
pnpm watch -- --dir /path/to/your/project
```

Start the server first. By default the watcher does not read file contents or
send relative paths, but the event subject includes the watched directory's
basename. `--include-paths` explicitly includes relative file paths. Changes
are rate-limited, transient delivery failures have bounded retries, and failed
events are dropped rather than persistently queued.

先启动服务，再运行采集器。默认不读取文件内容、不发送相对路径，但事件
subject 会包含监听目录的名称。只有显式使用 `--include-paths` 才发送相对
路径；事件有速率限制，短暂错误有限重试，失败事件不会持久排队。

## Sound / 声音

The BUILD rule currently needs at least three edit events spanning 90 seconds.
Once the policy issues an audio suggestion, click the dashboard start control.
The browser needs a real user gesture before audio can start. You can pause,
change volume or reverse the current action; manual input takes priority and
starts a cooldown for automatic changes.

当前 BUILD 规则需要至少三次编辑事件，且首尾相隔 90 秒。策略给出建议后，
点击页面上的启动按钮；浏览器需要真实用户手势。你可以暂停、调整音量或
撤回当前操作；手动操作优先，并会开启自动调整冷却期。

Sound is synthesized locally. Browser output measurements do not establish
physical playback or listening comfort; check your device volume and take breaks
as needed. Muses makes no medical or guaranteed-productivity claim.

## Authentication and network / 认证与网络

The default local server is unauthenticated and bound to loopback. Other
processes on the same computer can reach that local API. Do not expose it via a
public tunnel or proxy. The source supports optional authentication; when it is
enabled, an existing session token can be piped from a trusted credential
manager to the watcher with `--token-stdin`. Authenticated watcher targets must
be loopback. Do not put passwords or tokens in arguments or shell history; the
token carries the account's permissions. On 401/403 the watcher stops, and a
new token must be supplied separately.

默认服务不启用认证、只绑定回环地址，同机其他进程仍可访问本地 API。不要
通过公网隧道或代理暴露。源码支持可选认证：启用后可用可信凭据管理器的
管道向 `--token-stdin` 提供已有会话 token；认证采集只允许回环目标。不要把
密码或 token 写入命令参数或 shell 历史；token 拥有对应账户权限，遇到
401/403 采集器会停止，需要重新提供有效 token。

## Data and retention / 数据与保留期

The default source-run database is `.muses/muses.sqlite` under the checkout.
Use a new directory for this beta and back up any data you intend to keep. Do
not point it at an existing database without a separately reviewed migration.

Published raw-event retention defaults to 24 hours and applies to new events
only. Zero disables ingestion. Expired managed events are removed in batches of
at most 500 per minute; backlog may delay deletion. Old history is preserved.
Retention does not guarantee erasure of SQLite free pages, WAL or backups, and
is not access control: `includeExpired=true` or a historical `asOf` query can
return expired rows that have not yet been removed. Session-history retention,
signal weights, application exclusions and screen capture controls are not
implemented; their values are not evidence of enforcement.

源码运行时默认数据库位于项目目录下的 `.muses/muses.sqlite`。请使用新目录，
并自行备份需要保留的数据；未经单独审查，不要指向已有数据库。

发布后的原始事件保留期默认 24 小时，只影响新事件；设为零会停止新事件入库。
到期的新事件每分钟最多清理 500 条，积压可能延迟；旧历史保留。该机制不保证
擦除 SQLite 空闲页、WAL 或备份，也不是访问控制：清理前，`includeExpired=true`
或历史 `asOf` 查询仍可能返回过期记录。会话历史保留、信号权重、应用排除和
屏幕采集控制尚未实现。

## Checks / 检查

Run the commands in the README against this checkout. A green local check does
not prove a remote CI run, a deployed version, a real speaker output or personal
listening acceptance. The private v0.7 recording library and replay are outside
this public beta's supported scope.

请在本检出中运行 README 中的检查命令。本地检查通过并不证明远端 CI、部署版本、
扬声器实际出声或个人听感通过。私有 v0.7 录音曲库及回放不属于本公开 beta 的支持范围。
