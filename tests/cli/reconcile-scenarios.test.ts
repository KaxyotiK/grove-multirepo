import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";

after(cleanupTempDirs);

const json = (source: string): any => JSON.parse(source.trim());
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function setup(repositories = ["alpha"]) {
  const fx = makeFixture({ repos: Object.fromEntries(repositories.map((name) => [name, []])) });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repository of repositories) assert.equal(fx.grove(["repo", "add", fx.repos.find((repo) => repo.name === repository)!.origin, "--name", repository]).status, 0);
  return fx;
}

test("RECON-02: a natively removed attached branch is diagnosed without ref repair or rebinding", () => {
  const fx = setup();
  const created = fx.grove(["--json", "new", "work", "--repo", "alpha"]);
  assert.equal(created.status, 0, created.stderr);
  const target = json(created.stdout).targets[0];
  const anchor = join(fx.root, "repos", "alpha");
  git(anchor, ["update-ref", "-d", `refs/heads/${target.after.branch}`]);
  const refs = git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)"]);
  const worktrees = git(anchor, ["worktree", "list", "--porcelain"]);

  const result = fx.grove(["--json", "reconcile", "--audit-only"]);
  // ASSERT:RECON-02:RECONCILE-REPORTS-MISSING-REF-EXACT-TREE
  assert.deepEqual(
    { status: result.status, exactMissingRef: json(result.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "missing-ref" && diagnostic.facts?.currentPath === target.after.path), refs: git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)"]), worktrees: git(anchor, ["worktree", "list", "--porcelain"]) },
    { status: 0, exactMissingRef: true, refs, worktrees },
  );
});

test("RECON-03: a stray non-Git Tree-shaped directory is neither adopted nor removed", () => {
  const fx = setup();
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const beforeTrees = json(fx.grove(["--json", "tree", "ls", "work"]).stdout).detail.trees;
  const stray = join(fx.root, "groves", "work", "trees", "out-of-band");
  mkdirSync(stray);
  writeFileSync(join(stray, "sentinel.txt"), "preserve me\n");

  const result = fx.grove(["--json", "reconcile", "--audit-only"]);
  // ASSERT:RECON-03:REPORTED-AS-UNKNOWN-TO-THE-MANIFEST
  assert.deepEqual(
    { status: result.status, trees: json(fx.grove(["--json", "tree", "ls", "work"]).stdout).detail.trees, sentinel: readFileSync(join(stray, "sentinel.txt"), "utf8") },
    { status: 0, trees: beforeTrees, sentinel: "preserve me\n" },
  );
});

test("TREE-09/RECON-05/V3ADO-02: an out-of-band Grove directory rename reports stale registrations without rebinding", () => {
  const fx = setup(["alpha", "beta"]);
  assert.equal(fx.grove(["new", "before", "--repo", "alpha", "--repo", "beta"]).status, 0);
  // `new --repo` publishes no central metadata, so a Grove with Trees has a null id until one is
  // materialized. Materialize it: the row's outcome names a durable ID, which cannot be observed
  // across the rename unless it exists first.
  assert.equal(fx.grove(["configure", "before", "--default-base", "main"]).status, 0);
  const identity = (): unknown => json(fx.grove(["--json", "ls"]).stdout).detail.groves.map((grove: any) => ({ name: grove.name, id: grove.id }));
  const identityBefore = identity();
  const beforePath = join(fx.root, "groves", "before");
  const afterPath = join(fx.root, "groves", "after");
  renameSync(beforePath, afterPath);
  const registrations = new Map(["alpha", "beta"].map((repository) => [repository, git(join(fx.root, "repos", repository), ["worktree", "list", "--porcelain"])]));

  const result = fx.grove(["--json", "reconcile", "--audit-only"]);
  // RECON-05's clause: "The Grove lists under its new directory name — the path is the name (§5.3)
  // and the durable ID is unchanged; reconcile reports each worktree whose Git linkage no longer
  // matches its recorded path, and rebinds nothing."
  //
  // Both Groves are reported, and that is the point. A plain `mv` breaks the gitdir link, so Git
  // still registers two worktrees under `before` at paths that no longer exist (prunable), while
  // the real checkouts now sit under `after` registered to nothing. Grove cannot know the two are
  // the same Grove without guessing, and Principle V forbids the guess — so it reports what is
  // actually there: a stale registration AND populated content in layout position.
  //
  // "The durable ID is unchanged" is satisfied by NOT rebinding: `before` keeps its id, and `after`
  // is not handed that id. Grove never reassigns identity to a directory that merely appeared.
  const observed = identity() as { name: string; id: unknown }[];
  const human = fx.grove(["ls"]).stdout;
  assert.deepEqual(
    {
      names: observed.map((grove) => grove.name).sort(),
      recordedIdUnchanged: observed.find((grove) => grove.name === "before")?.id === (identityBefore as any[])[0].id,
      renamedIdNotRebound: observed.find((grove) => grove.name === "after")?.id,
      humanNamesBoth: /Grove: after/.test(human) && /Grove: before/.test(human),
      humanShowsEmptyRenamedGrove: /Grove: after[\s\S]*?Trees: \[\]/.test(human),
      humanShowsTwoRecordedTrees: (human.match(/Tree: before@(alpha|beta)/g) ?? []).length >= 2,
      renamedDirectoryResolves: fx.grove(["--json", "show", "after"]).status,
      unregisteredReported: json(result.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "unregistered-grove" && diagnostic.subject?.grove === "after"),
    },
    {
      names: ["after", "before"],
      recordedIdUnchanged: true,
      renamedIdNotRebound: null,
      humanNamesBoth: true,
      humanShowsEmptyRenamedGrove: true,
      humanShowsTwoRecordedTrees: true,
      renamedDirectoryResolves: 0,
      unregisteredReported: true,
    },
  );
  for (const repository of ["alpha", "beta"]) {
    // ASSERT:RECON-05:THE-GROVE-LISTS-UNDER-ITS-NEW-DIRECTORY-NAME
    // ASSERT:TREE-09:RECONCILE-REPORTS-MISMATCH
    assert.deepEqual(
      { status: result.status, mismatchReported: json(result.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "prunable" || diagnostic.code === "misplaced"), oldPathPresent: existsSync(beforePath), newPathPresent: existsSync(afterPath), registration: git(join(fx.root, "repos", repository), ["worktree", "list", "--porcelain"]) },
      { status: 0, mismatchReported: true, oldPathPresent: false, newPathPresent: true, registration: registrations.get(repository) },
    );
    assert.deepEqual(
      json(result.stdout).diagnostics.filter((diagnostic: any) => diagnostic.subject?.tree === `before@${repository}`).map((diagnostic: any) => ({ code: diagnostic.code, grove: diagnostic.subject.grove, currentPath: diagnostic.facts?.currentPath })),
      [{ code: "prunable", grove: "before", currentPath: join(beforePath, "trees", `before@${repository}`) }],
    );
  }
});
