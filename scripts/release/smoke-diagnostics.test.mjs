import assert from "node:assert/strict";
import test from "node:test";
import { classifySmokeFailure } from "./smoke-diagnostics.mjs";

test("classifies install failures without returning log contents", () => {
  const log = "ERR_PNPM_NO_OFFLINE_TARBALL\nprivate-value-sentinel\nEAI_AGAIN";
  assert.deepEqual(classifySmokeFailure(log), [
    "dns-resolution",
    "pnpm-offline-cache-miss",
  ]);
  assert.deepEqual(classifySmokeFailure("private-value-sentinel"), []);
});
