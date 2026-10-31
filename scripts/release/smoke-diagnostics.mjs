// Emit stable classifications, never raw subprocess output or credentials.
export function classifySmokeFailure(log) {
  const categories = new Set();
  const signatures = [
    [/\bERR_PNPM_NO_OFFLINE_TARBALL\b/, "pnpm-offline-cache-miss"],
    [/\b(?:EAI_AGAIN|ENOTFOUND)\b/, "dns-resolution"],
    [/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED)\b/, "network-connection"],
    [/gyp ERR! find Python/i, "native-build-python-missing"],
    [/gyp ERR! build error/i, "native-build-failed"],
    [/\b(?:EACCES|EPERM)\b|permission denied/i, "filesystem-permission"],
    [
      /\b(?:CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/,
      "tls-certificate",
    ],
  ];
  for (const [pattern, name] of signatures) {
    if (pattern.test(log)) categories.add(name);
  }
  return [...categories].sort();
}
