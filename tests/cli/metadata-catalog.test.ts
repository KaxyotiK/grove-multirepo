import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { initV2Workspace, makeFixture, managedTrunkPath } from "../testkit/fixture.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);

test("schema-3 status observes a native worktree added after workspace configuration", () => {
  const fx = makeFixture();
  initV2Workspace(fx);
  const primary = managedTrunkPath(fx, "alpha");
  const tree = join(fx.root, "groves", "demo", "trees", "demo@alpha");
  mkdirSync(join(fx.root, "groves", "demo", "trees"), { recursive: true });
  execFileSync("git", ["branch", "demo"], { cwd: primary });
  execFileSync("git", ["worktree", "add", "-q", tree, "demo"], { cwd: primary });

  const run = fx.grove(["--json", "status"]);
  assert.equal(run.status, 0, run.stderr);
  const result = json(run.stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.command, "status");
  assert.equal(result.outcome, "complete");
  assert.equal(result.detail.groves[0].name, "demo");
  assert.equal(result.detail.groves[0].trees[0].path.value, tree);
});

test("schema-3 Grove catalog includes metadata-free Groves discovered from Git", () => {
  const fx = makeFixture();
  initV2Workspace(fx);
  const primary = managedTrunkPath(fx, "alpha");
  const tree = join(fx.root, "groves", "raw", "trees", "raw@alpha");
  mkdirSync(join(fx.root, "groves", "raw", "trees"), { recursive: true });
  execFileSync("git", ["branch", "raw"], { cwd: primary });
  execFileSync("git", ["worktree", "add", "-q", tree, "raw"], { cwd: primary });

  const run = fx.grove(["--json", "ls"]);
  assert.equal(run.status, 0, run.stderr);
  const result = json(run.stdout);
  assert.equal(result.command, "ls");
  assert.equal(result.detail.groves[0].name, "raw");
  assert.equal(result.detail.groves[0].metadata, null);
});

test("schema-3 repository and Tree reads share observed Git facts", () => {
  const fx = makeFixture();
  initV2Workspace(fx);
  const primary = managedTrunkPath(fx, "alpha");
  const tree = join(fx.root, "groves", "demo", "trees", "demo@alpha");
  mkdirSync(join(fx.root, "groves", "demo", "trees"), { recursive: true });
  execFileSync("git", ["branch", "demo"], { cwd: primary });
  execFileSync("git", ["worktree", "add", "-q", tree, "demo"], { cwd: primary });

  for (const args of [["repo", "ls"], ["repo", "status", "alpha"], ["tree", "ls", "demo"], ["trunk", "ls", "alpha"]]) {
    const run = fx.grove(["--json", ...args]);
    assert.equal(run.status, 0, `${args.join(" ")}: ${run.stderr}`);
    const result = json(run.stdout);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.command, args.slice(0, 2).join(" "));
  }
  assert.equal(json(fx.grove(["--json", "tree", "ls", "demo"]).stdout).detail.trees[0].path.value, tree);
});
