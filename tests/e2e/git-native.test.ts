import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BUNDLE = join(ROOT, "dist", "grove.mjs");
const json = (text: string): any => JSON.parse(text.trim());
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function run(fx: Fixture, args: string[]) { const result = spawnSync(process.execPath, [BUNDLE, ...args], { cwd: fx.root, encoding: "utf8", env: { ...process.env, HOME: fx.home } }); return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }; }

test("V3ACQ-01/V3OBS-01/003-git-native-grove-SC-001/003-git-native-grove-SC-002: the built artifact manages a bare anchor while native Git remains immediately observable", () => {
  const fx = makeFixture(); assert.equal(run(fx, ["init"]).status, 0);
  const added = run(fx, ["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"]); assert.equal(added.status, 0, added.stderr || added.stdout);
  const anchor = join(fx.root, "repos", "alpha"); const trunk = json(added.stdout).targets[0].after.trunkPath;
  assert.equal(git(anchor, ["rev-parse", "--is-bare-repository"]), "true"); assert.equal(git(trunk, ["branch", "--show-current"]), "main");
  assert.equal(trunk, join(fx.root, "trunks", "main@alpha"));
  const created = run(fx, ["--json", "new", "native", "--repo", "alpha"]); assert.equal(created.status, 0, created.stderr || created.stdout);
  const path = json(created.stdout).targets[0].after.path; git(path, ["switch", "-q", "-c", "changed-with-git", "main"]);
  const observed = run(fx, ["--json", "tree", "ls", "native"]); assert.equal(observed.status, 0, observed.stderr || observed.stdout);
  assert.equal(json(observed.stdout).detail.trees[0].branch.value, "refs/heads/changed-with-git");
  assert.ok(json(observed.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "nonconforming-branch"));
});

test("V3LINK-01/US2/003-git-native-grove-SC-016: built-artifact repo link is zero-mutation, allows Trees, and refuses every trunk mutation", () => {
  const fx = makeFixture({ repos: { alpha: ["develop"] } }); const checkout = join(tempDir("artifact-link"), "checkout"); git(join(checkout, ".."), ["clone", "-q", fx.repos[0]!.origin, checkout]);
  assert.equal(run(fx, ["init"]).status, 0);
  const before = `${git(checkout, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n${git(checkout, ["worktree", "list", "--porcelain"])}`;
  const linked = run(fx, ["repo", "link", checkout, "--name", "external", "--trunk", "develop"]); assert.equal(linked.status, 0, linked.stderr);
  assert.equal(`${git(checkout, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n${git(checkout, ["worktree", "list", "--porcelain"])}`, before);
  for (const args of [["trunk", "add", "external", "future", "--from", "main"], ["trunk", "remove", "external", "main"], ["trunk", "sync", "external"]]) {
    const refusal = run(fx, args); assert.notEqual(refusal.status, 0); assert.match(refusal.stderr + refusal.stdout, /linked|repo link|advisory/i);
    assert.equal(`${git(checkout, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n${git(checkout, ["worktree", "list", "--porcelain"])}`, before);
  }
  const remoteOid = git(checkout, ["rev-parse", "refs/remotes/origin/develop"]);
  assert.equal(run(fx, ["new", "linked-tree", "--repo", "external"]).status, 0);
  const treeList = run(fx, ["--json", "tree", "ls", "linked-tree"]); assert.equal(treeList.status, 0, treeList.stderr || treeList.stdout);
  assert.equal(existsSync(json(treeList.stdout).detail.trees[0].path.value), true);
  assert.equal(json(treeList.stdout).detail.trees[0].headOid, remoteOid);
  assert.throws(() => git(checkout, ["show-ref", "--verify", "refs/heads/develop"]));
  assert.equal(git(checkout, ["rev-parse", "HEAD"]), git(fx.repos[0]!.origin, ["rev-parse", "refs/heads/main"]), "the linked checkout itself was not moved or switched");
});
