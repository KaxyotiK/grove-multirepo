// Regression witnesses updated for Git-native discovery and schema-3 results.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, managedTrunkPath } from "../testkit/fixture.ts";
import { FAKE_AGENT_PATH } from "../testkit/fake-agent.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);
const json = (s: string) => JSON.parse(s.trim().split("\n").pop() as string);

function setup(extra: string[] = []) {
  const fx = makeFixture({ repos: { alpha: extra } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  return { fx, checkout: managedTrunkPath(fx, "alpha") };
}

test("commits reports the full multi-word subject", () => {
  const { fx } = setup();
  const created = json(fx.grove(["--json", "new", "work", "--repo", "alpha"]).stdout);
  const worktree = created.targets[0].after.path;
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: worktree });
  execFileSync("git", ["config", "user.name", "t"], { cwd: worktree });
  writeFileSync(join(worktree, "f.txt"), "x");
  execFileSync("git", ["add", "-A"], { cwd: worktree });
  execFileSync("git", ["commit", "-qm", "Fix the login bug now"], { cwd: worktree });
  const commit = json(fx.grove(["--json", "commits", "work"]).stdout).detail.trees[0].commits[0];
  assert.equal(commit.subject, "Fix the login bug now");
  assert.ok(!commit.hash.includes("\x00") && !commit.hash.includes(" "));
});

test("new refuses an occupied exact Tree target without clobbering it", () => {
  const { fx } = setup();
  const treePath = join(fx.root, "groves", "work", "trees", "work@alpha");
  mkdirSync(treePath, { recursive: true });
  writeFileSync(join(treePath, "user-notes.md"), "precious");
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 4);
  assert.equal(readFileSync(join(treePath, "user-notes.md"), "utf8"), "precious");
});

test("remote-only branch adoption creates the exact local ref and native worktree", () => {
  const { fx, checkout } = setup(["ro"]);
  assert.notEqual(execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/remotes/origin/ro"], { cwd: checkout }).length, -1);
  const created = fx.grove(["--json", "new", "remote", "--repo", "alpha", "--branch", "alpha=ro"]);
  assert.equal(created.status, 0, created.stderr);
  execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/ro"], { cwd: checkout });
  assert.equal(json(created.stdout).targets[0].after.branch, "ro");
});

test("agent run from inside a Tree resolves the Grove default agent", () => {
  const { fx } = setup();
  const created = json(fx.grove(["--json", "new", "work", "--repo", "alpha"]).stdout);
  const worktree = created.targets[0].after.path;
  fx.grove(["agent", "add", "echoer", process.execPath, "--arg", FAKE_AGENT_PATH, "--arg", "out:HELLO|exit:0"]);
  fx.grove(["configure", "work", "--default-agent", "echoer"]);
  const run = fx.grove(["agent", "run"], { cwd: worktree });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /HELLO/);
});

test("subcommand help is successful and --json without a command stays JSON", () => {
  const { fx } = setup();
  for (const command of [["repo", "add"], ["new"], ["agent", "run"], ["archive"]]) {
    const run = fx.grove([...command, "--help"]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(command.join(" ")));
  }
  const root = fx.grove(["--json"]);
  assert.equal(root.status, 0);
  assert.ok(Array.isArray(json(root.stdout).commands));
});

test("unknown JSON commands and unknown read flags use clean invalid-input errors", () => {
  const { fx } = setup();
  const unknown = fx.grove(["--json", "bogus-command"]);
  assert.equal(unknown.status, 2);
  assert.equal(json(unknown.stdout).error.exitCode, 2);
  for (const command of [["repo", "ls"], ["agent", "ls"], ["reconcile"], ["status"], ["config", "get"]]) {
    assert.equal(fx.grove([...command, "--bogus"]).status, 2);
    assert.equal(fx.grove([...command, "--json"]).status, 0, "a trailing global --json remains valid");
  }
});

test("a --help after -- reaches the agent child and dash option values remain explicit", () => {
  const { fx } = setup();
  fx.grove(["new", "work", "--repo", "alpha"]);
  fx.grove(["agent", "add", "fake", process.execPath, "--arg", FAKE_AGENT_PATH, "--arg", "err:ran|exit:5"]);
  assert.equal(fx.grove(["agent", "run", "work", "--agent", "fake", "--", "--help"]).status, 5);
  assert.equal(fx.grove(["agent", "add", "helpagent", "sometool", "--arg", "-h"]).status, 2);
  assert.equal(fx.grove(["agent", "add", "helpagent", "sometool", "--arg=-h"]).status, 0);
  const agent = json(fx.grove(["--json", "agent", "ls"]).stdout).agents.find((entry: { name: string }) => entry.name === "helpagent");
  assert.equal(agent.args[0], "-h");
});

test("repo link accepts any Git-resolvable path and anchors its common directory", () => {
  const { fx } = setup();
  const main = join(fx.root, "..", "mainrepo");
  execFileSync("git", ["init", "-q", main]);
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: main });
  execFileSync("git", ["config", "user.name", "t"], { cwd: main });
  execFileSync("git", ["commit", "--allow-empty", "-qm", "init"], { cwd: main });
  const worktree = join(fx.root, "..", "linked-worktree");
  execFileSync("git", ["worktree", "add", "-q", worktree, "-b", "feat"], { cwd: main });
  const linked = fx.grove(["--json", "repo", "link", worktree, "--name", "linked"]);
  assert.equal(linked.status, 0, `${linked.stderr}\n${linked.stdout}`);
  assert.equal(json(linked.stdout).detail.commonGitDir, join(main, ".git"));
});

test("configure no-op does not bump central metadata revision", () => {
  const { fx } = setup();
  fx.grove(["new", "w", "--repo", "alpha"]);
  assert.equal(fx.grove(["configure", "w", "--default-base", "main"]).status, 0);
  const metadata = join(fx.root, ".grove", "groves", "w.json");
  const before = JSON.parse(readFileSync(metadata, "utf8"))._rev;
  const noOp = json(fx.grove(["--json", "configure", "w"]).stdout);
  assert.equal(noOp.detail.changed, false);
  assert.equal(JSON.parse(readFileSync(metadata, "utf8"))._rev, before);
});

test("wrong-typed config changes are rejected without bricking the workspace", () => {
  const { fx } = setup();
  const refused = fx.grove(["--json", "config", "set", "--values", '{"name":123}']);
  assert.deepEqual(
    { status: refused.status, remedy: json(refused.stdout).error.remedy },
    {
      status: 2,
      remedy: "Provide settable values of the correct type (name: string; defaults, agents: object).",
    },
  );
  assert.equal(fx.grove(["status"]).status, 0);
  assert.equal(fx.grove(["config", "get"]).status, 0);
});

test("a corrupt central Grove record does not hide healthy native Groves", () => {
  const { fx } = setup();
  fx.grove(["new", "alpha-g", "--repo", "alpha"]);
  fx.grove(["configure", "alpha-g", "--default-base", "main"]);
  fx.grove(["new", "bravo-g", "--repo", "alpha", "--branch", "alpha=bravo-g", "--from", "alpha=main"]);
  writeFileSync(join(fx.root, ".grove", "groves", "alpha-g.json"), "x{");
  const listed = fx.grove(["--json", "ls"]);
  assert.match(listed.stdout, /bravo-g/);
  const reconciled = json(fx.grove(["--json", "reconcile", "--audit-only"]).stdout);
  assert.ok(reconciled.diagnostics.some((diagnostic: { code: string }) => diagnostic.code.includes("metadata")));
});

test("V3FSF-01: malformed operation steps are reported without crashing file, doctor, or recovery readers", () => {
  const { fx } = setup();
  const operations = join(fx.root, ".grove", "operations");
  mkdirSync(operations, { recursive: true });
  const anchor = join(fx.root, "recoverable-store");
  execFileSync("git", ["init", "--bare", anchor]);
  writeFileSync(join(operations, "X.json"), JSON.stringify({ version: 1, id: "X", kind: "repo-add", scope: {}, state: "planned", createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z", targetLocks: [], targets: [], anchor, steps: [null] }));
  writeFileSync(join(fx.root, "safe.txt"), "safe\n");
  const listed = fx.grove(["--json", "file", "ls", "."]);
  assert.equal(listed.status, 0, listed.stderr);
  const listing = json(listed.stdout);
  assert.ok(listing.detail.operationErrors.some((entry: { file: string }) => entry.file.endsWith("X.json")));
  assert.equal(listing.detail.entries.some((entry: { name: string }) => entry.name === "recoverable-store"), false);
  const protectedRead = fx.grove(["--json", "file", "read", "recoverable-store/config"]);
  assert.equal(protectedRead.status, 2, protectedRead.stdout);
  assert.notEqual(json(protectedRead.stdout).error.kind, "internal");
  const read = fx.grove(["--json", "file", "read", "safe.txt"]);
  assert.equal(read.status, 0, read.stderr);
  assert.ok(json(read.stdout).detail.operationErrors.some((entry: { file: string }) => entry.file.endsWith("X.json")));
  const doctor = fx.grove(["--json", "doctor"]);
  assert.notEqual(doctor.status, 1, doctor.stderr);
  const run = fx.grove(["--json", "reconcile"]);
  assert.notEqual(run.status, 1);
  assert.ok(json(run.stdout).detail.operationErrors.some((entry: { file: string }) => entry.file.endsWith("X.json")));
});

test("JSON agent run keeps stdout pure even when the child writes to stdout", () => {
  const { fx } = setup();
  fx.grove(["new", "work", "--repo", "alpha"]);
  fx.grove(["agent", "add", "noisy", process.execPath, "--arg", FAKE_AGENT_PATH, "--arg", "out:HELLO_STDOUT|exit:0"]);
  const run = fx.grove(["--json", "agent", "run", "work", "--agent", "noisy"]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(json(run.stdout).detail.exitCode, 0);
  assert.ok(!run.stdout.includes("HELLO_STDOUT"));
  assert.match(run.stderr, /HELLO_STDOUT/);
});

test("file errors and agent control characters stay classified and terminal-safe", () => {
  const { fx } = setup();
  const missing = fx.grove(["--json", "file", "read", "nonexistent.txt"]);
  assert.equal(missing.status, 7);
  assert.equal(json(missing.stdout).error.kind, "io");
  assert.equal(fx.grove(["agent", "add", "ev\u001b[2Kil", "/bin/true"]).status, 2);
  assert.equal(fx.grove(["agent", "add", "plain", "/bin/true"]).status, 0);
  assert.ok(!fx.grove(["agent", "ls"]).stdout.includes("\u001b"));
});

test("a Tree removed with native Git disappears from discovery without metadata repair", () => {
  const { fx, checkout } = setup();
  const created = json(fx.grove(["--json", "new", "work", "--repo", "alpha"]).stdout);
  const worktree = created.targets[0].after.path;
  execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: checkout }); // git's own flag, not Grove's
  const listed = json(fx.grove(["--json", "ls"]).stdout);
  assert.equal(listed.detail.groves.some((grove: { name: string }) => grove.name === "work"), false);
});
