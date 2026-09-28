import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
after(cleanupTempDirs);

function fixture() {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g1", "--repo", "alpha"]]) assert.equal(fx.grove(args).status, 0);
  const tree = join(fx.root, "groves/g1/trees/g1@alpha");
  execFileSync("git", ["-C", tree, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", tree, "config", "user.email", "test@example.com"]);
  writeFileSync(join(tree, ".gitignore"), "ignored/\nignored.txt\n");
  execFileSync("git", ["-C", tree, "add", ".gitignore"]);
  execFileSync("git", ["-C", tree, "commit", "-qm", "ignore"]);
  return { fx, tree };
}

function args(command: string, flag?: string): string[] {
  return ["--json", ...(command === "tree" ? ["tree", "remove", "g1", "g1@alpha"] : command === "trunk" ? ["trunk", "remove", "alpha", "main"] : [command, "g1"]), ...(flag ? [flag] : []), ...(command === "archive" ? ["--allow-unpushed"] : [])];
}

for (const command of ["tree", "archive", "delete"]) {
  test(`V3DES-01 round6: ${command} refuses an ignored file without a flag`, () => {
    const { fx, tree } = fixture();
    writeFileSync(join(tree, "ignored.txt"), "unique\n");
    const run = fx.grove(args(command));
    assert.equal(run.status, 5, run.stdout);
    assert.ok(run.stdout.includes("ignored.txt"), run.stdout);
    assert.equal(readFileSync(join(tree, "ignored.txt"), "utf8"), "unique\n");
  });
}

test("V3DES-01 round6: trunk refuses an ignored file without a flag", () => {
  const { fx } = fixture();
  const trunk = join(fx.root, "trunks/main@alpha");
  writeFileSync(join(trunk, ".gitignore"), "ignored.txt\n");
  execFileSync("git", ["-C", trunk, "add", ".gitignore"]);
  execFileSync("git", ["-C", trunk, "commit", "-qm", "ignore"]);
  writeFileSync(join(trunk, "ignored.txt"), "unique\n");
  const run = fx.grove(args("trunk"));
  assert.equal(run.status, 5, run.stdout);
  assert.ok(run.stdout.includes("ignored.txt"), run.stdout);
  assert.ok(existsSync(join(trunk, "ignored.txt")));
});

test("V3DES-01 round6: ignored directory expands into individual consent paths", () => {
  const { fx, tree } = fixture();
  mkdirSync(join(tree, "ignored"));
  writeFileSync(join(tree, "ignored/a.txt"), "a");
  writeFileSync(join(tree, "ignored/b.txt"), "b");
  const refusal = fx.grove(args("tree"));
  assert.equal(refusal.status, 5, refusal.stdout);
  assert.ok(refusal.stdout.includes("ignored/a.txt") && refusal.stdout.includes("ignored/b.txt"), refusal.stdout);
});

test("V3DES-01 round6: ignored-only consent refuses tracked work and permits ignored work", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "ignored.txt"), "ignored\n");
  writeFileSync(join(tree, ".gitignore"), "ignored/\nignored.txt\ntracked change\n");
  const refused = fx.grove(args("tree", "--allow-destructive-git-ignored"));
  assert.equal(refused.status, 5, refused.stdout);
  assert.ok(existsSync(join(tree, "ignored.txt")));
  execFileSync("git", ["-C", tree, "checkout", "--", ".gitignore"]);
  const allowed = fx.grove(args("tree", "--allow-destructive-git-ignored"));
  assert.equal(allowed.status, 0, allowed.stdout);
  assert.ok(allowed.stdout.includes("ignored.txt"), allowed.stdout);
});

test("V3DES-01 round6: ignored-only consent refuses loose Grove content", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "ignored.txt"), "ignored\n");
  writeFileSync(join(fx.root, "groves/g1/notes.txt"), "loose\n");
  const run = fx.grove(args("delete", "--allow-destructive-git-ignored"));
  assert.equal(run.status, 5, run.stdout);
  assert.ok(run.stdout.includes("notes.txt"), run.stdout);
  assert.ok(existsSync(join(tree, "ignored.txt")));
});

test("V3DES-01 round6: ignored-only consent refuses ordinary untracked content", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "ignored.txt"), "ignored\n");
  writeFileSync(join(tree, "ordinary.txt"), "ordinary\n");
  const run = fx.grove(args("tree", "--allow-destructive-git-ignored"));
  assert.equal(run.status, 5, run.stdout);
  assert.ok(run.stdout.includes("ordinary.txt"), run.stdout);
  assert.ok(existsSync(join(tree, "ignored.txt")) && existsSync(join(tree, "ordinary.txt")));
});

for (const command of ["archive", "delete", "trunk"]) {
  test(`V3DES-01 round6: ${command} ignored-only consent removes and reports only ignored files`, () => {
    const { fx, tree } = fixture();
    const target = command === "trunk" ? join(fx.root, "trunks/main@alpha") : tree;
    if (command === "trunk") {
      writeFileSync(join(target, ".gitignore"), "ignored.txt\n");
      execFileSync("git", ["-C", target, "add", ".gitignore"]);
      execFileSync("git", ["-C", target, "commit", "-qm", "ignore"]);
    }
    writeFileSync(join(target, "ignored.txt"), "unique\n");
    const run = fx.grove(args(command, "--allow-destructive-git-ignored"));
    assert.equal(run.status, 0, run.stdout);
    const after = JSON.parse(run.stdout).targets[0].after;
    const changes = command === "trunk" ? after.discardedWork : after.discardedWork.flatMap((item: { changes: Array<{ path: string; status: string }> }) => item.changes);
    assert.deepEqual(changes.map((entry: { path: string; status: string }) => [entry.status, entry.path]), [["!!", "ignored.txt"]]);
  });
}

test("V3DES-01 round6: all consent reports ignored files, including directory children", () => {
  const { fx, tree } = fixture();
  mkdirSync(join(tree, "ignored"));
  writeFileSync(join(tree, "ignored/a.txt"), "a");
  writeFileSync(join(tree, "ignored/b.txt"), "b");
  const run = fx.grove(args("tree", "--allow-destructive-all"));
  assert.equal(run.status, 0, run.stdout);
  const changes = JSON.parse(run.stdout).targets[0].after.discardedWork;
  assert.deepEqual(changes.map((entry: { status: string; path: string }) => [entry.status, entry.path]).sort(), [["!!", "ignored/a.txt"], ["!!", "ignored/b.txt"]]);
});

test("V3DES-01 round6: recovery refuses a new ignored child after recorded consent", () => {
  const { fx, tree } = fixture();
  mkdirSync(join(tree, "ignored"));
  writeFileSync(join(tree, "ignored/a.txt"), "a");
  const preload = join(fx.root, "kill.mjs");
  writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; cp.spawn=function(command,args,options){ if(command==='git' && args[0]==='worktree' && args[1]==='remove') process.kill(process.pid,'SIGKILL'); return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
  const killed = fx.grove(args("tree", "--allow-destructive-all"), { env: { NODE_OPTIONS: `--import=${preload}` } });
  assert.notEqual(killed.status, 0);
  writeFileSync(join(tree, "ignored/b.txt"), "new\n");
  const replay = fx.grove(["--json", "reconcile"]);
  assert.equal(replay.status, 4, replay.stdout);
  assert.ok(replay.stdout.includes("ignored/b.txt"), replay.stdout);
  assert.equal(readFileSync(join(tree, "ignored/b.txt"), "utf8"), "new\n");
});

test("V3DES-01 round6: unchanged ignored consent resumes and reports actual discard", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "ignored.txt"), "known\n");
  const preload = join(fx.root, "kill.mjs");
  writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; cp.spawn=function(command,args,options){ if(command==='git' && args[0]==='worktree' && args[1]==='remove') process.kill(process.pid,'SIGKILL'); return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
  assert.notEqual(fx.grove(args("tree", "--allow-destructive-all"), { env: { NODE_OPTIONS: `--import=${preload}` } }).status, 0);
  const replay = fx.grove(["--json", "reconcile"]);
  assert.equal(replay.status, 0, replay.stdout);
  assert.ok(!existsSync(tree));
  assert.ok(replay.stdout.includes('"status":"!!"') && replay.stdout.includes("ignored.txt"), replay.stdout);
});

test("V3DES-01 round6: old pending record cannot gain ignored-file consent", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "known.txt"), "known\n");
  const preload = join(fx.root, "kill.mjs");
  writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; cp.spawn=function(command,args,options){ if(command==='git' && args[0]==='worktree' && args[1]==='remove') process.kill(process.pid,'SIGKILL'); return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
  assert.notEqual(fx.grove(args("tree", "--allow-destructive-all"), { env: { NODE_OPTIONS: `--import=${preload}` } }).status, 0);
  const operations = join(fx.root, ".grove/operations");
  const operationFile = join(operations, readdirSync(operations).find(name => name.endsWith(".json"))!);
  const record = JSON.parse(readFileSync(operationFile, "utf8"));
  delete record.steps[0].input.consent;
  record.steps[0].input.allowDestructive = true;
  writeFileSync(operationFile, JSON.stringify(record));
  writeFileSync(join(tree, "ignored.txt"), "later\n");
  const replay = fx.grove(["--json", "reconcile"]);
  assert.equal(replay.status, 4, replay.stdout);
  assert.ok(replay.stdout.includes("ignored.txt"), replay.stdout);
  assert.ok(existsSync(join(tree, "ignored.txt")));
});

test("V3DES-01 round6: direct discard receipt omits a vanished preflight file", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "vanish.txt"), "old\n");
  writeFileSync(join(tree, "remain.txt"), "old\n");
  const preload = join(fx.root, "vanish.mjs");
  writeFileSync(preload, `import fs from 'node:fs'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; let n=0; cp.spawn=function(command,args,options){ if(command==='git' && args[0]==='worktree' && args[1]==='list' && ++n===3) fs.unlinkSync(${JSON.stringify(join(tree, "vanish.txt"))}); return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
  const run = fx.grove(args("tree", "--allow-destructive-all"), { env: { NODE_OPTIONS: `--import=${preload}` } });
  assert.equal(run.status, 0, run.stdout);
  assert.deepEqual(JSON.parse(run.stdout).targets[0].after.discardedWork.map((entry: { path: string }) => entry.path), ["remain.txt"]);
});

for (const command of ["archive", "delete", "trunk"]) {
  test(`V3DES-01 round6: ${command} receipt excludes vanished preflight work`, () => {
    const { fx, tree } = fixture();
    const target = command === "trunk" ? join(fx.root, "trunks/main@alpha") : tree;
    writeFileSync(join(target, "vanish.txt"), "old\n");
    writeFileSync(join(target, "remain.txt"), "old\n");
    const preload = join(fx.root, "vanish.mjs");
    const operations = join(fx.root, ".grove/operations");
    writeFileSync(preload, `import fs from 'node:fs'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const spawn=cp.spawn; let injected=false; cp.spawn=function(command,args,options){ if(!injected && command==='git' && args[0]==='worktree' && args[1]==='list') { const pending=fs.readdirSync(${JSON.stringify(operations)}).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(${JSON.stringify(operations)}+'/'+f,'utf8'))).some(r=>r.steps.some(s=>s.kind==='worktree-remove' && s.classification==='pending')); if(pending){ injected=true; fs.unlinkSync(${JSON.stringify(join(target, "vanish.txt"))}); } } return spawn.apply(this,arguments); }; syncBuiltinESMExports();`);
    const run = fx.grove(args(command, "--allow-destructive-all"), { env: { NODE_OPTIONS: `--import=${preload}` } });
    assert.equal(run.status, 0, run.stdout);
    const after = JSON.parse(run.stdout).targets[0].after;
    const names = command === "trunk" ? after.discardedWork.map((entry: { path: string }) => entry.path) : after.discardedWork.flatMap((item: { changes: Array<{ path: string }> }) => item.changes.map(entry => entry.path));
    assert.deepEqual(names, ["remain.txt"]);
  });
}

test("V3DES-03 round6: old public destructive flag is rejected", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "ordinary.txt"), "unique\n");
  const run = fx.grove(args("tree", "--allow-destructive"));
  assert.equal(run.status, 2, run.stdout);
  assert.ok(existsSync(join(tree, "ordinary.txt")));
});

test("V3DES-03 round6: destructive permission levels cannot be combined", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "ignored.txt"), "unique\n");
  const run = fx.grove([...args("tree", "--allow-destructive-all"), "--allow-destructive-git-ignored"]);
  assert.equal(run.status, 2, run.stdout);
  assert.ok(existsSync(join(tree, "ignored.txt")));
});

test("V3DES-01 round6: human refusal and forced receipt name ignored file", () => {
  const { fx, tree } = fixture();
  writeFileSync(join(tree, "ignored.txt"), "unique\n");
  const refused = fx.grove(["tree", "remove", "g1", "g1@alpha"]);
  assert.equal(refused.status, 5, refused.stdout);
  assert.ok((refused.stdout + refused.stderr).includes("ignored.txt"), refused.stdout + refused.stderr);
  const forced = fx.grove(["tree", "remove", "g1", "g1@alpha", "--allow-destructive-git-ignored"]);
  assert.equal(forced.status, 0, forced.stdout);
  assert.ok(forced.stdout.includes("ignored.txt"), forced.stdout);
});
