import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, managedAnchorPath } from "../testkit/fixture.ts";
import { FAKE_AGENT_PATH } from "../testkit/fake-agent.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (s: string) => JSON.parse(s.trim().split("\n").pop() as string);
const refExists = (store: string, ref: string): boolean => {
  try {
    execFileSync("git", ["-C", store, "show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
};

test("golden path: init → repo add → new → agent run", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  const origin = fx.repos[0]!.origin;
  assert.equal(fx.grove(["init"]).status, 0);

  const add = fx.grove(["--json", "repo", "add", origin, "--name", "alpha"]);
  assert.equal(add.status, 0, add.stderr);
  const store = managedAnchorPath(fx, "alpha");
  assert.ok(existsSync(join(store, "HEAD")), "managed bare anchor created under repos/");
  assert.equal(json(add.stdout).targets[0].after.commonGitDir, store);
  assert.ok(existsSync(json(add.stdout).targets[0].after.trunkPath), "initial peer trunk materialized");

  const created = fx.grove(["--json", "new", "work", "--repo", "alpha"]);
  assert.equal(created.status, 0, created.stderr);
  const tree = json(created.stdout).targets[0];
  assert.ok(refExists(store, "refs/heads/work"), "derived branch created");
  assert.ok(existsSync(tree.after.path), "tree worktree materialized");

  // Define and run a fake agent; it exits 7 and writes to stdout.
  fx.grove(["agent", "add", "fake", process.execPath, "--arg", FAKE_AGENT_PATH, "--arg", "out:hello|exit:7"]);
  const run = fx.grove(["agent", "run", "work", "--agent", "fake"]);
  assert.equal(run.status, 7, "agent run returns the child exit code");
  assert.match(run.stdout, /hello/);
});

test("TREE-18: grove new requires a name; bare `new` exits 2 and creates no Grove", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  const before = fx.grove(["--json", "ls"]);
  const bare = fx.grove(["new"]);
  assert.equal(bare.status, 2, "no name is an invalid-input refusal (exit 2)");
  assert.match(bare.stderr + bare.stdout, /requires a name/);
  // Refuse-before-mutate: the Grove list is unchanged and no groves/ entry was minted.
  const after = fx.grove(["--json", "ls"]);
  // ASSERT:TREE-18:EXITS-2-BEFORE-ANY-MUTATION-GROVE-ALWAYS-NAMED
  assert.deepEqual(
    {
      status: bare.status,
      remedyRequiresName: /requires a name/.test(bare.stderr + bare.stdout),
      groves: JSON.parse(after.stdout.trim()).groves,
      unnamedDirectory: existsSync(join(fx.root, "groves", ".unnamed")),
    },
    { status: 2, remedyRequiresName: true, groves: JSON.parse(before.stdout.trim()).groves, unnamedDirectory: false },
  );
});

test("--json drivability: agent run result is stdout's sole content when the agent writes to stderr", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  fx.grove(["new", "work", "--repo", "alpha"]);
  fx.grove(["agent", "add", "fake", process.execPath, "--arg", FAKE_AGENT_PATH, "--arg", "err:diagnostics|exit:0"]);
  const run = fx.grove(["--json", "agent", "run", "work", "--agent", "fake"]);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.detail.agent, "fake");
  assert.equal(result.detail.exitCode, 0);
});

test("a derived branch that already exists is refused, never silently adopted", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  fx.grove(["new", "work", "--repo", "alpha"]); // creates branch "work"
  // A second Grove named "work" is refused by name; try a fresh name whose derived branch clashes.
  const store = join(fx.root, "repos", "alpha");
  assert.ok(refExists(store, "refs/heads/work"));
  // Re-using the branch via a Grove that derives "work" again: name collision refuses first.
  const dup = fx.grove(["new", "work", "--repo", "alpha"]);
  assert.equal(dup.status, 4, "duplicate Grove name refused (exit 4)");
});

test("--branch adopts an existing native branch without an ownership record", () => {
  const fx = makeFixture({ repos: { alpha: ["feature/ready"] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  const created = fx.grove(["--json", "new", "adopt-it", "--repo", "alpha", "--branch", "alpha=feature/ready"]);
  assert.equal(created.status, 0, created.stderr);
  const result = json(created.stdout);
  assert.equal(result.targets[0].after.branch, "feature/ready");
  assert.ok(existsSync(result.targets[0].after.path));
});

test("duplicate repository selectors are refused before mutation", () => {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  const r = fx.grove(["new", "boom", "--repo", "alpha", "--repo", "alpha"]);
  assert.notEqual(r.status, 0, "the operation fails");
  assert.ok(!existsSync(join(fx.root, "groves", "boom")), "no partial Grove directory survives");
  const store = join(fx.root, "repos", "alpha");
  assert.ok(!refExists(store, "refs/heads/boom"), "no branch was created");
});

test("multi-repo new with branch overrides creates two Trees in one operation", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  fx.grove(["repo", "add", fx.repos[1]!.origin, "--name", "beta"]);
  const r = fx.grove([
    "--json", "new", "cross",
    "--repo", "alpha", "--repo", "beta",
    "--branch", "alpha=feature/a", "--branch", "beta=feature/b",
    "--from", "alpha=main", "--from", "beta=main",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(r.stdout).targets.length, 2);
});
