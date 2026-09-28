import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
after(cleanupTempDirs);

function fixture() {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g1", "--repo", "alpha"]]) assert.equal(fx.grove(args).status, 0);
  return { fx, content: join(fx.root, "groves/g1"), tree: join(fx.root, "groves/g1/trees/g1@alpha") };
}

for (const [rootName, action] of [["Groves", "tree"], ["Groves", "delete"], ["Groves", "archive"], ["Archives", "tree"]]) {
  test(`V3DES-07 round5: case-variant ${rootName} survives ${action}`, (t) => {
    const fx = makeFixture({ repos: { self: [], alpha: [] } });
    assert.equal(fx.grove(["init"]).status, 0);
    const lower = join(fx.root, rootName!.toLowerCase());
    mkdirSync(lower, { recursive: true });
    if (!existsSync(join(fx.root, rootName!)) || statSync(lower).ino !== statSync(join(fx.root, rootName!)).ino) { t.skip("temporary volume is case-sensitive"); return; }
    const main = join(dirname(fx.root), "main");
    execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, main]);
    assert.equal(fx.grove(["repo", "link", main, "--name", "self"]).status, 0);
    assert.equal(fx.grove(["repo", "add", fx.repos[1]!.origin, "--name", "alpha"]).status, 0);
    execFileSync("git", ["worktree", "add", "-q", "-b", "g1", join(fx.root, rootName!)], { cwd: main });
    assert.equal(fx.grove(["new", "g1"]).status, 0);
    assert.equal(fx.grove(["new", "other", "--repo", "alpha"]).status, 0);
    writeFileSync(join(fx.root, "groves/other/notes.txt"), "precious\n");
    if (rootName === "Archives") assert.equal(fx.grove(["archive", "other"]).status, 0);
    const marker = join(lower, "other/notes.txt");
    const doctor = fx.grove(["--json", "doctor"]);
    const args = action === "tree" ? ["tree", "remove", "g1", "g1@self", "--allow-destructive-all"] : [action!, "g1", "--allow-destructive-all", ...(action === "archive" ? ["--allow-unpushed"] : [])];
    fx.grove(args);
    assert.deepEqual({ survives: existsSync(marker), diagnosed: JSON.parse(doctor.stdout).diagnostics.some((d: any) => d.code === "unsafe-tree-location") }, { survives: true, diagnosed: true });
  });
}

function preload(root: string, body: string): Record<string, string> {
  const path = join(root, "inject.mjs");
  writeFileSync(path, `import fs from 'node:fs'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
const spawn = cp.spawn; let injected = false;
cp.spawn = function(command, args, options) { ${body}\n return spawn.apply(this, arguments); }; syncBuiltinESMExports();`);
  return { NODE_OPTIONS: `--import=${path}` };
}

for (const action of ["delete", "tree"] as const) {
  test(`V3DES-01 round5: reconcile refuses new ${action === "delete" ? "loose content" : "Tree work"} after interrupted forced removal`, () => {
    const { fx, content, tree } = fixture();
    assert.equal(fx.grove(["configure", "g1", "--default-base", "main"]).status, 0);
    writeFileSync(join(tree, "known.txt"), "shown\n");
    writeFileSync(join(content, "known-loose.txt"), "shown loose\n");
    const env = preload(fx.root, `if(command === 'git' && args[0] === 'worktree' && args[1] === 'remove') process.kill(process.pid, 'SIGKILL');`);
    const args = action === "delete" ? ["delete", "g1", "--allow-destructive-all"] : ["tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"];
    assert.notEqual(fx.grove(args, { env }).status, 0);
    const marker = join(action === "delete" ? content : tree, "later-work.txt");
    writeFileSync(marker, "not authorized\n");
    const run = fx.grove(["--json", "reconcile"]);
    assert.deepEqual({ status: run.status, survives: existsSync(marker), stale: run.stdout.includes("stale-plan"), itemized: run.stdout.includes("later-work.txt"), recorded: run.stdout.includes(action === "delete" ? "known-loose.txt" : "known.txt") }, { status: 4, survives: true, stale: true, itemized: true, recorded: true });
    const again = fx.grove(["--json", "reconcile"]);
    assert.ok(again.stdout.includes("stale-plan"));
    assert.equal(readFileSync(marker, "utf8"), "not authorized\n");
  });
}

for (const action of ["delete", "archive", "rename"] as const) {
  test(`V3DES-08 round5: ${action} refuses loose content added during point-of-use observation`, () => {
    const { fx, content } = fixture();
    writeFileSync(join(content, "known.txt"), "known\n");
    const step = action === "delete" ? "delete-content" : action === "archive" ? "archive-content" : "move-content";
    const marker = join(content, "later.txt");
    const env = preload(fx.root, `if (!injected && command === 'git' && args[0] === 'worktree' && args[1] === 'list') {
      const pending = fs.readdirSync(${JSON.stringify(join(fx.root, ".grove/operations"))}).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(${JSON.stringify(join(fx.root, ".grove/operations"))}+'/'+f,'utf8'))).some(r=>r.steps.some(s=>s.id===${JSON.stringify(step)} && s.classification==='pending'));
      if(pending) { injected=true; fs.writeFileSync(${JSON.stringify(marker)}, 'unseen\\n'); }
    }`);
    const run = fx.grove(["--json", action, "g1", ...(action === "rename" ? ["next"] : ["--allow-destructive-all"])], { env });
    assert.deepEqual({status:run.status, survives:existsSync(marker), stale:run.stdout.includes('stale-plan')}, {status:4,survives:true,stale:true});
  });
}

test("V3DES-07 round5: doctor diagnoses an unresolvable protected root", () => {
  const { fx, tree } = fixture();
  execFileSync("git", ["worktree", "move", tree, join(fx.root, "data")], { cwd: join(fx.root, "repos/alpha") });
  rmSync(join(fx.root, "archives"), { recursive: true, force: true });
  symlinkSync("archives", join(fx.root, "archives"));
  const run = fx.grove(["--json", "doctor"]);
  assert.equal(run.status, 0, run.stdout);
  assert.ok(JSON.parse(run.stdout).diagnostics.some((d:any)=>d.code === 'unsafe-tree-location' && d.facts.unresolvable === true));
});

for (const mode of ["missing-registration", "repository-problem"]) {
  test(`V3DES-08 round5: rename refuses ${mode} at point of use`, () => {
    const { fx, tree } = fixture();
    const env = preload(fx.root, `if(command === 'git' && args[0] === 'worktree' && args[1] === 'list') {
      const pending = fs.readdirSync(${JSON.stringify(join(fx.root, ".grove/operations"))}).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(${JSON.stringify(join(fx.root, ".grove/operations"))}+'/'+f,'utf8'))).some(r=>r.kind==='grove-rename' && r.steps.some(s=>s.id==='move-0' && s.classification==='pending'));
      if(pending) return spawn(process.execPath, ['-e', ${JSON.stringify(mode === "repository-problem" ? "process.exit(1)" : "process.exit(0)")}], options);
    }`);
    const run = fx.grove(["--json", "rename", "g1", "next"], {env});
    assert.deepEqual({status:run.status, survives:existsSync(tree), stale:run.stdout.includes('stale-plan')},{status:4,survives:true,stale:true});
  });
}
