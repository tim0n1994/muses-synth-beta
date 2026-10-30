import { basename, sep } from "node:path";

/**
 * Directories that generate change storms and carry no signal about what the
 * developer is doing. Watching them is the difference between one event per
 * edit and one per `pnpm install`.
 */
export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".vite",
  ".cache",
  ".muses",
  "test-results",
  "playwright-report",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
];

/** Editor scratch and OS metadata: a change here is not a developer action. */
const IGNORED_FILE_PATTERNS: readonly RegExp[] = [
  /^\.DS_Store$/u,
  /^Thumbs\.db$/u,
  /~$/u,
  /^\..*\.swp$/u,
  /^\..*\.swx$/u,
  /^4913$/u, // vim's write-probe file
  /\.tmp$/u,
  /^\.#/u, // emacs lock files
];

export interface IgnoreOptions {
  readonly extraDirectories?: readonly string[];
}

export function createIgnoreFilter(
  options: IgnoreOptions = {},
): (relativePath: string) => boolean {
  const directories = new Set([
    ...DEFAULT_IGNORED_DIRECTORIES,
    ...(options.extraDirectories ?? []),
  ]);

  return (relativePath: string): boolean => {
    if (relativePath.length === 0) {
      return true;
    }
    const segments = relativePath.split(sep).filter((s) => s.length > 0);
    for (const segment of segments.slice(0, -1)) {
      if (directories.has(segment)) {
        return true;
      }
    }
    // A watched *file* named like an ignored directory is still noise worth
    // skipping (a stray `dist` file), so the last segment is checked too.
    const name = basename(relativePath);
    if (directories.has(name)) {
      return true;
    }
    return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(name));
  };
}
