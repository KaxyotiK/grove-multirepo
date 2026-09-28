import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const snapshot = (cwd: string): string => `${git(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n--worktrees--\n${git(cwd, ["worktree", "list", "--porcelain"])}`;

function cloneLinked(origin: string, checkout = "feature/wip"): string {
  const path = join(tempDir("repo-policy-linked"), "checkout");
  git(join(path, ".."), ["clone", "-q", origin, path]);
  if (checkout !== "main") git(path, ["switch", "-qc", checkout]);
  return path;
}

test("REPO-20/REPO-21: add uses remote HEAD while link treats the input branch as advisory trunk", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const linked = cloneLinked(fx.repos[0]!.origin);
  const before = snapshot(linked);
  const link = fx.grove(["--json", "repo", "link", linked, "--name", "linked"]);
  const add = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "managed"]);
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  // ASSERT:REPO-20:EFFECTIVE-DEFAULT-IS-MAIN
  // ASSERT:REPO-21:BOTH-RESOLVE-THE-SAME-EFFECTIVE-DEFAULT-THROUGH-THE
  assert.deepEqual(
    { linkStatus: link.status, linkedTrunk: json(link.stdout).detail.trunk, linkedGit: snapshot(linked), addStatus: add.status, managedTrunk: json(add.stdout).detail.trunk, schemaVersion: config.schemaVersion, storedTrunks: config.repositories.map((repo: any) => [repo.name, repo.trunk]) },
    { linkStatus: 0, linkedTrunk: "feature/wip", linkedGit: before, addStatus: 0, managedTrunk: "main", schemaVersion: 3, storedTrunks: [["linked", "feature/wip"], ["managed", "main"]] },
  );
});

test("REPO-24/REPO-26: link accepts an absent advisory trunk while add requires the remote branch", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const linked = cloneLinked(fx.repos[0]!.origin, "main");
  const invalidLinked = cloneLinked(fx.repos[0]!.origin, "main");
  assert.equal(fx.grove(["new", "empty", "--all"]).status, 0);
  const before = snapshot(linked);
  const link = fx.grove(["--json", "repo", "link", linked, "--name", "linked", "--base", "future"]);
  const defaultDependent = fx.grove(["tree", "add", "empty", "linked"]);
  // ASSERT:REPO-24:CONFIGURATION-REMAINS-VALID
  assert.deepEqual(
    { linkStatus: link.status, preferredTrunk: json(link.stdout).detail.trunk, gitSnapshot: snapshot(linked), defaultDependentStatus: defaultDependent.status },
    { linkStatus: 0, preferredTrunk: "future", gitSnapshot: before, defaultDependentStatus: 5 },
  );
  assert.match(defaultDependent.stderr + defaultDependent.stdout, /future|missing|revision/i);
  const badLink = fx.grove(["repo", "link", invalidLinked, "--name", "bad-link", "--base", "bad..branch"]);
  const add = fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "bad-add", "--trunk", "future"]);
  // ASSERT:REPO-26:BOTH-INVALID-OVERRIDES-EXIT-2-WITHOUT-REGISTRATION-SUCCESS
  assert.deepEqual(
    { linkStatus: badLink.status, addStatus: add.status, registeredAliases: json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.map((repo: any) => repo.name).sort() },
    { linkStatus: 2, addStatus: 2, registeredAliases: ["linked"] },
  );
  assert.deepEqual(
    { preferredRemote: json(link.stdout).detail.preferredRemote, trunk: json(link.stdout).detail.trunk },
    { preferredRemote: "origin", trunk: "future" },
  );
});

test("TREE-24: linked Tree creation may adopt an existing branch without creating a duplicate checkout", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const linked = cloneLinked(fx.repos[0]!.origin, "main");
  git(linked, ["branch", "side", "main"]);
  assert.equal(fx.grove(["new", "empty", "--all"]).status, 0);
  assert.equal(fx.grove(["repo", "link", linked, "--name", "local", "--base", "main"]).status, 0);
  const beforeRefs = git(linked, ["for-each-ref", "--format=%(refname)%00%(objectname)"]);
  const added = fx.grove(["tree", "add", "empty", "local", "--branch", "side"]);
  // ASSERT:TREE-24:BOTH-SUCCEED-BECAUSE-NO-BRANCH-IS-CREATED-FROM
  assert.deepEqual({ status: added.status, refs: git(linked, ["for-each-ref", "--format=%(refname)%00%(objectname)"]), treeCount: json(fx.grove(["--json", "tree", "ls", "empty"]).stdout).detail.trees.length }, { status: 0, refs: beforeRefs, treeCount: 1 });
});

test("REPO-27/003-git-native-grove-SC-004: an explicitly selected non-origin remote drives fetch and remote-only Tree adoption", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: ["develop", "tree-only"] } });
  assert.equal(fx.grove(["init"]).status, 0);
  const linked = cloneLinked(fx.repos[0]!.origin, "main");
  git(linked, ["remote", "add", "upstream", fx.repos[1]!.origin]);
  assert.equal(fx.grove(["new", "empty", "--all"]).status, 0);
  assert.equal(fx.grove(["repo", "link", linked, "--name", "linked", "--base", "develop"]).status, 0);
  const configured = fx.grove(["repo", "configure", "linked", "--remote", "upstream"]);
  const fetched = fx.grove(["repo", "fetch", "linked"]);
  const tree = fx.grove(["tree", "add", "empty", "linked", "--branch", "tree-only"]);
  const expectedOid = git(fx.repos[1]!.origin, ["rev-parse", "refs/heads/tree-only"]);
  // ASSERT:REPO-27:ONLY-SELECTED-REMOTE-S-TRACKING-REFS-ADVANCE-EVERY
  assert.deepEqual(
    { configureStatus: configured.status, fetchStatus: fetched.status, remoteOid: git(linked, ["rev-parse", "refs/remotes/upstream/tree-only"]), treeStatus: tree.status, upstream: git(linked, ["for-each-ref", "--format=%(upstream:short)", "refs/heads/tree-only"]) },
    { configureStatus: 0, fetchStatus: 0, remoteOid: expectedOid, treeStatus: 0, upstream: "upstream/tree-only" },
  );
});

test("REPO-22/REPO-23: repo configure validates local-only advisory options and remote names without touching Git", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const linked = cloneLinked(fx.repos[0]!.origin, "main");
  assert.equal(fx.grove(["repo", "link", linked, "--name", "linked"]).status, 0);
  const configPath = join(fx.root, ".grove", "config.json");
  const beforeGit = snapshot(linked);
  const beforeConfig = readFileSync(configPath, "utf8");
  assert.equal(fx.grove(["repo", "configure", "linked"]).status, 2);
  assert.equal(fx.grove(["repo", "configure", "linked", "--remote", "origin", "--no-remote"]).status, 2);
  assert.equal(fx.grove(["repo", "configure", "linked", "--remote", "missing"]).status, 2);
  assert.equal(readFileSync(configPath, "utf8"), beforeConfig);
  assert.equal(snapshot(linked), beforeGit);
  const configured = fx.grove(["--json", "repo", "configure", "linked", "--no-remote", "--base", "future"]);
  assert.equal(configured.status, 0, `${configured.stderr}\n${configured.stdout}`);
  assert.equal(json(configured.stdout).detail.preferredRemote, null);
  // ASSERT:REPO-22:THE-OVERRIDE-RESOLVES
  // ASSERT:REPO-23:VALID-LOCAL-POLICY-CHANGES-PERSIST-ATOMICALLY-INVALID-CHANGES
  assert.deepEqual(
    { preferredRemote: json(configured.stdout).detail.preferredRemote, preferredTrunk: json(configured.stdout).detail.preferredTrunk, git: snapshot(linked), configChanged: readFileSync(configPath, "utf8") !== beforeConfig },
    { preferredRemote: null, preferredTrunk: "future", git: beforeGit, configChanged: true },
  );
});

test("REPO-25: repo link help explains advisory coupling and recommends add for managed trunks", () => {
  const fx = makeFixture();
  const help = fx.grove(["repo", "link", "--help"]);
  // ASSERT:REPO-25:SAYS-NO-DEFAULT-TRUNK-CREATED-WARNS-GIT-WORKTREE
  assert.deepEqual({ status: help.status, advisory: /advisory/i.test(help.stdout), trunkRefusal: /refuse.*trunk|trunk.*refuse/i.test(help.stdout), recommendsAdd: /repo add/i.test(help.stdout) }, { status: 0, advisory: true, trunkRefusal: true, recommendsAdd: true });
});
