/**
 * Temp directories that are actually removed.
 *
 * Create with `tempDir`; each test file calls `after(cleanupTempDirs)` once. The sweep is
 * explicit rather than auto-registered so it can never attach to the wrong file under a
 * module-caching test runner.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];
const retained = new Set<string>();

export interface TempLeakReport {
  active: string[];
  retained: string[];
}

/**
 * A fresh temp directory, resolved through `realpath`.
 *
 * The resolve matters on macOS, where `$TMPDIR` is itself a symlink: a path compared against
 * one Git resolved would differ by the `/private` prefix alone.
 */
export function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `grove-${prefix}-`)));
  made.push(dir);
  return dir;
}

/** Keep a failed run for diagnosis while still making the exception explicit and inspectable. */
export function retainTempDir(dir: string): void {
  if (!made.includes(dir)) throw new Error(`cannot retain unowned temp directory: ${dir}`);
  retained.add(dir);
}

/** Existing paths still owned by this process, split from intentionally retained failures. */
export function tempDirLeaks(): TempLeakReport {
  return {
    active: made.filter((dir) => existsSync(dir) && !retained.has(dir)),
    retained: made.filter((dir) => existsSync(dir) && retained.has(dir)),
  };
}

/** Remove one owned directory without sweeping unrelated tests in the same process. */
export function cleanupTempDir(dir: string): void {
  const index = made.indexOf(dir);
  if (index < 0) throw new Error(`cannot clean unowned temp directory: ${dir}`);
  retained.delete(dir);
  made.splice(index, 1);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Remove everything `tempDir` handed out. Safe to call more than once.
 *
 * `force` because a test that already removed its own directory is not an error, and a
 * cleanup that throws on the way out fails a suite whose tests all passed.
 */
export function cleanupTempDirs(): void {
  for (const dir of made.splice(0)) {
    retained.delete(dir);
    rmSync(dir, { recursive: true, force: true });
  }
}
