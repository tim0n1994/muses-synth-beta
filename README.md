# Muses

### Your work leaves signals. Your soundscape can respond.

Muses is a **local-first developer soundscape**: it turns observable editing
activity into an explainable state, then suggests a reversible synthetic sound.
You start the audio. You can pause it at any time.

[简体中文](README.zh-CN.md) · [Usage](docs/USAGE.md) · [Security](SECURITY.md) · [MIT license](LICENSE)

```text
file changes → local events → explainable state → audio suggestion
                                                 ↓
                            your click → synthetic sound → recorded outcome
```

The public beta generates its sound in the browser with Web Audio. It does not
ship the private recording library or require a cloud account. The soundscape
is an experiment, not a medical treatment or a guarantee of focus.

## Try it locally

Requirements: Node `>=22.13 <23`, pnpm `11.4.0`, and a browser with Web Audio.
The locked SQLite dependency builds locally and also needs Python 3, `make`, a
C/C++ compiler and Node headers. See the [usage guide](docs/USAGE.md) for details.
From a checkout of this repository:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:5173**. In another terminal, choose the directory you
want to observe:

```bash
pnpm watch -- --dir /path/to/your/project
```

Work in that directory. The current BUILD rule needs at least three editing
events across 90 seconds before it can suggest an audio profile. When a
suggestion appears, use the dashboard's start control; browser audio requires
your gesture. Pause or adjust the sound whenever you choose.

## What is in this beta

- **Observe:** the watcher reports file-change activity without reading file
  contents. Relative paths are omitted by default; the watched directory's
  basename is included in the event subject.
- **Explain:** local state and policy expose the evidence behind a suggestion.
- **Act reversibly:** an explicit click starts synthesized sound. Manual
  controls take priority over automatic adjustments.
- **Keep it local:** the default server binds to loopback and needs no cloud
  account. An unauthenticated local server can still be reached by other
  processes on the same machine; do not expose it through a tunnel or proxy.

This is a single-user local beta. The private recording library, its player and
replay experience, cloud sync, remote hosting and multi-user isolation are not
part of this public distribution. Audio output and listening comfort vary by
browser and device.

## Data and privacy

Raw-event retention defaults to 24 hours and applies to **new** events. A
published value of zero disables new-event ingestion. Expired managed events
are deleted in batches; old history, SQLite free space, WAL and backups are
not automatically erased. Retention is not access control: historical API
queries can return expired rows until cleanup. See the [usage guide](docs/USAGE.md)
before enabling authentication or changing privacy settings.

## Check the code

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:release
pnpm check:public
pnpm check:secrets # requires gitleaks 8.30.1
pnpm build
pnpm test:e2e:install
pnpm test:e2e
pnpm test:e2e:media
pnpm audit:prod
```

Tests and a browser audio signal are evidence of software behavior; they do
not establish a person's listening experience or a production deployment.

## License

Muses source code is available under the [MIT License](LICENSE).
Third-party dependencies retain their own licenses; see the
[dependency notice inventory](THIRD-PARTY-NOTICES.md) and its stated limits.
