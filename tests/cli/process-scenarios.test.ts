import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerAll } from "../../src/commands/index.ts";
import { all } from "../../src/commands/registry.ts";
import { makeFixture, managedTrunkPath, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);
registerAll();

const json = (source: string) => JSON.parse(source.trim());

function locks(root: string): string[] {
  try {
    return readdirSync(join(root, ".grove", "locks")).filter((name) => !name.endsWith(".tmp") && !name.endsWith(".steal")).sort();
  } catch {
    return [];
  }
}

function initialized(extraBranches: string[] = []): Fixture {
  const fx = makeFixture({ repos: { alpha: extraBranches } });
  assert.equal(fx.grove(["init"]).status, 0);
  return fx;
}

function managed(extraBranches: string[] = []): Fixture {
  const fx = initialized(extraBranches);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  return fx;
}

interface Invocation {
  fx: Fixture;
  args: string[];
}

const cases = new Map<string, () => Invocation>([
  ["config set", () => ({ fx: initialized(), args: ["config", "set", "--values", '{"name":"configured"}'] })],
  ["reconcile", () => ({ fx: initialized(), args: ["reconcile"] })],
  ["fix", () => {
    const fx = managed();
    const primary = managedTrunkPath(fx, "alpha");
    const expected = join(fx.root, "groves", "work", "trees", "work@alpha");
    const moved = join(fx.root, "misplaced-alpha");
    mkdirSync(join(fx.root, "groves", "work", "trees"), { recursive: true });
    execFileSync("git", ["branch", "work", "main"], { cwd: primary });
    execFileSync("git", ["worktree", "add", "-q", expected, "work"], { cwd: primary });
    execFileSync("git", ["worktree", "move", expected, moved], { cwd: primary });
    return { fx, args: ["fix", "--move", "--dry-run"] };
  }],
  ["sync", () => ({ fx: managed(), args: ["sync", "--trunks", "--strategy", "fetch-only"] })],
  ["repo add", () => {
    const fx = initialized();
    return { fx, args: ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"] };
  }],
  ["repo link", () => {
    const fx = initialized();
    const checkout = join(tempDir("proc13-link"), "checkout");
    execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, checkout]);
    return { fx, args: ["repo", "link", checkout, "--name", "linked"] };
  }],
  ["repo configure", () => ({ fx: managed(), args: ["repo", "configure", "alpha", "--trunk", "main"] })],
  ["repo fetch", () => ({ fx: managed(), args: ["repo", "fetch", "alpha"] })],
  ["repo remove", () => ({ fx: managed(), args: ["repo", "remove", "alpha"] })],
  ["trunk add", () => ({ fx: managed(["develop"]), args: ["trunk", "add", "alpha", "develop"] })],
  ["trunk remove", () => ({ fx: managed(), args: ["trunk", "remove", "alpha", "main"] })],
  ["trunk sync", () => ({ fx: managed(), args: ["trunk", "sync", "alpha"] })],
  ["new", () => ({ fx: managed(), args: ["new", "work", "--repo", "alpha"] })],
  ["agent add", () => ({ fx: initialized(), args: ["agent", "add", "one", process.execPath] })],
  ["agent remove", () => {
    const fx = initialized();
    assert.equal(fx.grove(["agent", "add", "one", process.execPath]).status, 0);
    return { fx, args: ["agent", "remove", "one"] };
  }],
  ["tree add", () => {
    const fx = initialized();
    assert.equal(fx.grove(["new", "empty", "--all"]).status, 0);
    assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
    return { fx, args: ["tree", "add", "empty", "alpha", "--branch", "added", "--from", "main"] };
  }],
  ["tree remove", () => {
    const fx = managed();
    assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
    const tree = json(fx.grove(["--json", "tree", "ls", "work"]).stdout).detail.trees[0];
    return { fx, args: ["tree", "remove", "work", tree.tree] };
  }],
  ["tree configure", () => {
    const fx = managed();
    assert.equal(fx.grove(["agent", "add", "one", process.execPath]).status, 0);
    assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
    const tree = json(fx.grove(["--json", "tree", "ls", "work"]).stdout).detail.trees[0];
    return { fx, args: ["tree", "configure", "work", tree.tree, "--default-agent", "one"] };
  }],
  ["tree reorder", () => {
    const fx = managed();
    assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
    assert.equal(fx.grove(["tree", "add", "work", "alpha", "--name", "second", "--branch", "second", "--from", "main"]).status, 0);
    const trees = json(fx.grove(["--json", "tree", "ls", "work"]).stdout).detail.trees;
    return { fx, args: ["tree", "reorder", "work", "--tree", trees[1].tree, "--tree", trees[0].tree] };
  }],
  ["configure", () => {
    const fx = managed();
    assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
    return { fx, args: ["configure", "work", "--default-base", "main"] };
  }],
  ["rename", () => {
    const fx = initialized();
    assert.equal(fx.grove(["new", "before", "--all"]).status, 0);
    return { fx, args: ["rename", "before", "after"] };
  }],
  ["archive", () => {
    const fx = initialized();
    assert.equal(fx.grove(["new", "work", "--all"]).status, 0);
    return { fx, args: ["archive", "work", "--allow-unpushed"] };
  }],
  ["restore", () => {
    const fx = initialized();
    assert.equal(fx.grove(["new", "work", "--all"]).status, 0);
    assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);
    return { fx, args: ["restore", "work"] };
  }],
  ["delete", () => {
    const fx = initialized();
    assert.equal(fx.grove(["new", "work", "--all"]).status, 0);
    return { fx, args: ["delete", "work"] };
  }],
]);

test("PROC-13: every registered mutating command succeeds without leaving a lock file", { timeout: 60_000 }, () => {
  const declared = all().filter((command) => command.mutates).map((command) => command.path).sort();
  // ASSERT:PROC-13:GROVE-LOCKS-IS-EMPTY-AFTER-EACH-1
  assert.deepEqual([...cases.keys()].sort(), declared, "the runtime cleanup matrix must cover the complete registered mutation surface");
  for (const path of declared) {
    const invocation = cases.get(path)!();
    const result = invocation.fx.grove(invocation.args);
    // ASSERT:PROC-13:LOCK-FILES-EXIST-ONLY-WHILE-A-COMMAND-2
    assert.equal(result.status, 0, `${path}: ${result.stdout}\n${result.stderr}`);
    assert.deepEqual(locks(invocation.fx.root), [], `${path} left a lock behind`);
  }
});
