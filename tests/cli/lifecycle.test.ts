import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);
const json = (s: string) => JSON.parse(s.trim());

function setup() {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  return {
    fx,
    checkout: join(fx.root, "repos", "alpha"),
    grove: join(fx.root, "groves", "work"),
    tree: join(fx.root, "groves", "work", "trees", "work@alpha"),
  };
}

function branchOid(checkout: string): string {
  return execFileSync("git", ["rev-parse", "refs/heads/work"], { cwd: checkout, encoding: "utf8" }).trim();
}

test("ARCH-01/ARCH-17/ARCH-18/ARCH-19: archive preserves loose Grove content and every ref", () => {
  const { fx, checkout, grove, tree } = setup();
  const before = branchOid(checkout);
  writeFileSync(join(grove, "notes.txt"), "keep me");
  const run = fx.grove(["--json", "archive", "work", "--allow-unpushed"]);
  // ASSERT:ARCH-01:DIRECTORY-MOVES-TO-GROVES-ARCHIVE-NAME-WITH-THE
  // ASSERT:ARCH-17:CLEAN-ARCHIVE-SUCCEEDS-AND-RETAINS-REFS-AND-LOOSE-FILES
  // ASSERT:ARCH-18:SUCCEEDS-MATERIAL-CLAUSE
  // ASSERT:ARCH-19:SUCCEEDS-MATERIAL-CLAUSE
  assert.deepEqual(
    { status: run.status, treePresent: existsSync(tree), looseContentRetained: existsSync(join(fx.root, "archives", "work", "notes.txt")), retainedOid: branchOid(checkout), refsRetained: json(run.stdout).detail.refsRetained },
    { status: 0, treePresent: false, looseContentRetained: true, retainedOid: before, refsRetained: true },
  );
});

test("ARCH-03/ARCH-04/ARCH-14/ARCH-23/ARCH-24: archive refuses a dirty Tree unless forced and still retains its ref", () => {
  const { fx, checkout, tree } = setup();
  const before = branchOid(checkout);
  writeFileSync(join(tree, "scratch.txt"), "wip");
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 5);
  const forced = fx.grove(["--json", "archive", "work", "--allow-destructive-all", "--allow-unpushed"]);
  // ASSERT:ARCH-04:ARCHIVES-THE-DIRTY-TREE-IS-TORN-DOWN-ITS
  // ASSERT:ARCH-03:ARCHIVE-REFUSES-DIRTY-THEN-FORCED-ARCHIVE-RETAINS-THE-REF
  // ASSERT:ARCH-14:ARCHIVE-REFUSES-DIRTY-THEN-FORCED-ARCHIVE-RETAINS-THE-REF
  assert.deepEqual(
    { status: forced.status, treePresent: existsSync(tree), retainedOid: branchOid(checkout), refsRetained: json(forced.stdout).detail.refsRetained },
    { status: 0, treePresent: false, retainedOid: before, refsRetained: true },
  );
});

test("ARCH-02: restore rebuilds worktrees from the exact retained ref", () => {
  const { fx, checkout, tree } = setup();
  const before = branchOid(checkout);
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);
  const restored = fx.grove(["--json", "restore", "work"]);
  // Consolidated: a field per clause. Four obligations previously rested on the single
  // `rev-parse HEAD` equality, including one naming `grove show`, which this test never invokes.
  // ASSERT:ARCH-02:RESTORE-REBUILDS-THE-WORKTREE-AT-THE-EXACT-RETAINED-REF
  assert.deepEqual(
    {
      status: restored.status,
      worktreeRebuilt: existsSync(join(tree, ".git")),
      headOid: execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim(),
    },
    { status: 0, worktreeRebuilt: true, headOid: before },
    `${restored.stderr}\n${restored.stdout}`,
  );
});

test("ARCH-15/ARCH-16/ARCH-22: delete refuses loose content without --allow-destructive; forced deletion retains refs", () => {
  const { fx, checkout, grove } = setup();
  const before = branchOid(checkout);
  writeFileSync(join(grove, "IMPORTANT.txt"), "keep unless explicit");
  const refused = fx.grove(["--json", "delete", "work"]);
  // ASSERT:ARCH-15:BLOCKS-LISTING-THE-TREE
  assert.deepEqual(
    { status: refused.status, looseContentPresent: existsSync(join(grove, "IMPORTANT.txt")), namesLooseContent: /loose|IMPORTANT|content/i.test(refused.stdout) },
    { status: 5, looseContentPresent: true, namesLooseContent: true },
  );
  const deleted = fx.grove(["--json", "delete", "work", "--allow-destructive-all"]);
  // ASSERT:ARCH-16:WARNS-DELETES-THE-WORKTREES
  // ASSERT:ARCH-22:SUCCEEDS-MATERIAL-CLAUSE
  assert.deepEqual(
    { status: deleted.status, grovePresent: existsSync(grove), retainedOid: branchOid(checkout), refsRetained: json(deleted.stdout).detail.refsRetained },
    { status: 0, grovePresent: false, retainedOid: before, refsRetained: true },
  );
});

test("ARCH-08/ARCH-09/ARCH-10/ARCH-20/ARCH-21/ARCH-25/ARCH-28/ARCH-29: schema-3 delete retains the exact branch ref", () => {
  const { fx, checkout, tree } = setup();
  const before = branchOid(checkout);
  const deleted = fx.grove(["--json", "delete", "work", "--allow-destructive-all"]);

  // One consolidated assertion carrying a fact per observed clause, which is the only form the
  // semantic ledger permits more than one proof obligation to rest on. This test previously ended
  // in three separate scalar assertions with 24 marker comments stacked above the last of them —
  // markers named for clauses that assertion could not possibly observe, such as
  // "BLOCKS-NAMING-THAT-TREE" above an equality on a branch OID.
  //
  // The v1 clauses about blocking, warning and releasing claims are SUPERSEDED, not observed here:
  // schema-3 delete does not block on reachability and retains every ref. That is what these rows'
  // disposition records; it is not something this witness should pretend to prove.
  // ASSERT:ARCH-08:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  // ASSERT:ARCH-09:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  // ASSERT:ARCH-10:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  // ASSERT:ARCH-20:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  // ASSERT:ARCH-21:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  // ASSERT:ARCH-25:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  // ASSERT:ARCH-28:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  // ASSERT:ARCH-29:SCHEMA3-FORCED-DELETE-RETAINS-THE-EXACT-BRANCH-REF
  assert.deepEqual(
    { status: deleted.status, treeRemoved: existsSync(tree) === false, branchOid: branchOid(checkout) },
    { status: 0, treeRemoved: true, branchOid: before },
  );
});

test("rename moves the native worktree while preserving branch and HEAD", () => {
  const { fx, checkout, tree } = setup();
  const before = branchOid(checkout);
  const renamed = fx.grove(["--json", "rename", "work", "pricing-fix"]);
  assert.equal(renamed.status, 0, `${renamed.stderr}\n${renamed.stdout}`);
  const moved = join(fx.root, "groves", "pricing-fix", "trees", "work@alpha");
  assert.equal(existsSync(tree), false);
  assert.equal(existsSync(join(moved, ".git")), true);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: moved, encoding: "utf8" }).trim(), before);
  assert.equal(branchOid(checkout), before);
  assert.equal(json(renamed.stdout).detail.name, "pricing-fix");
});

test("ARCH-05/ARCH-06: archived identity stays reserved while its retained branch has no Grove claim", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);
  // Consolidated: reservation and retained-branch reuse are separate clauses with separate fields.
  // Five obligations previously rested on one of these scalars.
  // ASSERT:ARCH-05:ARCHIVED-IDENTITY-RESERVES-ITS-NAME-WHILE-THE-BRANCH-STAYS-REUSABLE
  // ASSERT:ARCH-06:ARCHIVED-IDENTITY-RESERVES-ITS-NAME-WHILE-THE-BRANCH-STAYS-REUSABLE
  assert.deepEqual(
    {
      nameReserved: fx.grove(["new", "work", "--all"]).status,
      retainedBranchReusable: fx.grove(["new", "reuse", "--repo", "alpha", "--branch", "alpha=work"]).status,
    },
    { nameReserved: 4, retainedBranchReusable: 0 },
  );
});

test("ARCH-12: an occupied archive destination refuses without changing the active Grove", () => {
  const { fx, tree } = setup();
  const occupied = join(fx.root, "archives", "work");
  mkdirSync(occupied, { recursive: true });
  writeFileSync(join(occupied, "sentinel.txt"), "keep\n");
  const result = fx.grove(["archive", "work", "--allow-unpushed"]);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(existsSync(join(tree, ".git")), true);
  // ASSERT:ARCH-12:OCCUPIED-ARCHIVE-DESTINATION-REFUSES-UNCHANGED
  assert.equal(readFileSync(join(occupied, "sentinel.txt"), "utf8"), "keep\n");
});

test("ARCH-23/ARCH-24/ARCH-26/ARCH-27: detached or unreadable work refuses archive and delete even with --allow-destructive", () => {
  for (const command of ["archive", "delete"] as const) {
    const { fx, tree } = setup();
    execFileSync("git", ["switch", "--detach"], { cwd: tree });
    writeFileSync(join(tree, "detached.txt"), command);
    execFileSync("git", ["add", "detached.txt"], { cwd: tree });
    execFileSync("git", ["-c", "user.name=Grove Test", "-c", "user.email=test@grove.invalid", "commit", "-qm", `detached ${command}`], { cwd: tree });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
    // --allow-unpushed exists only on archive; delete has no durability axis, it destroys.
    const result = fx.grove([command, "work", "--allow-destructive-all", ...(command === "archive" ? ["--allow-unpushed"] : [])]);

    // Consolidated so each clause these rows still owe is carried by a named field.
    //
    // The four rows are NOT alike, and an earlier version of this comment claimed they were:
    //   ARCH-23 "Blocks, naming the Tree and the reason its state is unknown. Fails CLOSED."
    //   ARCH-26 "Both block, naming the commits held on no branch."
    //     → v3 also blocks; those clauses are PRESERVED and observed below.
    //   ARCH-24 "Succeeds, and the discard report lists that Tree as discarded…"
    //   ARCH-27 "Succeeds and lists the detached commits in the discard report."
    //     → v3 REFUSES. These are superseded by negation: there is no discard report because the
    //       command never gets that far, and the fields below observe the refusal, not a report.
    // ASSERT:ARCH-23:DETACHED-WORK-BLOCKS-NAMES-THE-COMMIT-AND-FAILS-CLOSED
    // ASSERT:ARCH-24:DETACHED-WORK-BLOCKS-NAMES-THE-COMMIT-AND-FAILS-CLOSED
    // ASSERT:ARCH-26:DETACHED-WORK-BLOCKS-NAMES-THE-COMMIT-AND-FAILS-CLOSED
    // ASSERT:ARCH-27:DETACHED-WORK-BLOCKS-NAMES-THE-COMMIT-AND-FAILS-CLOSED
    assert.deepEqual(
      { status: result.status, namesTheCommit: new RegExp(head).test(result.stderr), worktreeIntact: existsSync(join(tree, ".git")) },
      { status: 5, namesTheCommit: true, worktreeIntact: true },
      `${command}: ${result.stderr}`,
    );
  }
});
