#!/bin/sh
# Retired: the standalone shell collector stored credentials and had divergent
# directory, event-ID and retry semantics. Keep this public URL fail-closed.
# Do not inspect arguments, legacy config, stdin, or start background processes.
set +x
printf '%s\n' \
  'The standalone Muses shell collector has been retired for local beta.' \
  'From an installed Muses checkout, use: pnpm watch -- --dir /explicit/workspace' \
  'For auth-on, pipe a session token from a trusted credential manager and add --token-stdin.' \
  'Run pnpm watch -- --help for credentials, permissions and directory semantics.' \
  'Do not pass passwords or tokens as arguments. Legacy credentials are not read or migrated.' \
  'If you used the old collector, manually remove its saved credentials and rotate the account password.' >&2
exit 64
