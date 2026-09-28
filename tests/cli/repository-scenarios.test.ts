import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (source: string) => JSON.parse(source.trim());
const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function clone(origin: string): string {
  const path = join(tempDir("repository-scenario-clone"), "checkout");
  git(process.cwd(), ["clone", "-q", origin, path]);
  git(path, ["config", "user.email", "repo@grove.test"]);
  git(path, ["config", "user.name", "Repository Test"]);
  return path;
}

function localRepo(): string {
  const path = tempDir("repository-scenario-local");
  git(path, ["init", "-q", "--initial-branch=main"]);
  git(path, ["config", "user.email", "repo@grove.test"]);
  git(path, ["config", "user.name", "Repository Test"]);
  writeFileSync(join(path, "local.txt"), "local\n");
  git(path, ["add", "local.txt"]);
  git(path, ["commit", "-qm", "local"]);
  return path;
}

test("REPO-01: repo link records shared checkout policy, creates no trunk, leaves checkout untouched, and supports Trees", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  const checkout = clone(fx.repos[0]!.origin);
  const before = {
    head: git(checkout, ["rev-parse", "HEAD"]),
    status: git(checkout, ["status", "--porcelain=v2"]),
    worktrees: git(checkout, ["worktree", "list", "--porcelain"]),
    readme: readFileSync(join(checkout, "README.md"), "utf8"),
  };

  const linked = fx.grove(["--json", "repo", "link", checkout, "--name", "linked"]);
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(json(linked.stdout).targets[0].after.commonGitDir, git(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const config = json(fx.grove(["--json", "config", "get"]).stdout);
  const repository = config.repositories.find((repo: { name: string }) => repo.name === "linked");
  assert.deepEqual(repository.location, { kind: "linked", commonGitDir: git(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) });
  assert.deepEqual(json(fx.grove(["--json", "trunk", "ls", "linked"]).stdout).detail.trunks, []);

  const created = fx.grove(["new", "linked-work", "--repo", "linked"]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(json(fx.grove(["--json", "tree", "ls", "linked-work"]).stdout).detail.trees.length, 1);
  assert.deepEqual(
    {
      head: git(checkout, ["rev-parse", "HEAD"]),
      status: git(checkout, ["status", "--porcelain=v2"]),
      readme: readFileSync(join(checkout, "README.md"), "utf8"),
    },
    { head: before.head, status: before.status, readme: before.readme },
  );
  // Consolidated: four clauses, four fields. Two obligations previously rested on the
  // "no default trunk" existsSync alone, which observes neither the recorded kind nor that a Tree
  // can be created from a linked repository.
  // ASSERT:REPO-01:LINKED-IS-RECORDED-CREATES-NO-TRUNK-LEAVES-THE-CHECKOUT-AND-ALLOWS-TREES
  assert.deepEqual(
    {
      recordedKind: json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.find((r: any) => r.name === "linked")?.location.kind,
      noDefaultTrunk: existsSync(join(fx.root, "trunks", "main@linked")) === false,
      checkoutUntouched: git(checkout, ["rev-parse", "HEAD"]) === before.head,
      treeCreatable: fx.grove(["new", "from-linked", "--repo", "linked"]).status,
    },
    { recordedKind: "linked", noDefaultTrunk: true, checkoutUntouched: true, treeCreatable: 0 },
  );
});

test("REPO-02: repo fetch advances only remote-tracking refs, never local branches or worktrees", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  const store = join(fx.root, "repos", "alpha");
  const trunk = json(fx.grove(["--json", "trunk", "ls", "alpha"]).stdout).detail.trunks[0];
  const trunkPath = trunk.path.value;
  const beforeLocal = git(store, ["rev-parse", "refs/heads/main"]);
  const beforeRemote = git(store, ["rev-parse", "refs/remotes/origin/main"]);
  // ASSERT:REPO-02:REMOTE-TRACKING-REFS-ADVANCE-1
  assert.equal(git(trunkPath, ["rev-parse", "HEAD"]), beforeLocal);

  const seed = clone(fx.repos[0]!.origin);
  writeFileSync(join(seed, "remote.txt"), "advanced\n");
  git(seed, ["add", "remote.txt"]);
  git(seed, ["commit", "-qm", "advance remote"]);
  git(seed, ["push", "-q", "origin", "HEAD:main"]);
  const upstream = git(seed, ["rev-parse", "HEAD"]);
  // ASSERT:REPO-02:NO-LOCAL-BRANCH-OR-WORKTREE-MOVES-2
  assert.notEqual(upstream, beforeRemote);

  const fetched = fx.grove(["--json", "repo", "fetch", "alpha"]);
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.equal(json(fetched.stdout).targets[0].reason, null);
  assert.equal(json(fetched.stdout).targets[0].after.status, "fetched-no-integration");
  assert.equal(git(store, ["rev-parse", "refs/remotes/origin/main"]), upstream);
  assert.equal(git(store, ["rev-parse", "refs/heads/main"]), beforeLocal);
  assert.equal(git(trunkPath, ["rev-parse", "HEAD"]), beforeLocal);
  assert.ok(!existsSync(join(trunkPath, "remote.txt")));
});

test("REPO-08: linked checkout claims surface as policy refusals for both trunk add and tree add", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  const checkout = clone(fx.repos[0]!.origin);
  assert.equal(fx.grove(["new", "empty", "--all"]).status, 0);
  assert.equal(fx.grove(["repo", "link", checkout, "--name", "linked"]).status, 0);
  const before = {
    refs: git(checkout, ["for-each-ref", "--format=%(refname)%00%(objectname)"]),
    worktrees: git(checkout, ["worktree", "list", "--porcelain"]),
  };

  const trunkRefusal = fx.grove(["--json", "trunk", "add", "linked", "main"]);
  const treeRefusal = fx.grove(["--json", "tree", "add", "empty", "linked", "--branch", "main"]);
  const trunkError = json(trunkRefusal.stdout).error;
  const treeError = json(treeRefusal.stdout).error;
  // ASSERT:REPO-08:REFUSES-POLICY-ERROR-NAMING-CHECKOUT-NO-RAW-GIT
  assert.deepEqual(
    {
      trunkStatus: trunkRefusal.status,
      trunkKind: trunkError.kind,
      trunkClaimantPath: trunkError.detail.claimantPath,
      treeStatus: treeRefusal.status,
      treeKind: treeError.kind,
      treeClaimantPath: treeError.detail.claimantPath,
      rawGitLeak: /fatal:|preparing worktree/i.test(trunkRefusal.stdout + treeRefusal.stdout),
      after: {
        refs: git(checkout, ["for-each-ref", "--format=%(refname)%00%(objectname)"]),
        worktrees: git(checkout, ["worktree", "list", "--porcelain"]),
      },
      trunks: json(fx.grove(["--json", "trunk", "ls", "linked"]).stdout).detail.trunks,
      trees: json(fx.grove(["--json", "tree", "ls", "empty"]).stdout).detail.trees,
    },
    {
      trunkStatus: 3,
      trunkKind: "refused-policy",
      trunkClaimantPath: checkout,
      treeStatus: 4,
      treeKind: "refused-conflict",
      treeClaimantPath: checkout,
      rawGitLeak: false,
      after: before,
      trunks: [],
      trees: [],
    },
  );
});

test("REPO-09: all-repository fetch/sync skip no-remote repos, while explicit targeting exits 5", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "managed"]);
  const local = localRepo();
  fx.grove(["repo", "link", local, "--name", "offline", "--trunk", "main"]);

  const fetched = fx.grove(["--json", "repo", "fetch"]);
  // The contract has always read "The no-remote repository is SKIPPED and reported; naming it
  // explicitly exits 5." The aggregate case exited 5 anyway, and this witness asserted that defect
  // — under a title that stated the contract correctly. U-9/V3HLP-02 fixed the behaviour; this
  // assertion now matches the promise instead of the bug.
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.deepEqual(json(fetched.stdout).targets.map((target: any) => [target.selector.repositoryAlias, target.reason]), [["managed", null], ["offline", "skipped-no-remote"]]);
  const synced = fx.grove(["--json", "trunk", "sync"]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.equal(json(synced.stdout).targets.some((target: any) => target.selector.repositoryAlias === "offline"), false);

  const namedFetch = fx.grove(["repo", "fetch", "offline"]);
  const namedSync = fx.grove(["trunk", "sync", "offline"]);
  // ASSERT:REPO-09:NO-REMOTE-REPOSITORY-SKIPPED-REPORTED-NAMING-EXPLICITLY-EXITS
  assert.deepEqual(
    {
      aggregateFetch: json(fetched.stdout).targets.map((target: any) => [target.selector.repositoryAlias, target.reason]),
      aggregateSyncSkippedOffline: json(synced.stdout).targets.some((target: any) => target.selector.repositoryAlias === "offline"),
      namedFetchStatus: namedFetch.status,
      namedFetchReportsNoRemote: /no-remote|preferred remote/i.test(namedFetch.stderr + namedFetch.stdout),
      namedSyncStatus: namedSync.status,
      namedSyncReportsLinked: /linked|trunk/i.test(namedSync.stderr + namedSync.stdout),
    },
    {
      aggregateFetch: [["managed", null], ["offline", "skipped-no-remote"]],
      aggregateSyncSkippedOffline: false,
      namedFetchStatus: 5,
      namedFetchReportsNoRemote: true,
      namedSyncStatus: 3,
      namedSyncReportsLinked: true,
    },
  );
});

test("REPO-10: repo add derives the URL basename and duplicate derivation requires an explicit --name", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  const first = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin]);
  assert.equal(first.status, 0, first.stderr);
  const duplicate = fx.grove(["repo", "add", fx.repos[0]!.origin]);
  // ASSERT:REPO-10:NAME-DERIVES-URL-S-FINAL-PATH-SEGMENT-MINUS
  assert.deepEqual(
    {
      derivedName: json(first.stdout).targets[0].selector.repositoryAlias,
      duplicateStatus: duplicate.status,
      namesDerivedClaimant: /alpha/.test(duplicate.stderr),
      namesRemedy: /--name/.test(duplicate.stderr),
    },
    { derivedName: "alpha", duplicateStatus: 4, namesDerivedClaimant: true, namesRemedy: true },
    duplicate.stderr,
  );
});
