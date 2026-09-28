import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);
const json = (text: string): any => JSON.parse(text.trim());
const success = (result: { status: number; stdout: string; stderr: string }): any => { assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`); return json(result.stdout); };
const operations = (root: string): string[] => readdirSync(join(root, ".grove", "operations")).filter((name) => name.endsWith(".json")).sort();

function grouped(repos: Record<string, string[]> = { alpha: [], beta: [] }) {
  const fx = makeFixture({ repos });
  success(fx.grove(["--json", "init"]));
  success(fx.grove(["--json", "config", "set", "--values", JSON.stringify({ layout: { trees: "groves/{grove}/trees/{repo}/{tree}" } })]));
  for (const repo of fx.repos) success(fx.grove(["--json", "repo", "add", repo.origin, "--name", repo.name]));
  return fx;
}

test("V3ALY-01: archive refuses uninspectable repository and itemizes Tree content without moving it", () => {
  const fx = makeFixture();
  success(fx.grove(["--json", "init"]));
  success(fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"]));
  success(fx.grove(["--json", "new", "demo", "--repo", "alpha"]));
  const tree = join(fx.root, "groves", "demo", "trees", "demo@alpha");
  const untracked = join(tree, "at-risk.txt");
  writeFileSync(untracked, "keep me\n");
  const store = join(fx.root, "repos", "alpha");
  const offline = `${store}.offline`;
  const before = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: store, encoding: "utf8" });
  const records = operations(fx.root);
  const malformed = fx.grove(["--json", "archive", "demo", "--allow-destructive-all", "--allow-unpushed"], { env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.http://X@h/", GIT_CONFIG_VALUE_0: "x" } });
  assert.equal(malformed.status, 5, malformed.stdout);
  assert.match(malformed.stdout, /at-risk\.txt/);
  assert.deepEqual(operations(fx.root), records);
  renameSync(store, offline);
  const run = fx.grove(["--json", "archive", "demo", "--allow-destructive-all", "--allow-unpushed"]);
  const result = json(run.stdout);
  renameSync(offline, store);
  const after = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: store, encoding: "utf8" });
  assert.deepEqual({ refused: run.status !== 0, atRisk: JSON.stringify(result).includes("at-risk.txt"), treeNamed: JSON.stringify(result).includes("demo@alpha"), preserved: readFileSync(untracked, "utf8"), archiveAbsent: !existsSync(join(fx.root, "archives", "demo")), registrationUnchanged: after === before, noNewOperation: JSON.stringify(operations(fx.root)) === JSON.stringify(records) }, { refused: true, atRisk: true, treeNamed: true, preserved: "keep me\n", archiveAbsent: true, registrationUnchanged: true, noNewOperation: true });
});

test("V3ALY-02: empty repository Tree slots do not require destructive consent, but files in them do", () => {
  const fx = grouped();
  success(fx.grove(["--json", "new", "demo", "--all"]));
  const alpha = join(fx.root, "groves", "demo", "trees", "alpha", "demo@alpha");
  const moved = join(fx.root, "groves", "demo", "trees", "beta", "demo@alpha");
  execFileSync("git", ["worktree", "move", "--", alpha, moved], { cwd: join(fx.root, "repos", "alpha") });
  const empty = join(fx.root, "groves", "demo", "trees", "alpha");
  assert.equal(existsSync(empty), true);
  const file = join(empty, "note.txt");
  writeFileSync(file, "keep\n");
  const blocked = fx.grove(["--json", "delete", "demo"]);
  assert.ok(blocked.status !== 0, blocked.stdout);
  assert.match(blocked.stdout, /note\.txt/);
  assert.equal(readFileSync(file, "utf8"), "keep\n");
  rmSync(file);
  const deleted = fx.grove(["--json", "delete", "demo"]);
  assert.equal(deleted.status, 0, `${deleted.stderr}\n${deleted.stdout}`);

  const repaired = grouped({ alpha: [] });
  success(repaired.grove(["--json", "new", "demo", "--repo", "alpha"]));
  const slots = join(repaired.root, "groves", "demo", "trees");
  mkdirSync(join(slots, "beta"));
  execFileSync("git", ["worktree", "move", "--", join(slots, "alpha", "demo@alpha"), join(slots, "beta", "demo@alpha")], { cwd: join(repaired.root, "repos", "alpha") });
  success(repaired.grove(["--json", "fix", "--move"]));
  assert.equal(existsSync(join(slots, "beta")), true);
  const repairedDelete = repaired.grove(["--json", "delete", "demo"]);
  assert.equal(repairedDelete.status, 0, `${repairedDelete.stderr}\n${repairedDelete.stdout}`);
});

test("V3ALY-02: wrapper projection remains protected loose Grove content", () => {
  for (const trees of [null, "groves/{grove}/{repo}/{tree}"]) {
    const fx = makeFixture();
    success(fx.grove(["--json", "init"]));
    if (trees) success(fx.grove(["--json", "config", "set", "--values", JSON.stringify({ layout: { trees } })]));
    success(fx.grove(["--json", "new", "demo"]));
    const wrapper = join(fx.root, "groves", "demo", ".grove-cmux");
    const projection = join(wrapper, "projection.json");
    mkdirSync(wrapper);
    writeFileSync(projection, "{}\n");
    const refused = fx.grove(["delete", "demo"]);
    assert.equal(refused.status, 5, refused.stdout);
    assert.match(`${refused.stdout}${refused.stderr}`, /\.grove-cmux\/projection\.json/);
    assert.equal(readFileSync(projection, "utf8"), "{}\n");
    rmSync(projection);
    const empty = fx.grove(["--json", "delete", "demo"]);
    assert.equal(empty.status, 5, empty.stdout);
    assert.equal(json(empty.stdout).error.kind, "refused-precondition");
    assert.match(empty.stdout, /\.grove-cmux/);
    assert.equal(existsSync(wrapper), true);
  }
});

test("V3ALY-03: colliding fix destinations refuse before a plan or Git move", () => {
  const fx = grouped({ alpha: [], beta: [], gamma: [] });
  success(fx.grove(["--json", "new", "demo", "--repo", "alpha"]));
  success(fx.grove(["--json", "tree", "add", "demo", "alpha", "--name", "second", "--branch", "second", "--from", "main"]));
  const store = join(fx.root, "repos", "alpha");
  const root = join(fx.root, "groves", "demo", "trees");
  const first = join(root, "beta", "shared");
  const second = join(root, "gamma", "shared");
  mkdirSync(join(root, "beta"), { recursive: true });
  mkdirSync(join(root, "gamma"), { recursive: true });
  execFileSync("git", ["worktree", "move", "--", join(root, "alpha", "demo@alpha"), first], { cwd: store });
  execFileSync("git", ["worktree", "move", "--", join(root, "alpha", "second"), second], { cwd: store });
  const records = operations(fx.root);
  for (const args of [["--json", "fix", "--move", "--dry-run"], ["--json", "fix", "--move"]]) {
    const run = fx.grove(args);
    assert.ok(run.status !== 0, run.stdout);
    assert.match(run.stdout, /same destination|collision|duplicate/i);
    assert.equal(existsSync(join(first, ".git")), true);
    assert.equal(existsSync(join(second, ".git")), true);
    assert.deepEqual(operations(fx.root), records);
  }
});

test("V3ALY-04: a distinct case-variant repository slot is repaired to the owner's exact slot", (t) => {
  const fx = grouped();
  success(fx.grove(["--json", "new", "demo", "--repo", "alpha"]));
  const root = join(fx.root, "groves", "demo", "trees");
  mkdirSync(join(root, "Alpha"), { recursive: true });
  if (existsSync(join(root, "Alpha", "demo@alpha"))) { t.skip("case-insensitive volume"); return; }
  const expected = join(root, "alpha", "demo@alpha");
  const variant = join(root, "Alpha", "demo@alpha");
  execFileSync("git", ["worktree", "move", "--", expected, variant], { cwd: join(fx.root, "repos", "alpha") });
  const doctor = success(fx.grove(["--json", "doctor"]));
  assert.ok(doctor.diagnostics.some((entry: any) => entry.code === "misplaced" && entry.facts.currentPath === variant && entry.facts.expectedPath === expected), JSON.stringify(doctor));
  success(fx.grove(["--json", "fix", "--move"]));
  assert.equal(existsSync(join(expected, ".git")), true);
});
