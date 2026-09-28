import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixture, type Fixture, type RunResult } from "../testkit/fixture.ts";
import { FAKE_AGENT_PATH } from "../testkit/fake-agent.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BUNDLE = join(ROOT, "dist", "grove.mjs");
const json = (text: string): any => JSON.parse(text.trim());
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();

function npm(args: string[], cwd = ROOT): RunResult {
  const cli = process.env.npm_execpath;
  const result = cli ? spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" }) : spawnSync("npm", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function installArtifact(): string {
  const staging = tempDir("e2e-install");
  const packed = npm(["pack", "--json", "--pack-destination", staging]);
  assert.equal(packed.status, 0, packed.stderr);
  const tarball = join(staging, JSON.parse(packed.stdout)[0].filename);
  const prefix = join(staging, "prefix");
  const installed = npm(["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball], staging);
  assert.equal(installed.status, 0, installed.stderr);
  return join(prefix, "bin", "grove");
}

function artifactRunner(fx: Fixture, executable = BUNDLE) {
  return (args: string[], cwd = fx.root): RunResult => {
    const result = executable === BUNDLE
      ? spawnSync(process.execPath, [BUNDLE, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored" } })
      : spawnSync(executable, args, { cwd, encoding: "utf8", env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored" } });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

function goldenJourney(options: { jsonMode: boolean; installed: boolean }): {
  steps: number;
  jsonValues: number;
  finalGrovePresent: boolean;
  homeGrovePresent: boolean;
} {
  const fx = makeFixture({ repos: { ledger: ["release/2026.08"], reporting: [] } });
  const invoke = artifactRunner(fx, options.installed ? installArtifact() : BUNDLE);
  let steps = 0;
  let jsonValues = 0;
  const step = (args: string[], expected = 0): any => {
    steps++;
    const actual = options.jsonMode ? ["--json", ...args] : args;
    const result = invoke(actual);
    assert.equal(result.status, expected, `grove ${actual.join(" ")}: ${result.stderr || result.stdout}`);
    if (options.jsonMode) {
      assert.equal(result.stdout.trim().split("\n").length, 1);
      jsonValues++;
      return json(result.stdout);
    }
    if (!(args[0] === "agent" && args[1] === "run")) assert.notEqual(result.stdout.trim(), "");
    return result.stdout;
  };
  const observe = (args: string[]): any => {
    const result = invoke(["--json", ...args]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return json(result.stdout);
  };

  step(["init"]);
  for (const repo of fx.repos) {
    const added = options.jsonMode ? step(["repo", "add", repo.origin, "--name", repo.name]) : (step(["repo", "add", repo.origin, "--name", repo.name]), observe(["repo", "status", repo.name]));
    const detail = options.jsonMode ? added.targets[0].after : added.detail.repositories[0];
    const anchor = join(fx.root, "repos", repo.name);
    assert.equal(git(anchor, ["rev-parse", "--is-bare-repository"]), "true");
    assert.equal(detail.commonGitDir, anchor);
  }
  step(["trunk", "add", "ledger", "release/2026.08"]);
  step(["new", "pricing-fix", "--repo", "ledger", "--repo", "reporting", "--branch", "ledger=feature/pricing", "--branch", "reporting=feature/quote-api", "--from", "ledger=main", "--from", "reporting=main"]);

  const treeList = observe(["tree", "ls", "pricing-fix"]);
  assert.equal(treeList.targets.length, 2);
  const config = observe(["config", "get"]);
  const aliases = new Map(config.repositories.map((repo: any) => [repo.id, repo.name]));
  const trees = treeList.targets.map((target: any) => ({ repository: aliases.get(target.selector.repositoryId), tree: target.selector.tree, path: target.after.path.value, branch: target.after.branch.value.replace(/^refs\/heads\//, "") }));
  assert.deepEqual(new Set(trees.map((tree: any) => tree.repository)), new Set(["ledger", "reporting"]));
  for (const tree of trees) {
    git(tree.path, ["config", "user.email", "e2e@grove.test"]);
    git(tree.path, ["config", "user.name", "E2E"]);
    writeFileSync(join(tree.path, `${tree.repository}.txt`), `${tree.repository}\n`);
    git(tree.path, ["add", "-A"]); git(tree.path, ["commit", "-qm", `change ${tree.repository}`]);
  }

  for (const command of ["changes", "commits", "against-trunk"]) {
    const report = options.jsonMode ? step([command, "pricing-fix"]) : (step([command, "pricing-fix"]), observe([command, "pricing-fix"]));
    assert.equal(report.targets.length, 2);
    assert.ok(report.targets.every((target: any) => target.reason === null));
  }
  const ledger = trees.find((tree: any) => tree.repository === "ledger");
  step(["agent", "add", "fake", process.execPath, "--arg", FAKE_AGENT_PATH, "--arg", "err:working|exit:0"]);
  step(["agent", "run", "pricing-fix", "--tree", ledger.tree, "--agent", "fake"]);

  const upstream = tempDir("e2e-upstream");
  git(dirname(upstream), ["clone", "-q", fx.repos[0]!.origin, upstream]);
  git(upstream, ["config", "user.email", "upstream@grove.test"]); git(upstream, ["config", "user.name", "Upstream"]);
  git(upstream, ["checkout", "-q", "release/2026.08"]); writeFileSync(join(upstream, "release.txt"), "next\n");
  git(upstream, ["add", "-A"]); git(upstream, ["commit", "-qm", "advance release"]); git(upstream, ["push", "-q", "origin", "release/2026.08"]);
  step(["trunk", "sync", "ledger", "--trunk", "release/2026.08"]);

  const refsBefore = new Map(["ledger", "reporting"].map((repo) => [repo, git(join(fx.root, "repos", repo), ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"])]));
  step(["archive", "pricing-fix", "--allow-unpushed"]);
  assert.equal(existsSync(join(fx.root, "archives", "pricing-fix")), true);
  step(["restore", "pricing-fix"]);
  step(["delete", "pricing-fix"]);
  assert.equal(existsSync(join(fx.root, "groves", "pricing-fix")), false);
  for (const repo of ["ledger", "reporting"]) assert.equal(git(join(fx.root, "repos", repo), ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"]), refsBefore.get(repo));
  assert.equal(existsSync(join(fx.home, ".grove")), false);
  return {
    steps,
    jsonValues,
    finalGrovePresent: existsSync(join(fx.root, "groves", "pricing-fix")),
    homeGrovePresent: existsSync(join(fx.home, ".grove")),
  };
}

test("E2E-01: the human built-artifact journey completes the Git-native lifecycle", () => {
  const outcome = goldenJourney({ jsonMode: false, installed: false });
  // ASSERT:E2E-01:EVERY-STEP-EXITS-0-REFUSES-EXACTLY-WHERE-8
  assert.deepEqual(
    { completedSteps: outcome.steps > 0, finalGrovePresent: outcome.finalGrovePresent, homeGrovePresent: outcome.homeGrovePresent },
    { completedSteps: true, finalGrovePresent: false, homeGrovePresent: false },
  );
});
test("E2E-02: the isolated globally installed artifact completes the same lifecycle", () => {
  // ASSERT:E2E-02:IDENTICAL-RESULTS
  goldenJourney({ jsonMode: false, installed: true });
});
test("E2E-03: every JSON-mode lifecycle step emits one result value", () => {
  const outcome = goldenJourney({ jsonMode: true, installed: false });
  // ASSERT:E2E-03:EACH-STDOUT-ONE-VALID-JSON-VALUE-FAKE-AGENT
  assert.deepEqual(
    { emittedOneJsonPerStep: outcome.jsonValues, drivenSteps: outcome.steps },
    { emittedOneJsonPerStep: outcome.steps, drivenSteps: outcome.steps },
  );
});

test("E2E-04: force discards dirty files but retains the exact branch OID", () => {
  const fx = makeFixture();
  const run = artifactRunner(fx);
  const ok = (args: string[]): any => { const result = run(["--json", ...args]); assert.equal(result.status, 0, result.stderr || result.stdout); return json(result.stdout); };
  ok(["init"]); ok(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]); const created = ok(["new", "dirty", "--repo", "alpha"]);
  const path = created.targets[0].after.path;
  const oid = git(join(fx.root, "repos", "alpha"), ["rev-parse", "refs/heads/dirty"]);
  writeFileSync(join(path, "wip.txt"), "uncommitted\n");
  const refused = run(["--json", "archive", "dirty", "--allow-unpushed"]);
  assert.equal(refused.status, 5); assert.match(json(refused.stdout).error.why, /dirty/); assert.equal(existsSync(join(path, "wip.txt")), true);
  const forced = ok(["archive", "dirty", "--allow-destructive-all", "--allow-unpushed"]);
  const cleanCreated = ok(["new", "clean", "--repo", "alpha"]);
  const cleanPath = cleanCreated.targets[0].after.path;
  git(cleanPath, ["config", "user.email", "e2e@grove.test"]);
  git(cleanPath, ["config", "user.name", "E2E Test"]);
  writeFileSync(join(cleanPath, "committed.txt"), "committed\n");
  git(cleanPath, ["add", "committed.txt"]);
  git(cleanPath, ["commit", "-qm", "committed work"]);
  const cleanOid = git(join(fx.root, "repos", "alpha"), ["rev-parse", "refs/heads/clean"]);
  const cleanArchive = ok(["archive", "clean", "--allow-unpushed"]);
  // ASSERT:E2E-04:DIRTY-ARCHIVE-FIRST-REFUSES-ITEMIZES-WORK-FORCED-ARCHIVE
  assert.deepEqual(
    {
      refusedStatus: refused.status,
      refusedNamesDirtyWork: /dirty/.test(json(refused.stdout).error.why),
      forcedStatus: forced.outcome,
      forcedDiscardedWork: forced.targets[0].after.discardedWork,
      forcedRetainedOid: git(join(fx.root, "repos", "alpha"), ["rev-parse", "refs/heads/dirty"]),
      cleanStatus: cleanArchive.outcome,
      cleanDiscardedWork: cleanArchive.targets[0].after.discardedWork,
      cleanRefsRetained: cleanArchive.targets[0].after.refsRetained,
      cleanRetainedOid: git(join(fx.root, "repos", "alpha"), ["rev-parse", "refs/heads/clean"]),
    },
    {
      refusedStatus: 5,
      refusedNamesDirtyWork: true,
      forcedStatus: "complete",
      forcedDiscardedWork: [{
        repositoryId: forced.targets[0].after.discardedWork[0].repositoryId,
        repositoryAlias: "alpha",
        tree: "dirty@alpha",
        changes: [{ status: "??", path: "wip.txt" }],
      }],
      forcedRetainedOid: oid,
      cleanStatus: "complete",
      cleanDiscardedWork: [],
      cleanRefsRetained: true,
      cleanRetainedOid: cleanOid,
    },
  );
});
