import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
after(cleanupTempDirs);

function nestedFixture(ignored = true) {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g1", "--repo", "alpha"]]) assert.equal(fx.grove(args).status, 0);
  const tree = join(fx.root, "groves/g1/trees/g1@alpha");
  execFileSync("git", ["-C", tree, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", tree, "config", "user.email", "test@example.com"]);
  if (ignored) {
    writeFileSync(join(tree, ".gitignore"), "nested/\n");
    execFileSync("git", ["-C", tree, "add", ".gitignore"]);
    execFileSync("git", ["-C", tree, "commit", "-qm", "ignore"]);
  }
  const nested = join(tree, "nested");
  mkdirSync(nested);
  execFileSync("git", ["init", "-q", nested]);
  writeFileSync(join(nested, "old.txt"), "old\n");
  return { fx, tree, nested };
}

function submoduleFixture() {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g1", "--repo", "alpha"]]) assert.equal(fx.grove(args).status, 0);
  const tree = join(fx.root, "groves/g1/trees/g1@alpha");
  execFileSync("git", ["-C", tree, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", tree, "config", "user.email", "test@example.com"]);
  const source = join(dirname(fx.root), "module-source");
  execFileSync("git", ["init", "-q", "--initial-branch=main", source]);
  execFileSync("git", ["-C", source, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", source, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", source, "config", "receive.denyCurrentBranch", "ignore"]);
  writeFileSync(join(source, "README.md"), "module\n");
  execFileSync("git", ["-C", source, "add", "README.md"]);
  execFileSync("git", ["-C", source, "commit", "-qm", "initial"]);
  execFileSync("git", ["-C", tree, "-c", "protocol.file.allow=always", "submodule", "add", "-q", source, "module"]);
  const modulePath = join(tree, "module");
  execFileSync("git", ["-C", modulePath, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", modulePath, "config", "user.email", "test@example.com"]);
  writeFileSync(join(modulePath, ".gitignore"), "ignored.txt\n");
  execFileSync("git", ["-C", modulePath, "add", ".gitignore"]);
  execFileSync("git", ["-C", modulePath, "commit", "-qm", "ignore"]);
  execFileSync("git", ["-C", modulePath, "push", "-q", "origin", "HEAD:main"]);
  execFileSync("git", ["-C", tree, "add", ".gitmodules", "module"]);
  execFileSync("git", ["-C", tree, "commit", "-qm", "add module"]);
  writeFileSync(join(modulePath, "ignored.txt"), "only copy\n");
  return { fx, tree, modulePath };
}

for (const flag of ["--allow-destructive-git-ignored", "--allow-destructive-all"]) {
  test(`V3DES-01 round7: ${flag} cannot remove a tracked submodule with ignored inner work`, () => {
    const { fx, tree, modulePath } = submoduleFixture();
    const run = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", flag]);
    assert.equal(run.status, 4, run.stdout);
    assert.ok(/submodule|repository|git identity/i.test(run.stdout), run.stdout);
    assert.ok(run.stdout.includes("module"), run.stdout);
    assert.equal(readFileSync(join(modulePath, "ignored.txt"), "utf8"), "only copy\n");
    assert.ok(existsSync(join(modulePath, ".git")) && existsSync(tree));
  });
}

test("V3DES-01 round7: ordinary untracked nested repository is refused even with all-content consent", () => {
  const { fx, tree, nested } = nestedFixture(false);
  const run = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"]);
  assert.equal(run.status, 4, run.stdout);
  assert.ok(run.stdout.includes("nested") && /repository|Git identity/i.test(run.stdout), run.stdout);
  assert.equal(readFileSync(join(nested, "old.txt"), "utf8"), "old\n");
  assert.ok(existsSync(join(nested, ".git/HEAD")) && existsSync(tree));
});

test("V3DES-01 round7: nested bare Git repository is refused as independent ownership", () => {
  const { fx, tree, nested } = nestedFixture(false);
  rmSync(nested, { recursive: true, force: true });
  const bare = join(tree, "bare");
  execFileSync("git", ["init", "--bare", "-q", bare]);
  const run = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"]);
  assert.equal(run.status, 4, run.stdout);
  assert.ok(run.stdout.includes("bare") && /repository|Git identity/i.test(run.stdout), run.stdout);
  assert.ok(existsSync(join(bare, "HEAD")) && existsSync(tree));
});

for (const command of ["trunk", "archive", "delete"]) {
  test(`V3DES-01 round7: ${command} refuses an independent nested checkout before removal`, () => {
    const { fx, tree, nested } = nestedFixture();
    let protectedPath = nested;
    if (command === "trunk") {
      const trunk = join(fx.root, "trunks/main@alpha");
      protectedPath = join(trunk, "nested");
      mkdirSync(protectedPath);
      execFileSync("git", ["init", "-q", protectedPath]);
      writeFileSync(join(protectedPath, "unique.txt"), "unique\n");
    }
    const args = command === "trunk" ? ["trunk", "remove", "alpha", "main"] : [command, "g1"];
    const run = fx.grove(["--json", ...args, "--allow-destructive-all", ...(command === "archive" ? ["--allow-unpushed"] : [])]);
    assert.equal(run.status, 4, run.stdout);
    assert.ok(run.stdout.includes("nested") && /repository|Git identity/i.test(run.stdout), run.stdout);
    assert.ok(existsSync(join(protectedPath, ".git/HEAD")) && existsSync(tree));
  });
}

for (const command of ["archive", "rename"]) {
  test(`V3DES-01 round7: ${command} refuses to move loose independent Git ownership`, () => {
    const { fx, nested } = nestedFixture(false);
    rmSync(nested, { recursive: true, force: true });
    const loose = join(fx.root, "groves/g1/loose-repo");
    execFileSync("git", ["init", "-q", loose]);
    writeFileSync(join(loose, "unique.txt"), "unique\n");
    const args = command === "rename" ? ["rename", "g1", "g2"] : ["archive", "g1", "--allow-unpushed", "--allow-destructive-all"];
    const run = fx.grove(["--json", ...args]);
    assert.equal(run.status, 4, run.stdout);
    assert.ok(run.stdout.includes("loose-repo") && /repository|Git identity/i.test(run.stdout), run.stdout);
    assert.equal(readFileSync(join(loose, "unique.txt"), "utf8"), "unique\n");
    assert.ok(existsSync(join(loose, ".git/HEAD")));
  });
}

for (const flag of ["--allow-destructive-git-ignored", "--allow-destructive-all"]) {
  test(`V3DES-01 round7: ${flag} cannot remove an independently owned ignored nested repository`, () => {
    const { fx, tree, nested } = nestedFixture();
    const run = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", flag]);
    assert.equal(run.status, 4, run.stdout);
    assert.ok(/repository|git identity|git metadata/i.test(run.stdout), run.stdout);
    assert.ok(run.stdout.includes("nested"), run.stdout);
    assert.equal(readFileSync(join(nested, "old.txt"), "utf8"), "old\n");
    assert.ok(existsSync(join(nested, ".git/HEAD")) && existsSync(tree));
  });
}

test("V3DES-01 round7: newly written file in an ignored nested Git repository survives removal replay", () => {
  const { fx, tree, nested } = nestedFixture();
  const preload = join(fx.root, "kill.mjs");
  writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; cp.spawn=function(command,args,options){ if(command==='git' && args[0]==='worktree' && args[1]==='remove') process.kill(process.pid,'SIGKILL'); return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
  const started = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", "--allow-destructive-git-ignored"], { env: { NODE_OPTIONS: `--import=${preload}` } });
  const later = join(nested, "new.txt");
  writeFileSync(later, "not authorized\n");
  if (started.status === 4) {
    // A structural repository boundary may refuse before creating a removal plan.
    assert.ok(existsSync(join(nested, ".git/HEAD")) && existsSync(later));
    return;
  }
  assert.notEqual(started.status, 0, started.stdout);
  const operations = join(fx.root, ".grove/operations");
  const record = readdirSync(operations).filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(readFileSync(join(operations, name), "utf8")))
    .find(candidate => candidate.kind === "tree-remove");
  assert.ok(record, "interrupted Tree removal must have a durable operation");
  assert.ok(record.steps[0].input.discardedWork.length > 0);
  const replay = fx.grove(["--json", "reconcile"]);
  assert.equal(replay.status, 4, replay.stdout);
  assert.ok(replay.stdout.includes("stale-plan") && replay.stdout.includes("nested/new.txt"), replay.stdout);
  assert.equal(readFileSync(later, "utf8"), "not authorized\n");
  assert.ok(existsSync(join(nested, ".git/HEAD")));
});

test("V3DES-01 round7: ordinary untracked nested Git repository survives removal replay", () => {
  const { fx, nested } = nestedFixture(false);
  const preload = join(fx.root, "kill.mjs");
  writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; cp.spawn=function(command,args,options){ if(command==='git' && args[0]==='worktree' && args[1]==='remove') process.kill(process.pid,'SIGKILL'); return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
  const started = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"], { env: { NODE_OPTIONS: `--import=${preload}` } });
  const later = join(nested, "new.txt");
  writeFileSync(later, "not authorized\n");
  if (started.status !== 4) {
    assert.notEqual(started.status, 0, started.stdout);
    const replay = fx.grove(["--json", "reconcile"]);
    assert.equal(replay.status, 4, replay.stdout);
    assert.ok(replay.stdout.includes("nested"), replay.stdout);
  }
  assert.equal(readFileSync(later, "utf8"), "not authorized\n");
  assert.ok(existsSync(join(nested, ".git/HEAD")));
});

test("V3DES-01 round7: populated submodule appearing after a pending plan survives reconcile", () => {
  const { fx, tree, modulePath } = submoduleFixture();
  execFileSync("git", ["-C", tree, "submodule", "deinit", "-f", "module"]);
  assert.ok(!existsSync(join(modulePath, ".git")));
  const preload = join(fx.root, "kill.mjs");
  writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; cp.spawn=function(command,args,options){ if(command==='git' && args[0]==='worktree' && args[1]==='remove') process.kill(process.pid,'SIGKILL'); return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
  const started = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"], { env: { NODE_OPTIONS: `--import=${preload}` } });
  assert.notEqual(started.status, 0, started.stdout);
  execFileSync("git", ["-C", tree, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "module"]);
  writeFileSync(join(modulePath, "ignored.txt"), "new unique work\n");
  const replay = fx.grove(["--json", "reconcile"]);
  assert.equal(replay.status, 4, replay.stdout);
  assert.ok(replay.stdout.includes("module") && /repository|Git identity|stale-plan/i.test(replay.stdout), replay.stdout);
  assert.equal(readFileSync(join(modulePath, "ignored.txt"), "utf8"), "new unique work\n");
  assert.ok(existsSync(join(modulePath, ".git")) && existsSync(tree));
});
