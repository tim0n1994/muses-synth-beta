# Muses Repository Instructions

## Product

Muses is a local-first developer state companion. It observes explicit development events, maintains an explainable belief state, and adapts a reversible Web Audio soundscape. It is not a medical product, a general autonomous agent, or a production-ready multi-user service.

The public single-user synthetic-audio beta is described by `README.md`,
`README.zh-CN.md`, and `docs/USAGE.md`. Its supported scope excludes the
private recording library, its player and replay.

## Engineering boundaries

- Use pnpm, TypeScript strict mode, React, Vite, Fastify and SQLite.
- Prefer mature, maintained OSS. Pin versions and commit the lockfile.
- Keep browser observations and model-produced text untrusted.
- Never execute arbitrary HTML, JavaScript, shell commands or tool calls from configuration.
- Settings must be validated and persisted by the local server. `localStorage` is not an authority.
- Preserve draft, published and rollback semantics.
- Only the audio executor may execute automatically.
- Manual user input always wins. `NO_ACTION` and `Unknown` are first-class outcomes.
- The application must work without a cloud account or private API key.
- Do not commit, push, deploy, migrate a real database or touch real user data without explicit user authorization.

## Required gates

Once source exists, the root commands must cover:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:contracts`
- `pnpm build`
- `pnpm test:e2e`
- `pnpm audit:prod`

Do not describe fixtures, seeded local data or mocked browser tests as production validation.
