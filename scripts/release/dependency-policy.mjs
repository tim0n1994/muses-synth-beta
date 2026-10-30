// Preserve install-time native build approvals and dependency overrides while
// removing ALL audit exemptions from temporary audit copies and release bundles.
export function withoutAuditExemptions(workspace) {
  let dropping = false;
  const result = [];
  for (const line of workspace.split("\n")) {
    if (/^auditConfig\s*:/.test(line)) {
      // Remove the adjacent obsolete audit-policy commentary as well.
      while (result.length && /^\s*(#.*)?$/.test(result.at(-1))) result.pop();
      dropping = true;
      continue;
    }
    if (dropping && /^[^\s#]/.test(line)) dropping = false;
    if (!dropping) result.push(line);
  }
  return `${result.join("\n").trimEnd()}\n`;
}
