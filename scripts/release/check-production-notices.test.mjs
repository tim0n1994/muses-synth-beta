import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateProductionNotices } from "./check-production-notices.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "muses-production-notice-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const license = "Copyright example\nPermission granted.\n";
  const sha = createHash("sha256").update(license).digest("hex");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0" }),
  );
  writeFileSync(join(root, "LICENSE"), license);
  const notice = `### 1. fixture@1.0.0\n\nDeclared SPDX: \`MIT\`.\n\nSource: \`node_modules/fixture/LICENSE\`.\n\nOriginal-file SHA-256: \`${sha}\`.\n\n\`\`\`text\n${license}\`\`\`\n`;
  const inventory = {
    MIT: [{ name: "fixture", versions: ["1.0.0"], paths: [root] }],
  };
  return { root, notice, inventory };
}

test("checks installed production versions, SPDX and full license text", (t) => {
  const { root, notice, inventory } = fixture(t);
  assert.equal(
    validateProductionNotices(notice, inventory).productionPackages,
    1,
  );
  assert.throws(() =>
    validateProductionNotices(
      notice.replace("fixture@1.0.0", "fixture@2.0.0"),
      inventory,
    ),
  );
  assert.throws(() =>
    validateProductionNotices(notice.replace("`MIT`", "`ISC`"), inventory),
  );
  assert.throws(
    () =>
      validateProductionNotices(notice, {
        MIT: [{ ...inventory.MIT[0], versions: ["1.0.0", "2.0.0"] }],
      }),
    /Inventory version missing installed package/,
  );
  assert.throws(() =>
    validateProductionNotices(
      notice.replace("Permission granted.", "Changed."),
      inventory,
    ),
  );
  writeFileSync(join(root, "LICENSE"), "altered\n");
  assert.throws(
    () => validateProductionNotices(notice, inventory),
    /license changed/,
  );
});
