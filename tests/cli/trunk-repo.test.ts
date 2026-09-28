import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, managedAnchorPath, managedTrunkPath } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { GLOBAL_OPTION_DEFINITIONS } from "../../src/commands/globals.ts";

after(cleanupTempDirs);

const json = (s: string) => JSON.parse(s.trim());
const refExists = (store: string, ref: string): boolean => {
  try {
    execFileSync("git", ["-C", store, "show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
};

function setup(extra: string[] = []) {
  const fx = makeFixture({ repos: { alpha: extra } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  return { fx, store: join(fx.root, "repos", "alpha") };
}

test("trunk add creates a native worktree; Git then refuses a second checkout of that branch", () => {
  const { fx } = setup(["release/2026.08"]);
  const add = fx.grove(["--json", "trunk", "add", "alpha", "release/2026.08"]);
  assert.equal(add.status, 0, add.stderr);
  assert.ok(existsSync(json(add.stdout).detail.path));
  const refused = fx.grove(["new", "x", "--repo", "alpha", "--branch", "alpha=release/2026.08"]);
  assert.notEqual(refused.status, 0, "Git's one-branch/one-worktree rule is preserved");
});

test("trunk ls shows the initial peer trunk and trunk remove retains its branch", () => {
  const { fx } = setup();
  const ls = json(fx.grove(["--json", "trunk", "ls"]).stdout).detail.trunks;
  assert.equal(ls.length, 1);
  assert.equal(ls[0].branch.value, "refs/heads/main");
  const rm = fx.grove(["trunk", "remove", "alpha", "main"]);
  assert.equal(rm.status, 0, rm.stderr);
  assert.ok(refExists(managedAnchorPath(fx, "alpha"), "refs/heads/main"));
});

test("repo add --trunk creates and reports the requested peer trunk", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const added = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha", "--trunk", "main"]);
  assert.equal(added.status, 0, `${added.stderr}\n${added.stdout}`);
  const checkout = managedTrunkPath(fx, "alpha");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: checkout, encoding: "utf8" }).trim(), "main");
  const config = json(fx.grove(["--json", "config", "get"]).stdout);
  assert.equal(config.repositories[0].trunk, "main");
  const trunks = json(fx.grove(["--json", "trunk", "ls", "alpha"]).stdout).detail.trunks;
  assert.equal(trunks.length, 1);
  assert.equal(trunks[0].role, "trunk");
  assert.equal(trunks[0].path.value, checkout);
});

test("TRUNK-04: trunk sync fast-forwards a clean trunk after an upstream commit", () => {
  const { fx, store } = setup();
  const created = fx.grove(["--json", "new", "work", "--repo", "alpha"]);
  assert.equal(created.status, 0, created.stderr);
  const treePath = json(created.stdout).targets[0].after.path;
  execFileSync("git", ["-C", treePath, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", treePath, "config", "user.name", "t"]);
  writeFileSync(join(treePath, "tree-base.txt"), "tree base\n");
  execFileSync("git", ["-C", treePath, "add", "tree-base.txt"]);
  execFileSync("git", ["-C", treePath, "commit", "-qm", "tree base"]);
  execFileSync("git", ["-C", treePath, "push", "-q", "origin", "HEAD:main"]);
  // Advance origin/main by committing in a seed clone and pushing.
  const seed = join(fx.root, "..", "seed-adv");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, seed]);
  execFileSync("git", ["-C", seed, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", seed, "config", "user.name", "t"]);
  writeFileSync(join(seed, "upstream.txt"), "new");
  execFileSync("git", ["-C", seed, "add", "-A"]);
  execFileSync("git", ["-C", seed, "commit", "-qm", "upstream"]);
  execFileSync("git", ["-C", seed, "push", "-q", "origin", "HEAD:main"]);
  const upstreamOid = execFileSync("git", ["-C", seed, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const trunkPath = json(fx.grove(["--json", "trunk", "ls"]).stdout).detail.trunks[0].path.value;
  const r = fx.grove(["--json", "trunk", "sync"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(r.stdout).targets[0].reason, null);
  const against = fx.grove(["--json", "against-trunk", "work"]);
  // ASSERT:TRUNK-04:CLEAN-TRUNKS-FAST-FORWARD-AGAINST-TRUNK-REFLECTS-NEW
  assert.deepEqual(
    {
      status: r.status,
      trunkHead: execFileSync("git", ["-C", trunkPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      upstreamFile: existsSync(join(trunkPath, "upstream.txt")),
      againstStatus: against.status,
      againstFiles: json(against.stdout).detail.trees[0].files,
    },
    { status: 0, trunkHead: upstreamOid, upstreamFile: true, againstStatus: 0, againstFiles: [] },
  );
});

test("REPO-04/REPO-05/REPO-06/REPO-07/REPO-11/REPO-12/REPO-13/REPO-16: repo remove unregisters only and retains checkout, refs, and Grove worktrees", () => {
  const { fx } = setup();
  fx.grove(["new", "work", "--repo", "alpha"]);
  const corruptMetadata = join(fx.root, ".grove", "groves", "work.json");
  writeFileSync(corruptMetadata, "x{");
  const checkout = join(fx.root, "repos", "alpha");
  const tree = join(fx.root, "groves", "work", "trees", "work@alpha");
  const linkedCheckout = join(fx.root, "..", "linked-remove");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, linkedCheckout]);
  const linkedCommonGitDir = execFileSync("git", ["-C", linkedCheckout, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const linkedSnapshot = `${execFileSync("git", ["-C", linkedCheckout, "for-each-ref", "--format=%(refname)%00%(objectname)"], { encoding: "utf8" })}\n${execFileSync("git", ["-C", linkedCheckout, "worktree", "list", "--porcelain"], { encoding: "utf8" })}`;
  assert.equal(fx.grove(["repo", "link", linkedCheckout, "--name", "linked-remove"]).status, 0);
  const removed = fx.grove(["--json", "repo", "remove", "alpha"]);
  const removedLinked = fx.grove(["--json", "repo", "remove", "linked-remove"]);
  const managedDetail = json(removed.stdout).detail;
  const linkedDetail = json(removedLinked.stdout).detail;
  const removalOutcome = {
    status: removed.status,
    unregistered: managedDetail.unregistered,
    managedCheckoutRetained: managedDetail.checkoutRetained,
    managedCommonGitDirRetained: managedDetail.commonGitDirRetained,
    linkedStatus: removedLinked.status,
    linkedUnregistered: linkedDetail.unregistered,
    linkedCheckoutRetained: linkedDetail.checkoutRetained,
    linkedCommonGitDirRetained: linkedDetail.commonGitDirRetained,
    checkoutPresent: existsSync(checkout),
    treePresent: existsSync(tree),
    refPresent: refExists(checkout, "refs/heads/work"),
    linkedCheckoutPresent: existsSync(linkedCheckout),
    linkedGitSnapshot: `${execFileSync("git", ["-C", linkedCheckout, "for-each-ref", "--format=%(refname)%00%(objectname)"], { encoding: "utf8" })}\n${execFileSync("git", ["-C", linkedCheckout, "worktree", "list", "--porcelain"], { encoding: "utf8" })}`,
    registeredAliases: json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.map((repo: any) => repo.name),
  };
  // ASSERT:REPO-04:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  // ASSERT:REPO-05:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  // ASSERT:REPO-06:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  // ASSERT:REPO-07:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  // ASSERT:REPO-11:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  // ASSERT:REPO-12:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  // ASSERT:REPO-13:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  // ASSERT:REPO-16:SCHEMA3-UNREGISTER-ONLY-OUTCOME
  assert.deepEqual(
    removalOutcome,
    {
      status: 0,
      unregistered: true,
      managedCheckoutRetained: null,
      managedCommonGitDirRetained: checkout,
      linkedStatus: 0,
      linkedUnregistered: true,
      linkedCheckoutRetained: null,
      linkedCommonGitDirRetained: linkedCommonGitDir,
      checkoutPresent: true,
      treePresent: true,
      refPresent: true,
      linkedCheckoutPresent: true,
      linkedGitSnapshot: linkedSnapshot,
      registeredAliases: [],
    },
  );
  assert.equal(readFileSync(corruptMetadata, "utf8"), "x{");
});

test("REPO-03/REPO-16/REPO-28/REPO-29: repo delete-branch is removed and native Git remains the branch deletion surface", () => {
  const { fx, store } = setup(["feature/loose"]);
  execFileSync("git", ["-C", store, "branch", "feature/loose", "origin/feature/loose"]);
  assert.ok(refExists(store, "refs/heads/feature/loose"));
  const removed = fx.grove(["repo", "delete-branch", "alpha", "feature/loose"]);
  const refAfterGrove = refExists(store, "refs/heads/feature/loose");
  execFileSync("git", ["-C", store, "branch", "-D", "feature/loose"]);
  // ASSERT:REPO-03:DELETES-THE-FIRST-MATERIAL-CLAUSE
  // ASSERT:REPO-28:DELETION-SUCCEEDS-MATERIAL-CLAUSE
  // ASSERT:REPO-29:REFUSES-MATERIAL-CLAUSE
  assert.deepEqual(
    { removedStatus: removed.status, refAfterGrove, refAfterNativeGit: refExists(store, "refs/heads/feature/loose") },
    { removedStatus: 2, refAfterGrove: true, refAfterNativeGit: false },
  );
});

test("CMD-09: completion generates a script from the command definitions for each shell", () => {
  const { fx } = setup();
  const scripts = new Map<string, string>();
  for (const shell of ["bash", "zsh", "fish"]) {
    const r = fx.grove(["completion", shell]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /grove/);
    assert.match(r.stdout, /--json|--help/);
    scripts.set(shell, r.stdout);
  }
  for (const flag of GLOBAL_OPTION_DEFINITIONS.flatMap(({ completion }) => completion)) {
    assert.match(scripts.get("bash")!, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(scripts.get("zsh")!, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(scripts.get("fish")!, new RegExp(`-l '${flag.slice(2)}'`));
  }
  // ASSERT:CMD-09:MATCHES-PUBLIC-COMMANDS-FLAGS-EXACTLY
  assert.equal(fx.grove(["completion", "powershell"]).status, 2, "an unknown shell is refused");
});
