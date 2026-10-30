import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkBrowserNotices } from "./check-browser-notices.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "muses-browser-notice-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "dist/web/assets"), { recursive: true });
  mkdirSync(join(root, "node_modules/demo-package"), { recursive: true });
  writeFileSync(
    join(root, "node_modules/demo-package/index.js"),
    "export default 1;",
  );
  writeFileSync(
    join(root, "node_modules/demo-package/package.json"),
    JSON.stringify({ name: "demo-package", version: "1.2.3" }),
  );
  writeFileSync(
    join(root, "dist/web/assets/app.js.map"),
    JSON.stringify({
      sources: ["../../../node_modules/demo-package/index.js"],
    }),
  );
  writeFileSync(
    join(root, "THIRD-PARTY-NOTICES.md"),
    "# Third-Party Notices\n",
  );
  return root;
}

test("a mapped browser dependency needs an exact name/version notice", (t) => {
  const root = fixture(t);
  assert.throws(() => checkBrowserNotices(root), /no matching notice/);
  writeFileSync(
    join(root, "THIRD-PARTY-NOTICES.md"),
    "# Third-Party Notices\n\n### 1. demo-package@1.2.3\n",
  );
  assert.deepEqual(checkBrowserNotices(root), { sourceMaps: 1, packages: 1 });
});

test("a missing source map fails rather than reporting an empty pass", (t) => {
  const root = fixture(t);
  rmSync(join(root, "dist/web/assets/app.js.map"));
  assert.throws(() => checkBrowserNotices(root), /source maps are missing/);
});
