import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beginOperation, recordPending } from "../../src/store/operation.ts";
import { makeFixture, managedAnchorPath } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
after(cleanupTempDirs);

function fixture(ignored: boolean) {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g1", "--repo", "alpha"]]) assert.equal(fx.grove(args).status, 0);
  const tree = join(fx.root, "groves/g1/trees/g1@alpha");
  if (ignored) {
    writeFileSync(join(tree, ".gitignore"), "nested/\n");
    execFileSync("git", ["-C", tree, "add", ".gitignore"]);
    execFileSync("git", ["-C", tree, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "ignore nested"]);
  }
  return { fx, tree };
}

function linkedCheckout(fx: ReturnType<typeof makeFixture>, tree: string) {
  const source = join(dirname(fx.root), "independent");
  execFileSync("git", ["init", "-q", "--initial-branch=main", source]);
  writeFileSync(join(source, "README.md"), "independent\n");
  execFileSync("git", ["-C", source, "add", "README.md"]);
  execFileSync("git", ["-C", source, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"]);
  const nested = join(tree, "nested");
  execFileSync("git", ["-C", source, "worktree", "add", "--detach", "-q", nested]);
  renameSync(join(nested, ".git"), join(nested, ".GIT"));
  writeFileSync(join(nested, "unique.txt"), "unique only here\n");
  return { nested, source };
}

function caseAliasWorks(path: string): boolean {
  return existsSync(join(path, ".git")) && statSync(join(path, ".git")).ino === statSync(join(path, ".GIT")).ino;
}

for (const [flag, ignored] of [["--allow-destructive-all", false], ["--allow-destructive-all", true], ["--allow-destructive-git-ignored", true]] as const) {
  test(`V3DES-01 round8: ${flag} refuses a ${ignored ? "ignored" : "ordinary"} linked checkout with a .GIT file`, (t) => {
    const { fx, tree } = fixture(ignored);
    const { nested } = linkedCheckout(fx, tree);
    if (!caseAliasWorks(nested)) { t.skip("temporary volume is case-sensitive"); return; }
    assert.equal(execFileSync("git", ["-C", nested, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).trim(), "true");
    assert.ok(readdirSync(nested).includes(".GIT"));
    const run = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", flag]);
    assert.equal(run.status, 4, run.stdout);
    assert.ok(/nested|repository|Git identity/i.test(run.stdout), run.stdout);
    assert.equal(readFileSync(join(nested, "unique.txt"), "utf8"), "unique only here\n");
    assert.ok(existsSync(join(nested, ".GIT")) && existsSync(tree));
  });
}

test("V3DES-01 round8: native Git bare HEAD alias blocks all-content removal", (t) => {
  const { fx, tree } = fixture(false);
  const nested = join(tree, "nested");
  execFileSync("git", ["init", "--bare", "-q", nested]);
  renameSync(join(nested, "HEAD"), join(nested, "head"));
  if (!existsSync(join(nested, "HEAD")) || statSync(join(nested, "HEAD")).ino !== statSync(join(nested, "head")).ino) { t.skip("temporary volume is case-sensitive"); return; }
  assert.equal(execFileSync("git", [`--git-dir=${nested}`, "rev-parse", "--is-bare-repository"], { encoding: "utf8" }).trim(), "true");
  writeFileSync(join(nested, "unique.txt"), "unique bare work\n");
  const run = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"]);
  assert.equal(run.status, 4, run.stdout);
  assert.ok(run.stdout.includes("nested") && /repository|Git identity/i.test(run.stdout), run.stdout);
  assert.equal(readFileSync(join(nested, "unique.txt"), "utf8"), "unique bare work\n");
  assert.ok(existsSync(join(nested, "head")) && existsSync(tree));
});

for (const [flag, ignored] of [["--allow-destructive-all", false], ["--allow-destructive-git-ignored", true]] as const) {
  test(`V3DES-01 round8: reconcile refuses legacy ${ignored ? "ignored" : "ordinary"} consent for a .GIT linked checkout`, (t) => {
    const { fx, tree } = fixture(ignored);
    const { nested } = linkedCheckout(fx, tree);
    if (!caseAliasWorks(nested)) { t.skip("temporary volume is case-sensitive"); return; }
    const repositoryId = JSON.parse(readFileSync(join(fx.root, ".grove/config.json"), "utf8")).repositories[0].id as string;
    const headOid = execFileSync("git", ["-C", tree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    // This is the exact collapsed consent that b330ba0 could record before a crash.
    const operation = beginOperation(fx.root, { kind: "tree-remove", scope: { grove: "g1" }, targetLocks: ["grove:g1", `worktree:${tree}`], targets: [{ selector: { repositoryId, grove: "g1", tree: "g1@alpha", path: tree }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: tree, commonGitDir: managedAnchorPath(fx, "alpha"), headOid, branch: "refs/heads/g1", consent: flag === "--allow-destructive-all" ? "all" : "ignored", discardedWork: [{ status: ignored ? "!!" : "??", path: "nested/" }] } }] }] });
    recordPending(operation, "remove", { path: tree, headOid, dirty: true });
    const later = join(nested, "later.txt");
    writeFileSync(later, "after plan\n");
    const replay = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.equal(replay.status, 4, replay.stdout);
    assert.ok(replay.stdout.includes("nested") && /stale-plan|repository|Git identity/i.test(replay.stdout), replay.stdout);
    assert.equal(readFileSync(later, "utf8"), "after plan\n");
    assert.ok(existsSync(join(nested, ".GIT")) && existsSync(tree));
  });
}

test("V3DES-01 round8 control: outer worktree's own .GIT marker retains its observed filesystem identity", (t) => {
  const { fx, tree } = fixture(false);
  renameSync(join(tree, ".git"), join(tree, ".GIT"));
  if (!caseAliasWorks(tree)) { t.skip("temporary volume is case-sensitive"); return; }
  writeFileSync(join(tree, "ordinary.txt"), "consented work\n");
  const run = fx.grove(["--json", "tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"]);
  assert.equal(run.status, 0, run.stdout);
  assert.ok(!existsSync(tree));
});
