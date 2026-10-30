# Security

Muses is a single-user local beta. The default unauthenticated API listens on
loopback; other processes on the same computer can reach it. Do not expose that
API through a public tunnel or proxy.

## Reporting a vulnerability

Please use this repository's **Security → Report a vulnerability** feature
when private vulnerability reporting is enabled. If it is unavailable, contact
the maintainers privately through their GitHub profiles before sharing details.
Do not include credentials, personal activity data or database contents in a
public issue.

Private vulnerability reporting must be enabled and verified in the repository
settings when this project is published.

## Scope

- The watcher reads file-change events, not file contents. Its default event
  subject still includes the watched directory's basename.
- An authenticated watcher accepts an existing session token from a trusted
  pipe and stops on authentication failure; it does not write a token file.
- Event retention applies to new managed events and is not secure deletion or
  access control. Old history, backups and SQLite sidecars can persist.
- The public beta synthesizes audio locally. The private recording library,
  remote hosting and multi-user isolation are outside the supported release.
