/**
 * Ruling ② (P4.2, ledger C-4). Restore reconstitutes the commit recorded AT ARCHIVE TIME.
 *
 * Restore used to refuse outright when the branch had moved since the archive, calling it "stale".
 * That made the ordinary case — archive some work, keep developing on the branch, come back —
 * permanently unrestorable, which is precisely the situation the feature exists to serve.
 *
 * Assertions read raw `git rev-parse` in the restored worktree rather than Grove's own result,
 * because Grove's report is not the thing under test: the checked-out commit is.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitArgvRewriter } from "../testkit/git-fault.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());
const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Archive a Grove, then advance its branch with raw Git so archived OID != branch tip. */
function archivedThenAdvanced(): { fx: Fixture; anchor: string; archivedOid: string; advancedOid: string; treePath: string } {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  const treePath = join(fx.root, "groves", "work", "trees", "work@alpha");
  // Commit something UNIQUE to this branch. `new` starts the branch at trunk HEAD, so without this
  // the "archived commit" is just main's commit and remains reachable no matter what happens to
  // refs/heads/work — V3ARC-04 could never observe a missing object.
  writeFileSync(join(treePath, "archived-work.txt"), "work done before archiving\n");
  execFileSync("git", ["add", "archived-work.txt"], { cwd: treePath });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "work before archive"], { cwd: treePath });
  const archivedOid = git(treePath, ["rev-parse", "HEAD"]);
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);

  // Advance the branch with raw Git, exactly as a user would from another checkout.
  const scratch = join(fx.root, "scratch-checkout");
  execFileSync("git", ["worktree", "add", "-q", scratch, "work"], { cwd: anchor });
  writeFileSync(join(scratch, "advanced.txt"), "moved on\n");
  execFileSync("git", ["add", "advanced.txt"], { cwd: scratch });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "advance"], { cwd: scratch });
  const advancedOid = git(scratch, ["rev-parse", "HEAD"]);
  execFileSync("git", ["worktree", "remove", "--force", scratch], { cwd: anchor });
  assert.notEqual(archivedOid, advancedOid);
  return { fx, anchor, archivedOid, advancedOid, treePath };
}

test("V3ARC-02: restore reconstitutes the archived commit after the branch advanced natively", () => {
  const { fx, anchor, archivedOid, advancedOid, treePath } = archivedThenAdvanced();
  const run = fx.grove(["--json", "restore", "work"]);

  assert.deepEqual(
    {
      status: run.status,
      worktreeHead: git(treePath, ["rev-parse", "HEAD"]),
      detached: git(treePath, ["rev-parse", "--abbrev-ref", "HEAD"]),
      branchStillAdvanced: git(anchor, ["rev-parse", "refs/heads/work"]),
      reportedRestoredAt: json(run.stdout).detail.restoredAt,
      moveReportedNotSilent: json(run.stdout).detail.detached.length,
    },
    {
      status: 0,
      worktreeHead: archivedOid,
      detached: "HEAD",
      branchStillAdvanced: advancedOid,
      reportedRestoredAt: "archived-commit",
      moveReportedNotSilent: 1,
    },
  );
});

test("V3ARC-02: human output says it restored the archived commit and identifies the detached Tree — ⑦ parity", () => {
  const { fx, archivedOid } = archivedThenAdvanced();
  const run = fx.grove(["restore", "work"]);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /Restored At: archived-commit/);
  assert.match(run.stdout, /Detached:/);
  assert.match(run.stdout, new RegExp(archivedOid.slice(0, 12)));
});

test("V3ARC-03: restore --latest checks out the advanced tip", () => {
  const { fx, advancedOid, treePath } = archivedThenAdvanced();
  const run = fx.grove(["--json", "restore", "work", "--latest"]);
  assert.deepEqual(
    {
      status: run.status,
      worktreeHead: git(treePath, ["rev-parse", "HEAD"]),
      attachedBranch: git(treePath, ["rev-parse", "--abbrev-ref", "HEAD"]),
      reportedRestoredAt: json(run.stdout).detail.restoredAt,
    },
    { status: 0, worktreeHead: advancedOid, attachedBranch: "work", reportedRestoredAt: "branch-tip" },
  );
});

test("V3ARC-04: restore refuses when the archived object no longer exists", () => {
  const { fx, anchor, archivedOid } = archivedThenAdvanced();
  // Destroy the archived commit: reset the branch back past it and expire everything that holds it.
  execFileSync("git", ["update-ref", "-d", "refs/heads/work"], { cwd: anchor });
  execFileSync("git", ["reflog", "expire", "--expire=now", "--all"], { cwd: anchor });
  execFileSync("git", ["gc", "--prune=now", "--quiet"], { cwd: anchor });

  const run = fx.grove(["--json", "restore", "work"]);
  assert.deepEqual(
    {
      status: run.status,
      namesTheMissingCommit: String(json(run.stdout).error.why).includes(archivedOid),
      remedyIsActionable: /recover|remote|reflog|create the Tree/i.test(String(json(run.stdout).error.remedy)),
    },
    { status: 5, namesTheMissingCommit: true, remedyIsActionable: true },
  );
});

test("V3ARC-03: --latest is refused for a Grove archived with a detached HEAD", () => {
  // There is no branch tip to follow, so guessing one would be exactly the inference ⑤ forbids.
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const treePath = join(fx.root, "groves", "work", "trees", "work@alpha");
  execFileSync("git", ["switch", "--detach"], { cwd: treePath });
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);

  const run = fx.grove(["--json", "restore", "work", "--latest"]);
  assert.equal(run.status, 2);
  assert.match(String(json(run.stdout).error.why), /detached HEAD|no branch tip/i);
});

test("V3ARC-02: gate 4 refuses a restore that ends up ATTACHED when it should have detached", () => {
  // The remediation plan calls this gate "the trap": a detached restore makes finalHead.branch null
  // by design, and the pre-② equality against `branch` fired the partial path even with gates 1-3
  // fixed. It was nonetheless DELETABLE with the whole suite green — `const headBranchOk = true;`
  // in both lifecycle.ts and reconcile.ts left 438 tests passing.
  //
  // Reaching it needs a `worktree add --detach` that SUCCEEDS but attaches, which the failing
  // git-gate cannot express; hence the argv rewriter. And the branch must sit exactly AT the
  // archived commit, or the OID check catches the case first and the branch check never speaks.
  const { fx, anchor, archivedOid, treePath } = archivedThenAdvanced();
  execFileSync("git", ["branch", "pin", archivedOid], { cwd: anchor });
  const rewriter = createGitArgvRewriter(
    ["worktree", "add", "--detach", "--", treePath, archivedOid],
    ["worktree", "add", "--", treePath, "pin"],
  );
  let restored;
  try { restored = fx.grove(["--json", "restore", "work"], { env: rewriter.env }); }
  finally { rewriter.dispose(); }

  assert.deepEqual(
    { status: restored.status, outcome: json(restored.stdout).outcome },
    { status: 4, outcome: "partial" },
  );
});
