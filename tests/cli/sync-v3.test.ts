/** Explicit Git-observed schema-3 synchronization state machine. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { makeFixture, managedTrunkPath } from "../testkit/fixture.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";
import { beginOperation, recordPending } from "../../src/store/operation.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);

function setup() {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "demo", "--all"]).status, 0);
  return { fx, tree: join(fx.root, "groves", "demo", "trees", "demo@alpha") };
}

function configureIdentity(path: string): void {
  execFileSync("git", ["config", "user.email", "sync@grove.test"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Sync"], { cwd: path });
}

function commitFile(path: string, file: string, body: string, message: string): string {
  configureIdentity(path);
  writeFileSync(join(path, file), body);
  execFileSync("git", ["add", "-A"], { cwd: path });
  execFileSync("git", ["commit", "-qm", message], { cwd: path });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" }).trim();
}

test("V3SYNC-01/003-git-native-grove-SC-007: sync reports no-upstream without guessing and fetch-only remains non-integrating", () => {
  const { fx } = setup();
  const blocked = fx.grove(["--json", "sync", "demo"]);
  assert.equal(blocked.status, 5, `${blocked.stderr}\n${blocked.stdout}`);
  assert.equal(json(blocked.stdout).targets[0].reason, "no-upstream");
  const fetched = fx.grove(["--json", "sync", "demo", "--strategy", "fetch-only"]);
  assert.equal(fetched.status, 0, `${fetched.stderr}\n${fetched.stdout}`);
  assert.equal(json(fetched.stdout).targets[0].after.status, "fetched-no-integration");
});

test("ff-only integrates the exact fetched upstream OID and skips dirty targets", () => {
  const { fx, tree } = setup();
  execFileSync("git", ["branch", "--set-upstream-to=origin/main", "demo"], { cwd: tree });
  const writer = tempDir("sync-writer");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, writer]);
  execFileSync("git", ["config", "user.email", "sync@grove.test"], { cwd: writer });
  execFileSync("git", ["config", "user.name", "Sync"], { cwd: writer });
  writeFileSync(join(writer, "UPSTREAM.md"), "advance\n");
  execFileSync("git", ["add", "-A"], { cwd: writer });
  execFileSync("git", ["commit", "-qm", "advance"], { cwd: writer });
  execFileSync("git", ["push", "-q", "origin", "main"], { cwd: writer });
  const upstreamOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: writer, encoding: "utf8" }).trim();
  const synced = fx.grove(["--json", "sync", "demo", "--strategy", "ff-only"]);
  assert.equal(synced.status, 0, `${synced.stderr}\n${synced.stdout}`);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim(), upstreamOid);
  assert.equal(json(synced.stdout).targets[0].after.integratedOid, upstreamOid);

  writeFileSync(join(tree, "DIRTY.txt"), "dirty\n");
  const dirty = fx.grove(["--json", "sync", "demo"]);
  assert.equal(dirty.status, 5);
  assert.equal(json(dirty.stdout).targets[0].reason, "dirty");
});

test("sync fast-forwards from a local upstream without fetching or guessing a remote", () => {
  const { fx, tree } = setup();
  const primary = managedTrunkPath(fx, "alpha");
  execFileSync("git", ["config", "branch.demo.remote", "."], { cwd: tree });
  execFileSync("git", ["config", "branch.demo.merge", "refs/heads/main"], { cwd: tree });
  const oid = commitFile(primary, "LOCAL.md", "local upstream\n", "advance local main");
  const synced = fx.grove(["--json", "sync", "demo"]);
  assert.equal(synced.status, 0, `${synced.stderr}\n${synced.stdout}`);
  const target = json(synced.stdout).targets[0];
  assert.equal(target.after.fetched, false);
  assert.equal(target.after.integratedOid, oid);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim(), oid);
});

test("ff-only blocks divergence while rebase integrates the same exact fetched upstream", () => {
  const { fx, tree } = setup();
  execFileSync("git", ["branch", "--set-upstream-to=origin/main", "demo"], { cwd: tree });
  commitFile(tree, "LOCAL.md", "local\n", "local advance");
  const writer = tempDir("sync-diverged-writer");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, writer]);
  const upstreamOid = commitFile(writer, "REMOTE.md", "remote\n", "remote advance");
  execFileSync("git", ["push", "-q", "origin", "main"], { cwd: writer });
  const blocked = fx.grove(["--json", "sync", "demo", "--strategy", "ff-only"]);
  assert.equal(blocked.status, 5, `${blocked.stderr}\n${blocked.stdout}`);
  assert.equal(json(blocked.stdout).targets[0].reason, "diverged");
  const rebased = fx.grove(["--json", "sync", "demo", "--strategy", "rebase"]);
  assert.equal(rebased.status, 0, `${rebased.stderr}\n${rebased.stdout}`);
  const target = json(rebased.stdout).targets[0];
  assert.equal(target.after.status, "rebased");
  assert.equal(target.after.upstreamOid, upstreamOid);
  assert.equal(execFileSync("git", ["merge-base", "--is-ancestor", upstreamOid, "HEAD"], { cwd: tree }).length, 0);
});

test("a pre-existing native sequencer is preserved and reported as needs-user", () => {
  const { fx, tree } = setup();
  const primary = managedTrunkPath(fx, "alpha");
  configureIdentity(tree);
  configureIdentity(primary);
  writeFileSync(join(tree, "README.md"), "tree side\n");
  execFileSync("git", ["commit", "-qam", "tree side"], { cwd: tree });
  writeFileSync(join(primary, "README.md"), "main side\n");
  execFileSync("git", ["commit", "-qam", "main side"], { cwd: primary });
  const merge = (() => { try { execFileSync("git", ["merge", "main"], { cwd: tree, stdio: "pipe" }); return 0; } catch { return 1; } })();
  assert.equal(merge, 1);
  const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const mergeHead = execFileSync("git", ["rev-parse", "MERGE_HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const fetched = fx.grove(["--json", "sync", "demo", "--strategy", "fetch-only"]);
  assert.equal(fetched.status, 0, `${fetched.stderr}\n${fetched.stdout}`);
  assert.equal(json(fetched.stdout).targets[0].after.status, "fetched-no-integration");
  assert.equal(execFileSync("git", ["rev-parse", "MERGE_HEAD"], { cwd: tree, encoding: "utf8" }).trim(), mergeHead);
  const result = fx.grove(["--json", "sync", "demo", "--strategy", "rebase"]);
  assert.equal(result.status, 5, `${result.stderr}\n${result.stdout}`);
  const body = json(result.stdout);
  assert.equal(body.outcome, "needs-user");
  assert.equal(body.targets[0].reason, "sequencer-active");
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim(), before);
});

test("reconcile closes an interrupted sync attempt as observation and never replays it", () => {
  const { fx, tree } = setup();
  const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const operation = beginOperation(fx.root, {
    kind: "sync-attempt",
    scope: { strategy: "rebase" },
    targetLocks: [`sync:repo-alpha:${tree}`],
    targets: [{ selector: { repositoryId: "repo-alpha", repositoryAlias: "alpha", grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "sync-0", kind: "sync-target", input: { strategy: "rebase" } }] }],
  });
  recordPending(operation, "sync-0", { headOid: before });
  const reconciled = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(reconciled.status, 0, `${reconciled.stderr}\n${reconciled.stdout}`);
  assert.equal(json(reconciled.stdout).detail.resumed[0].state, "interrupted-observation");
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim(), before);
});
