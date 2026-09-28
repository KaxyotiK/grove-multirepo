/** Regression witnesses retained from the historical audit, expressed against schema 3. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initV2Workspace, makeFixture, managedTrunkPath } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { createGitGate } from "../testkit/git-gate.ts";

after(cleanupTempDirs);
const json = (s: string) => JSON.parse(s.trim());
const ESC = String.fromCharCode(0x1b);
const RLO = String.fromCodePoint(0x202e);

function setup() {
  const fx = makeFixture();
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  return { fx, checkout: managedTrunkPath(fx, "alpha") };
}

function refExists(checkout: string, ref: string): boolean {
  try {
    execFileSync("git", ["-C", checkout, "show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

test("V3DIAG-01/003-git-native-grove-SC-005: doctor reports stable policy diagnostics without mutating Git", () => {
  const fx = makeFixture();
  initV2Workspace(fx);
  const run = fx.grove(["--json", "doctor"]);
  assert.equal(run.status, 0, run.stderr);
  const result = json(run.stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.command, "doctor");
  assert.equal(result.outcome, "complete");
  assert.ok(Array.isArray(result.diagnostics));
});

test("doctor --strict exits 3 for a nonconforming native branch", () => {
  const fx = makeFixture();
  initV2Workspace(fx);
  const primary = managedTrunkPath(fx, "alpha");
  const tree = join(fx.root, "groves", "demo", "trees", "demo@alpha");
  mkdirSync(join(fx.root, "groves", "demo", "trees"), { recursive: true });
  execFileSync("git", ["branch", "other"], { cwd: primary });
  execFileSync("git", ["worktree", "add", "-q", tree, "other"], { cwd: primary });
  const run = fx.grove(["--json", "doctor", "--grove", "demo", "--strict"]);
  assert.equal(run.status, 3, run.stderr);
  assert.ok(json(run.stdout).diagnostics.some((diagnostic: { code: string }) => diagnostic.code === "nonconforming-branch"));
});

test("fix --move previews, rescans, and applies one exact native worktree move", () => {
  const fx = makeFixture();
  initV2Workspace(fx);
  const primary = managedTrunkPath(fx, "alpha");
  const expected = join(fx.root, "groves", "demo", "trees", "demo@alpha");
  const moved = join(fx.root, "misplaced-alpha");
  mkdirSync(join(fx.root, "groves", "demo", "trees"), { recursive: true });
  execFileSync("git", ["branch", "demo"], { cwd: primary });
  execFileSync("git", ["worktree", "add", "-q", expected, "demo"], { cwd: primary });
  execFileSync("git", ["worktree", "move", expected, moved], { cwd: primary });
  const diagnostic = json(fx.grove(["--json", "doctor", "--grove", "demo"]).stdout).diagnostics.find((entry: { code: string }) => entry.code === "misplaced");
  assert.ok(diagnostic);
  const preview = fx.grove(["--json", "fix", "--move", "--diagnostic", diagnostic.id, "--dry-run"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(existsSync(moved), true);
  const applied = fx.grove(["--json", "fix", "--move", "--diagnostic", diagnostic.id]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(join(expected, ".git")), true);
  assert.equal(existsSync(moved), false);
  assert.equal(fx.grove(["fix", "--move", "--diagnostic", diagnostic.id]).status, 4, "the stale plan is refused");
});

test("FR-023: fix --move reports a native move failure as git-failed", () => {
  const fx = makeFixture();
  initV2Workspace(fx);
  const primary = managedTrunkPath(fx, "alpha");
  const expected = join(fx.root, "groves", "demo", "trees", "demo@alpha");
  const moved = join(fx.root, "misplaced-alpha");
  mkdirSync(join(fx.root, "groves", "demo", "trees"), { recursive: true });
  execFileSync("git", ["branch", "demo"], { cwd: primary });
  execFileSync("git", ["worktree", "add", "-q", expected, "demo"], { cwd: primary });
  execFileSync("git", ["worktree", "move", expected, moved], { cwd: primary });
  const diagnostic = json(fx.grove(["--json", "doctor", "--grove", "demo"]).stdout).diagnostics.find((entry: { code: string }) => entry.code === "misplaced");
  assert.ok(diagnostic);
  const gate = createGitGate(["worktree", "move", "--", moved, expected], { failExitCode: 42 });
  let applied;
  try { applied = fx.grove(["--json", "fix", "--move", "--diagnostic", diagnostic.id], { env: gate.env }); }
  finally { gate.dispose(); }
  const result = json(applied.stdout);
  assert.deepEqual(
    { status: applied.status, outcome: result.outcome, reasons: result.targets.map((target: any) => target.reason), sourceSurvives: existsSync(moved) },
    { status: 6, outcome: "partial", reasons: ["git-failed"], sourceSurvives: true },
  );
});

test("removed repo delete-branch surface never changes refs", () => {
  const { fx, checkout } = setup();
  execFileSync("git", ["-C", checkout, "branch", "local-only", "main"]);
  const refused = fx.grove(["repo", "delete-branch", "alpha", "local-only"]);
  assert.equal(refused.status, 2);
  assert.ok(refExists(checkout, "refs/heads/local-only"));
});

test("commits --limit rejects non-positive and non-integer values", () => {
  const { fx } = setup();
  fx.grove(["new", "work", "--repo", "alpha"]);
  for (const limit of ["abc", "-5", "0"]) assert.equal(fx.grove(["commits", "work", "--limit", limit]).status, 2);
});

test("config set rejects wrong shapes and invalid names but accepts a valid name", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["config", "set", "--values", '{"defaults":[]}']).status, 2);
  assert.equal(fx.grove(["config", "set", "--values", '{"agents":[1,2]}']).status, 2);
  for (const name of ["", "-x", "a/b"]) assert.equal(fx.grove(["config", "set", "--values", JSON.stringify({ name })]).status, 2);
  assert.equal(fx.grove(["config", "set", "--values", '{"name":"renamed-ws"}']).status, 0);
});

test("INIT-08: init into a read-only parent fails with io exit 7", () => {
  if (process.getuid?.() === 0) return;
  const fx = makeFixture({ repos: {} });
  const ro = join(fx.root, "readonly");
  mkdirSync(ro, { recursive: true });
  chmodSync(ro, 0o555);
  try {
    const child = join(ro, "child");
    const result = fx.grove(["init", child]);
    // ASSERT:INIT-08:FAILS-WITHOUT-PUBLISHING-MARKER
    assert.deepEqual(
      { status: result.status, markerPublished: existsSync(join(child, ".grove", "config.json")) },
      { status: 7, markerPublished: false },
    );
  } finally {
    chmodSync(ro, 0o755);
  }
});

test("file ls escapes control bytes in untrusted filenames", () => {
  const { fx } = setup();
  writeFileSync(join(fx.root, `a${ESC}b.txt`), "");
  const run = fx.grove(["file", "ls"]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!run.stdout.includes(ESC));
  assert.ok(run.stdout.includes("\\x1b"));
});

test("agent add rejects a bidi-override character in the name", () => {
  const { fx } = setup();
  const run = fx.grove(["--json", "agent", "add", `ai${RLO}`, "echo"]);
  assert.equal(run.status, 2);
  assert.match(json(run.stdout).error.what, /control character/);
});

test("agent ls escapes a crafted stored control character", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["agent", "add", "helper", "echo"]).status, 0);
  const configPath = join(fx.root, ".grove", "config.json");
  const config = json(readFileSync(configPath, "utf8"));
  config.agents[`ev${ESC}il`] = config.agents.helper;
  delete config.agents.helper;
  writeFileSync(configPath, JSON.stringify(config));
  const run = fx.grove(["agent", "ls"]);
  assert.ok(!run.stdout.includes(ESC));
  assert.ok(run.stdout.includes("\\x1b"));
});

/**
 * `agent add` rejected control and bidi-override characters on write, but `config set` writes the
 * same `agents` and `defaults` keys and bypassed that check entirely - so a crafted value reached
 * the COMMITTED, shared `.grove/config.json` and then the terminal unescaped, which is the exact
 * Trojan-Source travel path src/commands/agent.ts documents defending against. The rule now lives
 * in the validator, the one choke point every writer passes through.
 */
test("V3CFG-05: config set cannot smuggle control characters past the agent-definition defense", () => {
  const { fx } = setup();
  const esc = "\u001b[31mPWNED\u001b[0m";
  const bidi = "run\u202eexe.txt";
  assert.deepEqual(
    {
      defaultAgent: fx.grove(["config", "set", "--values", JSON.stringify({ defaults: { agent: esc } })]).status,
      branchPrefix: fx.grove(["config", "set", "--values", JSON.stringify({ defaults: { branchPrefix: bidi } })]).status,
      agentName: fx.grove(["config", "set", "--values", JSON.stringify({ agents: { [esc]: { command: "true", args: [] } } })]).status,
      agentCommand: fx.grove(["config", "set", "--values", JSON.stringify({ agents: { review: { command: esc, args: [] } } })]).status,
      agentArg: fx.grove(["config", "set", "--values", JSON.stringify({ agents: { review: { command: "true", args: [bidi] } } })]).status,
      cleanValueStillAccepted: fx.grove(["config", "set", "--values", JSON.stringify({ agents: { review: { command: "true", args: ["--x"] } } })]).status,
    },
    { defaultAgent: 2, branchPrefix: 2, agentName: 2, agentCommand: 2, agentArg: 2, cleanValueStillAccepted: 0 },
  );
});
