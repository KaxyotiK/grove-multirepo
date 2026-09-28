/**
 * The work-safety fixture (T001).
 *
 * Research R4 established that BOTH wrong `rev-list` spellings pass against a repository
 * containing only safe branches — so a fixture without a genuinely unreachable commit proves
 * nothing about the predicate. Everything in the work-safety suite builds on this.
 *
 * Five branch shapes, plus a sibling pair:
 *   merged  — commit merged into the trunk, never pushed under its own name  → safe in both scopes
 *   unique  — commit reachable from nothing else                             → at risk in both
 *   tagged  — commit reachable only via a tag                                → safe in A, at risk in B
 *   pushed  — has an `origin/` counterpart                                   → safe in both
 *   pairA / pairB — two branches on one otherwise-unreachable commit; each vouches for the
 *                   other when judged alone, which is the FR-001a data-loss path.
 *
 * Offline: the "remote" is a local bare repository, reached by path.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tempDir } from "./tmp.ts";

export interface SafetyRepo {
  /** Bare "remote". */
  origin: string;
  /** Non-bare clone holding every branch shape. Use as both worktree and object store. */
  store: string;
  /** Branch names present, for exhaustive iteration in tests. */
  branches: {
    merged: string;
    unique: string;
    tagged: string;
    pushed: string;
    pairA: string;
    pairB: string;
  };
  /** The tag that holds `tagged`'s commit alive under scope A. */
  tag: string;
}

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

/**
 * Build the fixture. The siblings are opt-in: they sit on their own commit off `main`, so they do
 * not perturb `unique`'s answer, but keeping them out of the default keeps each test's reachability
 * graph as small as the claim it is making. During research, creating sibling refs that pointed at
 * `unique` silently changed its answer and produced two misleading readings — hence the separation.
 */
export function makeSafetyRepo(opts: { withSiblings?: boolean; withAmbiguousTag?: boolean } = {}): SafetyRepo {
  const base = tempDir("safety");
  const origin = join(base, "origin.git");
  const store = join(base, "store");

  git(base, ["init", "-q", "--bare", "--initial-branch=main", origin]);
  git(base, ["clone", "-q", origin, store]);
  git(store, ["config", "user.email", "fixture@grove.test"]);
  git(store, ["config", "user.name", "Fixture"]);

  const commit = (msg: string, file: string): void => {
    execFileSync("sh", ["-c", `printf '%s\\n' "${msg}" > "${file}"`], { cwd: store });
    git(store, ["add", "-A"]);
    git(store, ["commit", "-qm", msg]);
  };

  commit("base", "base.txt");
  git(store, ["push", "-q", "-u", "origin", "main"]);

  // merged: lands in main, never pushed under its own name.
  git(store, ["checkout", "-qb", "merged"]);
  commit("merged", "merged.txt");
  git(store, ["checkout", "-q", "main"]);
  git(store, ["merge", "-q", "--no-ff", "merged", "-m", "land merged"]);
  git(store, ["push", "-q", "origin", "main"]);

  // unique: reachable from nothing else.
  git(store, ["checkout", "-qb", "unique", "main"]);
  commit("unique", "unique.txt");

  // tagged: reachable only via a tag.
  git(store, ["checkout", "-qb", "tagged", "main"]);
  commit("tagged", "tagged.txt");
  git(store, ["tag", "keep-me"]);

  // pushed: has an origin/ counterpart.
  git(store, ["checkout", "-qb", "pushed", "main"]);
  commit("pushed", "pushed.txt");
  git(store, ["push", "-q", "-u", "origin", "pushed"]);

  if (opts.withAmbiguousTag ?? false) {
    // A branch and a TAG sharing one name, pointing at DIFFERENT commits. git's bare-ref
    // disambiguation prefers refs/tags, so any query using the short name silently answers about
    // the wrong object. The branch's commit is reachable from nothing else; the tag's is on main.
    git(store, ["checkout", "-qb", "dual", "main"]);
    commit("dual-branch-commit", "dual.txt");
    git(store, ["checkout", "-q", "main"]);
    git(store, ["tag", "dual", "main"]);
  }

  if (opts.withSiblings ?? false) {
    // Two refs on one otherwise-unreachable commit.
    git(store, ["checkout", "-qb", "pairA", "main"]);
    commit("shared", "shared.txt");
    git(store, ["branch", "-q", "pairB", "pairA"]);
  }

  git(store, ["checkout", "-q", "main"]);
  git(store, ["fetch", "-q", "origin"]);

  return {
    origin,
    store,
    branches: { merged: "merged", unique: "unique", tagged: "tagged", pushed: "pushed", pairA: "pairA", pairB: "pairB" },
    tag: "keep-me",
  };
}
