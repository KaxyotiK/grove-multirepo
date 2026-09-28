import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { CLI, makeFixture, type Fixture, type RunResult } from "../testkit/fixture.ts";

after(cleanupTempDirs);

const json = (source: string): any => JSON.parse(source.trim());
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const refExists = (store: string, branch: string): boolean => { try { git(store, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]); return true; } catch { return false; } };

function setup(name = "ledger") {
  const fx = makeFixture({ repos: { origin: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", name]).status, 0);
  return { fx, store: join(fx.root, "repos", name), repo: name };
}

function trees(fx: Fixture, grove: string): any[] {
  const result = fx.grove(["--json", "tree", "ls", grove]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return json(result.stdout).detail.trees;
}

function runAsync(fx: Fixture, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

test("TREE-01/TREE-02/TREE-04: exact branch refs coexist behind explicit portable Tree identities", () => {
  const { fx, repo } = setup();
  assert.equal(fx.grove(["new", "paths", "--repo", repo]).status, 0);
  for (const [name, branch] of [["slash", "feature/pricing"], ["underscore", "feature_pricing"], ["at", "team@experiment"]] as const) {
    const added = fx.grove(["tree", "add", "paths", repo, "--name", name, "--branch", branch, "--from", "main"]);
    assert.equal(added.status, 0, `${branch}: ${added.stderr}\n${added.stdout}`);
  }
  const observed = trees(fx, "paths");
  // ASSERT:TREE-04:ALLOCATES-TEAM-40EXPERIMENT-REPO
  assert.deepEqual(observed.map((tree) => tree.tree).sort(), ["at", "paths@ledger", "slash", "underscore"]);
  const slashTree = observed.find((tree: any) => tree.branch.value === "refs/heads/feature/pricing");
  // ASSERT:TREE-01:PORTABLE-IDENTITIES-COEXIST-AND-THE-MANIFEST-RETAINS-EXACT-BRANCHES
  assert.deepEqual(
    {
      allocatedPath: slashTree?.path.value.endsWith("/slash"),
      exactBranch: slashTree?.branch.value,
    },
    { allocatedPath: true, exactBranch: "refs/heads/feature/pricing" },
  );
  // ASSERT:TREE-02:ALLOCATES-TREE-ID-SUFFIXED-FOLDER-IDENTITIES-REMAIN-DISTINCT
  assert.deepEqual(
    {
      identities: observed.map((tree) => tree.tree).sort(),
      distinctPortablePaths: new Set(observed.map((tree) => tree.path.value.toLowerCase())).size,
    },
    {
      identities: ["at", "paths@ledger", "slash", "underscore"],
      distinctPortablePaths: 4,
    },
  );
});

test("TREE-07: an invalid Git ref is refused before Tree path or ref mutation", () => {
  const { fx, store, repo } = setup();
  assert.equal(fx.grove(["new", "invalid-ref", "--repo", repo]).status, 0);
  const before = git(store, ["for-each-ref", "--format=%(refname)%00%(objectname)"]);
  const result = fx.grove(["tree", "add", "invalid-ref", repo, "--name", "broken", "--branch", "bad..ref", "--from", "main"]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(git(store, ["for-each-ref", "--format=%(refname)%00%(objectname)"]), before);
  // ASSERT:TREE-07:REFUSES-BEFORE-PATH-ALLOCATION-GIT-MUTATION
  assert.equal(existsSync(join(fx.root, "groves", "invalid-ref", "trees", "broken")), false);
});

test("TREE-08/TREE-11/TREE-12: repository and Grove aliases reject collisions and invalid names before mutation", () => {
  const fx = makeFixture({ repos: { origin: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "API"]).status, 0);
  // ASSERT:TREE-08:REFUSES-SECOND-PORTABLE-NAME-COLLISION
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "api"]).status, 4);
  assert.equal(fx.grove(["new", "Pricing", "--repo", "API"]).status, 0);
  // ASSERT:TREE-11:SECOND-REFUSES-UNDER-ASCII-CASE-FOLDED-UNIQUENESS-5
  assert.equal(fx.grove(["new", "pricing", "--repo", "API"]).status, 4);
  for (const invalid of ["a/b", ".archive"]) {
    // ASSERT:TREE-12:EXITS-2-BEFORE-ANY-MUTATION
    assert.equal(fx.grove(["new", invalid, "--all"]).status, 2);
  }
  assert.deepEqual(json(fx.grove(["--json", "repo", "ls"]).stdout).detail.repositories.map((repo: any) => repo.name), ["API"]);
});

test("TREE-10: concurrent creation of one exact Tree target serializes without clobbering", async () => {
  const { fx, repo } = setup();
  assert.equal(fx.grove(["new", "race", "--repo", repo]).status, 0);
  const [left, right] = await Promise.all([
    runAsync(fx, ["tree", "add", "race", repo, "--name", "winner", "--branch", "feature/race-a", "--from", "main"]),
    runAsync(fx, ["tree", "add", "race", repo, "--name", "winner", "--branch", "feature/race-b", "--from", "main"]),
  ]);
  // ASSERT:TREE-10:LOCKS-PRODUCE-UNIQUE-DIRECTORIES-VALID-MANIFESTS
  assert.deepEqual(
    {
      successfulCreators: [left.status, right.status].filter((status) => status === 0).length,
      validObservedTrees: trees(fx, "race").filter((tree) => tree.tree === "winner").length,
    },
    { successfulCreators: 1, validObservedTrees: 1 },
  );
});

test("TREE-14: remote-only branch adoption tracks upstream and lifecycle retains the ref", () => {
  const { fx, store, repo } = setup();
  git(fx.repos[0]!.origin, ["update-ref", "refs/heads/remote-only", "refs/heads/main"]);
  assert.equal(fx.grove(["repo", "fetch", repo]).status, 0);
  const created = fx.grove(["new", "remote-adopt", "--repo", repo, "--branch", `${repo}=remote-only`]);
  const upstream = git(store, ["for-each-ref", "--format=%(upstream:short)", "refs/heads/remote-only"]);
  const deleted = fx.grove(["delete", "remote-adopt", "--allow-destructive-all"]);
  // ASSERT:TREE-14:LOCAL-BRANCH-IS-CREATED-AT-THE-REMOTE-TRACKING
  assert.deepEqual({ createStatus: created.status, upstream, deleteStatus: deleted.status, refRetained: refExists(store, "remote-only") }, { createStatus: 0, upstream: "origin/remote-only", deleteStatus: 0, refRetained: true });
});

test("TREE-15/TREE-16: derived existing branches and unselected overrides refuse without mutation", () => {
  const { fx, store, repo } = setup();
  git(store, ["branch", "feature/local", "main"]);
  const before = git(store, ["for-each-ref", "--format=%(refname)%00%(objectname)"]);
  const existing = fx.grove(["new", "local", "--repo", repo, "--prefix", "feature/"]);
  const unselected = fx.grove(["new", "wrong", "--repo", repo, "--branch", "other=topic", "--from", "other=main"]);
  // ASSERT:TREE-15:REFUSES-NAMES-BRANCH-REMEDY-EXPLICIT-BRANCH-ADOPTION-NO
  assert.deepEqual(
    {
      status: existing.status,
      namesBranch: /feature\/local/.test(existing.stderr + existing.stdout),
      namesAdoptionRemedy: /--branch|adopt/i.test(existing.stderr + existing.stdout),
      refs: git(store, ["for-each-ref", "--format=%(refname)%00%(objectname)"]),
    },
    { status: 4, namesBranch: true, namesAdoptionRemedy: true, refs: before },
  );
  // ASSERT:TREE-16:EXITS-2-BEFORE-ANY-MUTATION
  assert.deepEqual(
    { status: unselected.status, refs: git(store, ["for-each-ref", "--format=%(refname)%00%(objectname)"]) },
    { status: 2, refs: before },
  );
});

test("TREE-17/TREE-19/TREE-21: prefixes and explicit bases create exact refs which removal retains", () => {
  const { fx, store, repo } = setup();
  assert.equal(fx.grove(["config", "set", "--values", JSON.stringify({ defaults: { branchPrefix: "team/" } })]).status, 0);
  assert.equal(fx.grove(["new", "defaulted", "--repo", repo]).status, 0);
  // "`--prefix` overrides the default" is its own clause and was never exercised — the test only
  // ever used the configured default, so nothing could observe an override.
  assert.equal(fx.grove(["new", "overridden", "--repo", repo, "--prefix", "jc/"]).status, 0);
  // ASSERT:TREE-17:PREFIXES-DERIVE-AND-OVERRIDE-AND-BASE-AT-THE-EFFECTIVE-DEFAULT
  assert.deepEqual(
    {
      derivedFromDefault: refExists(store, "team/defaulted"),
      prefixOverrides: refExists(store, "jc/overridden") && refExists(store, "team/overridden") === false,
      baseOid: git(store, ["rev-parse", "refs/heads/team/defaulted"]),
    },
    { derivedFromDefault: true, prefixOverrides: true, baseOid: git(store, ["rev-parse", "refs/heads/main"]) },
  );
  const added = fx.grove(["tree", "add", "defaulted", repo, "--name", "from-main", "--branch", "from-ready", "--from", "main"]);
  // ASSERT:TREE-19:THE-FIRST-RECORDS-ADOPTED
  assert.deepEqual({ status: added.status, refCreated: refExists(store, "from-ready") }, { status: 0, refCreated: true });
  const beforeOid = git(store, ["rev-parse", "refs/heads/from-ready"]);
  const removedPath = trees(fx, "defaulted").find((tree) => tree.tree === "from-main").path.value;
  const removed = fx.grove(["tree", "remove", "defaulted", "from-main"]);
  assert.equal(git(store, ["rev-parse", "refs/heads/from-ready"]), beforeOid);
  // ASSERT:TREE-21:WORKTREE-TORN-DOWN-MANIFEST-DROPS-THE-TREE-CLAIM
  assert.deepEqual(
    { status: removed.status, worktreePresent: existsSync(removedPath), retainedOid: git(store, ["rev-parse", "refs/heads/from-ready"]) },
    { status: 0, worktreePresent: false, retainedOid: beforeOid },
  );
  assert.equal(fx.grove(["tree", "add", "defaulted", repo, "--name", "reclaimed", "--branch", "from-ready"]).status, 0);
});

test("TREE-22: dirty Tree removal refuses; force discards files but retains its branch", () => {
  const { fx, store, repo } = setup();
  assert.equal(fx.grove(["new", "dirty", "--repo", repo]).status, 0);
  const tree = trees(fx, "dirty")[0];
  writeFileSync(join(tree.path.value, "uncommitted.txt"), "not committed\n");
  const refused = fx.grove(["tree", "remove", "dirty", tree.tree]);
  const oid = git(store, ["rev-parse", tree.branch.value]);
  const forced = fx.grove(["tree", "remove", "dirty", tree.tree, "--allow-destructive-all"]);
  // ASSERT:TREE-22:REFUSES-FIRST-FORCED-REMOVAL-WARNS-UNCOMMITTED-CHANGES-DESTROYED
  assert.deepEqual({ refusedStatus: refused.status, forcedStatus: forced.status, worktreePresent: existsSync(tree.path.value), retainedOid: git(store, ["rev-parse", tree.branch.value]) }, { refusedStatus: 5, forcedStatus: 0, worktreePresent: false, retainedOid: oid });
});

test("TREE-23/V3NEW-01: an empty Grove can be created before repositories and populated later", () => {
  // Rebuilt (P4.1). The original registered NO repositories before creating the empty Grove, so
  // "zero Trees" was true no matter what `new` did — it passed against the very defect ruling ①
  // exists to fix. Two repositories are registered FIRST, so an implicit fan-out would now show up.
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[1]!.origin, "--name", "beta"]).status, 0);
  const refsBefore = ["alpha", "beta"].map((repo) => execFileSync("git", ["show-ref"], { cwd: join(fx.root, "repos", repo), encoding: "utf8" }));

  const created = fx.grove(["--json", "new", "empty"]);
  assert.equal(fx.grove(["new", "archive-empty"]).status, 0);
  const archived = fx.grove(["archive", "archive-empty", "--allow-unpushed"]);
  assert.equal(fx.grove(["new", "delete-empty"]).status, 0);
  const deleted = fx.grove(["delete", "delete-empty"]);

  // Assert on RAW GIT, not on Grove's own report: Grove's report is what was wrong. It said it had
  // created an empty Grove while creating a branch and a worktree in every registered repository.
  const refsAfter = ["alpha", "beta"].map((repo) => execFileSync("git", ["show-ref"], { cwd: join(fx.root, "repos", repo), encoding: "utf8" }));

  assert.equal(fx.grove(["tree", "add", "empty", "alpha"]).status, 0);
  // ASSERT:TREE-23:CREATES-EMPTY-GROVE-GROVE-LS-SHOW-REPORT-ZERO
  assert.deepEqual(
    { createStatus: created.status, reportedTrees: json(created.stdout).targets[0].after.trees, archiveStatus: archived.status, deleteStatus: deleted.status, populatedTrees: trees(fx, "empty").length, refsUnchanged: refsAfter, treeDirEmpty: existsSync(join(fx.root, "groves", "empty", "trees", "empty@alpha")) },
    { createStatus: 0, reportedTrees: 0, archiveStatus: 0, deleteStatus: 0, populatedTrees: 1, refsUnchanged: refsBefore, treeDirEmpty: true },
  );
});

test("V3NEW-02: --all creates one Tree per registered repository", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[1]!.origin, "--name", "beta"]).status, 0);
  const created = fx.grove(["--json", "new", "fanned", "--all"]);
  const branches = ["alpha", "beta"].map((repo) => execFileSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/fanned"], { cwd: join(fx.root, "repos", repo), encoding: "utf8" }).trim().length > 0);
  assert.deepEqual(
    { status: created.status, trees: trees(fx, "fanned").length, branchesCreated: branches, bothWorktreesExist: ["alpha", "beta"].map((repo) => existsSync(join(fx.root, "groves", "fanned", "trees", `fanned@${repo}`))) },
    { status: 0, trees: 2, branchesCreated: [true, true], bothWorktreesExist: [true, true] },
  );
});

test("V3NEW-02: --all and --repo together are refused rather than silently merged", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const refused = fx.grove(["--json", "new", "conflicted", "--all", "--repo", "alpha"]);
  assert.equal(refused.status, 2);
  assert.match(String(json(refused.stdout).error.what), /--all cannot be combined with --repo/);
});
