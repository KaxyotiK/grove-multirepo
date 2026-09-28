/**
 * Make a worktree's git state unreadable, and put it back (T002).
 *
 * Needed because `unknown` is a first-class work-safety state (FR-003, ARCH-23/ARCH-24) and the
 * only honest way to test "the state could not be read" is to actually break the read. Corrupting
 * the `.git` pointer is used in preference to chmod: it behaves identically for root (who ignores
 * permission bits) and on filesystems that do not honour them, so the test is not silently a no-op
 * in CI.
 *
 * Always restore in a `finally` — an unrestored fixture leaks a broken worktree into later tests.
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

export interface Restore {
  restore(): void;
}

/**
 * Break the worktree's link to its object store. `git status` then exits non-zero, which is what
 * `isDirty` reports as `problem` and the classifier must turn into `unknown` rather than "clean".
 */
export function makeWorktreeUnreadable(worktree: string): Restore {
  const dotGit = join(worktree, ".git");
  if (!existsSync(dotGit)) throw new Error(`no .git at ${worktree} — fixture would be a no-op`);
  const saved = readFileSync(dotGit);
  writeFileSync(dotGit, "gitdir: /nonexistent/grove-test-broken\n");
  return {
    restore(): void {
      // Tolerant by design: the caller is usually testing a DESTRUCTIVE command, so by the time
      // teardown runs the worktree may legitimately be gone. Throwing here would turn a passing
      // test into a confusing ENOENT unrelated to what it was asserting.
      if (existsSync(worktree)) writeFileSync(dotGit, saved);
    },
  };
}

/**
 * Move an object store aside so reachability queries against it fail (FR-002a). Distinct from
 * `makeWorktreeUnreadable`: this breaks the *judgment*, not the worktree read, and it is the case
 * where an unparseable count would otherwise be taken as "zero commits at risk".
 */
export function makeStoreUnreadable(store: string): Restore {
  const parked = `${store}.parked`;
  if (!existsSync(store)) throw new Error(`no store at ${store} — fixture would be a no-op`);
  renameSync(store, parked);
  return {
    restore(): void {
      if (existsSync(parked)) renameSync(parked, store);
    },
  };
}
