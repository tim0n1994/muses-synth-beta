# Module 09 test suites

This directory is black-box only. It must not import `src/server/**` or `src/web/**` feature modules.

- `unit/`: test harness and security-oracle unit tests.
- `contracts/`: strict Ajv JSON Schema registry plus live API envelope checks.
- `e2e/`: Playwright product flows, security mutation tests, and axe accessibility smoke.
- `fixtures/`: deterministic JSONL replay, static settings payloads, and a minimal harness-only stub.

The stub server is not a product implementation and must not be used as evidence that Muses feature tests pass.
