/**
 * Ruling ② + decisions B1/B2 (P4.2, ledger C-3). Archive promises restorability to an exact commit,
 * so it must refuse when it cannot keep that promise.
 *
 * The earlier reasoning that no guard was needed — "refs are always retained, so nothing is lost" —
 * was too narrow. v3 explicitly sanctions `git branch -D` as a native action and the managed bare
 * repository is local-only, so **a retained ref is not a durability guarantee**.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());

function grove(): { fx: Fixture; anchor: string } {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  return { fx, anchor: join(fx.root, "repos", "alpha") };
}

test("V3ARC-01: archive refuses an unpushed branch without --allow-unpushed", () => {
  const { fx, anchor } = grove();
  // The Tree must carry a commit of ITS OWN. `grove new` starts the branch at trunk HEAD, so
  // without this the "unpushed" commit is just main's — which IS on the remote, and correctly
  // archives. The durability gate asks whether the commit has left this machine, not whether a
  // same-named tracking ref happens to exist.
  const treePath = join(fx.root, "groves", "work", "trees", "work@alpha");
  writeFileSync(join(treePath, "local-work.txt"), "not pushed\n");
  execFileSync("git", ["add", "."], { cwd: treePath });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "local work"], { cwd: treePath });
  const refused = fx.grove(["--json", "archive", "work"]);
  const allowed = fx.grove(["--json", "archive", "work", "--allow-unpushed"]);

  assert.deepEqual(
    {
      refusedStatus: refused.status,
      refusalNamesBranch: /work/.test(String(json(refused.stdout).error.why)),
      refusalOffersTheFlag: /--allow-unpushed/.test(String(json(refused.stdout).error.remedy)),
      allowedStatus: allowed.status,
      refUntouched: execFileSync("git", ["rev-parse", "--verify", "refs/heads/work"], { cwd: anchor, encoding: "utf8" }).trim().length,
    },
    { refusedStatus: 5, refusalNamesBranch: true, refusalOffersTheFlag: true, allowedStatus: 0, refUntouched: 40 },
  );
});

test("V3ARC-01: a pushed branch archives with no flag at all", () => {
  const { fx, anchor } = grove();
  // A commit of its own, then pushed — so the commit survives local ref deletion, which is the
  // whole point of the guard.
  const pushedTree = join(fx.root, "groves", "work", "trees", "work@alpha");
  writeFileSync(join(pushedTree, "pushed-work.txt"), "safely pushed\n");
  execFileSync("git", ["add", "."], { cwd: pushedTree });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "pushed work"], { cwd: pushedTree });
  execFileSync("git", ["push", "-q", "origin", "work"], { cwd: pushedTree });
  const run = fx.grove(["--json", "archive", "work"]);
  assert.deepEqual(
    { status: run.status, remoteHasIt: execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/work"], { cwd: anchor, encoding: "utf8" }).trim().length },
    { status: 0, remoteHasIt: 40 },
  );
});

test("V3ARC-01/B1: archiving an unborn HEAD is refused rather than left unrestorable", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "fresh", "--repo", "alpha", "--branch", "alpha=orphan", "--from", "alpha=main"]).status, 0);
  const tree = join(fx.root, "groves", "fresh", "trees", "fresh@alpha");
  // Make HEAD unborn: an orphan branch has no commit yet.
  execFileSync("git", ["checkout", "-q", "--orphan", "brand-new"], { cwd: tree });

  const refused = fx.grove(["--json", "archive", "fresh", "--allow-unpushed", "--allow-destructive-all"]);
  // Archive used to succeed here and restore could then NEVER complete (lifecycle.ts refuses an
  // unborn archived HEAD). Refusing costs nothing: the files stay exactly where they are.
  assert.deepEqual(
    {
      status: refused.status,
      why: /unborn|no commit/i.test(String(json(refused.stdout).error.why) + String(json(refused.stdout).error.what)),
      remedyIsActionable: /initial commit|grove delete/i.test(String(json(refused.stdout).error.remedy)),
      contentStillThere: fx.grove(["--json", "ls"]).status,
    },
    { status: 5, why: true, remedyIsActionable: true, contentStillThere: 0 },
  );
});

test("V3ARC-01/B2: a repository with no Git remote gets a distinct refusal, not an exemption", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  execFileSync("git", ["remote", "remove", "origin"], { cwd: anchor });

  const refused = fx.grove(["--json", "archive", "work"]);
  // Exempting remote-less repositories would silently archive unpushed work — the exact loss ④
  // exists to prevent. The refusal must say WHY it cannot verify, not just repeat "unpushed".
  assert.deepEqual(
    {
      status: refused.status,
      namesTheRealReason: /no Git remote/i.test(String(json(refused.stdout).error.why)),
      stillOverridable: fx.grove(["archive", "work", "--allow-unpushed"]).status,
    },
    { status: 5, namesTheRealReason: true, stillOverridable: 0 },
  );
});

test("V3ARC-01: a DETACHED Tree is durability-checked too, not exempted", () => {
  // Found while probing, not by the plan. A detached Tree has no ref of its own, so once the
  // worktree is removed the commit is reachable from nothing this archive controls — the strongest
  // durability risk, and the first implementation skipped the check for it entirely because it
  // keyed on "has a branch to push".
  //
  // `refuseUnsafe` already refuses a detached HEAD that NO ref contains. This is the separate
  // question ② actually asks: has the commit left this machine?
  const { fx } = grove();
  const treePath = join(fx.root, "groves", "work", "trees", "work@alpha");
  writeFileSync(join(treePath, "local-only.txt"), "never pushed\n");
  execFileSync("git", ["add", "."], { cwd: treePath });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "local only"], { cwd: treePath });
  // Branch `work` still points here, so the commit IS reachable from a ref — just not a remote one.
  execFileSync("git", ["switch", "--detach"], { cwd: treePath });

  const refused = fx.grove(["--json", "archive", "work"]);
  const allowed = fx.grove(["archive", "work", "--allow-unpushed"]);

  assert.deepEqual(
    {
      refusedStatus: refused.status,
      namesUnpushed: /unpushed/i.test(String(json(refused.stdout).error.what)),
      namesDetached: /detached at/i.test(String(json(refused.stdout).error.why)),
      overrideWorks: allowed.status,
    },
    { refusedStatus: 5, namesUnpushed: true, namesDetached: true, overrideWorks: 0 },
  );
});

test("V3ARC-01: a tracking ref that EXISTS but is behind does not count as pushed", () => {
  // The gate asked `show-ref refs/remotes/<remote>/<branch>` — existence, not containment. So it
  // accepted every commit made after the first push, which is the normal way of working: the guard
  // was inert exactly when it mattered. Reproduced end to end before the fix: archive at exit 0,
  // then `git branch -D` plus a gc made the archived commit unrecoverable and restore refused.
  const { fx } = grove();
  const treePath = join(fx.root, "groves", "work", "trees", "work@alpha");
  execFileSync("git", ["push", "-q", "origin", "work"], { cwd: treePath });
  writeFileSync(join(treePath, "after-the-push.txt"), "never pushed\n");
  execFileSync("git", ["add", "."], { cwd: treePath });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "after the push"], { cwd: treePath });

  const refused = fx.grove(["--json", "archive", "work"]);
  assert.deepEqual(
    {
      status: refused.status,
      trackingRefStillExists: execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/work"], { cwd: join(fx.root, "repos", "alpha"), encoding: "utf8" }).trim().length,
      overrideWorks: fx.grove(["archive", "work", "--allow-unpushed"]).status,
    },
    { status: 5, trackingRefStillExists: 40, overrideWorks: 0 },
  );
});

test("V3ARC-01: an adopted branch Grove would not mint is still archivable", () => {
  // `remoteBranchExists` ran `assertBranchName` — Grove's CREATION-time grammar — against a branch
  // OBSERVED from Git. `tree add --branch` adopts pre-existing branches (TREE-24), so a SHA-like
  // name Git allows made `archive` exit 2 about an argument the user never supplied, with
  // --allow-unpushed the only escape. Querying by OID sidesteps the grammar entirely.
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  execFileSync("git", ["branch", "deadbeef", "main"], { cwd: anchor });
  assert.equal(fx.grove(["tree", "add", "work", "alpha", "--name", "sha", "--branch", "deadbeef"]).status, 0);

  const archived = fx.grove(["--json", "archive", "work"]);
  assert.deepEqual(
    { status: archived.status, notAGrammarRefusal: archived.status !== 2 },
    { status: 0, notAGrammarRefusal: true },
  );
});

