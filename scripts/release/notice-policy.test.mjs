import assert from "node:assert/strict";
import test from "node:test";
import { assertNoticeReady } from "./notice-policy.mjs";

test("a draft notice permits only a local preview", () => {
  const draft = "# Third-Party Notices — DRAFT\nPending platform review.\n";
  assert.doesNotThrow(() => assertNoticeReady(draft, true));
  assert.throws(() => assertNoticeReady(draft, false), /distribution blocked/);
});

test("a nonempty reviewed notice can proceed to other release gates", () => {
  assert.doesNotThrow(() =>
    assertNoticeReady("# Third-Party Notices\nReviewed.\n", false),
  );
  assert.throws(() => assertNoticeReady("", true), /missing/);
});
