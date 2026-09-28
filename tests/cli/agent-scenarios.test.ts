import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { FAKE_AGENT_PATH } from "../testkit/fake-agent.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (source: string) => JSON.parse(source.trim());

function setup() {
  const fx = makeFixture({ repos: { alpha: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const created = fx.grove(["--json", "new", "work", "--repo", "alpha"]);
  assert.equal(created.status, 0, created.stderr);
  const target = json(created.stdout).targets[0] as { selector: { tree: string }; after: { path: string } };
  const worktree = target.after.path;
  const manifest = join(fx.root, ".grove", "groves", "work.json");
  return { fx, tree: target.selector.tree, worktree, manifest };
}

function addFake(fx: ReturnType<typeof makeFixture>, name: string, marker: string, exit = 0) {
  const result = fx.grove(["agent", "add", name, process.execPath, "--arg", FAKE_AGENT_PATH, "--arg", `out:${marker}|exit:${exit}`]);
  assert.equal(result.status, 0, result.stderr);
}

test("AGENT-01: agent ls reports a configured command absent from PATH as unavailable and exits zero", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["agent", "add", "missing", "grove-definitely-absent-agent-command"]).status, 0);
  const result = fx.grove(["--json", "agent", "ls"]);
  const missing = json(result.stdout).agents.find((agent: { name: string }) => agent.name === "missing");
  // ASSERT:AGENT-01:LISTS-AVAILABILITY-FALSE-EXITS-0
  assert.deepEqual(
    { status: result.status, missing },
    { status: 0, missing: { name: "missing", command: "grove-definitely-absent-agent-command", args: [], available: false } },
    result.stderr,
  );
});

test("AGENT-02: agent add rejects invalid names and commands without changing workspace config", () => {
  const { fx } = setup();
  const configPath = join(fx.root, ".grove", "config.json");
  const before = readFileSync(configPath, "utf8");
  for (const args of [
    ["agent", "add", "bad\u001bname", process.execPath],
    ["agent", "add", "bad-command", ""],
    ["agent", "add", "bad-command", "bad\ncommand"],
  ]) {
    const result = fx.grove(args);
    // ASSERT:AGENT-02:EXITS-2-MATERIAL-CLAUSE-1
    assert.equal(result.status, 2, `${JSON.stringify(args)}: ${result.stderr}`);
    // ASSERT:AGENT-02:WORKSPACE-CONFIG-IS-UNCHANGED-2
    assert.equal(readFileSync(configPath, "utf8"), before);
  }
});

test("AGENT-03: removing an unknown agent gives a precise error and preserves config", () => {
  const { fx } = setup();
  const configPath = join(fx.root, ".grove", "config.json");
  const before = readFileSync(configPath, "utf8");
  const result = fx.grove(["--json", "agent", "remove", "unknown"]);
  // ASSERT:AGENT-03:PRECISE-ERROR-MATERIAL-CLAUSE-1
  assert.equal(result.status, 2, result.stdout);
  // ASSERT:AGENT-03:CONFIG-UNCHANGED-MATERIAL-CLAUSE-2
  assert.match(json(result.stdout).error.what, /No agent "unknown"/);
  assert.match(json(result.stdout).error.remedy, /agent ls/);
  assert.equal(readFileSync(configPath, "utf8"), before);
});

test("AGENT-04: flag, Tree, Grove, and workspace defaults resolve in the documented precedence", () => {
  const { fx, tree } = setup();
  for (const [name, marker] of [["workspace", "WORKSPACE"], ["grove", "GROVE"], ["tree", "TREE"], ["flag", "FLAG"]] as const) addFake(fx, name, marker);
  assert.equal(fx.grove(["config", "set", "--values", '{"defaults":{"agent":"workspace"}}']).status, 0);
  assert.equal(fx.grove(["configure", "work", "--default-agent", "grove"]).status, 0);
  assert.equal(fx.grove(["tree", "configure", "work", tree, "--default-agent", "tree"]).status, 0);

  const explicit = fx.grove(["agent", "run", "work", "--agent", "flag"]);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stdout, /FLAG/);
  assert.doesNotMatch(explicit.stdout, /TREE|GROVE|WORKSPACE/);

  const treeDefault = fx.grove(["agent", "run", "work"]);
  assert.equal(treeDefault.status, 0, treeDefault.stderr);
  assert.match(treeDefault.stdout, /TREE/);

  assert.equal(fx.grove(["tree", "configure", "work", tree, "--clear-default-agent"]).status, 0);
  const groveDefault = fx.grove(["agent", "run", "work"]);
  assert.equal(groveDefault.status, 0, groveDefault.stderr);
  assert.match(groveDefault.stdout, /GROVE/);

  assert.equal(fx.grove(["configure", "work", "--clear-default-agent"]).status, 0);
  const workspaceDefault = fx.grove(["agent", "run", "work"]);
  assert.equal(workspaceDefault.status, 0, workspaceDefault.stderr);
  // ASSERT:AGENT-04:8-8-PRECEDENCE-FLAG-TREE-GROVE-WORKSPACE-DEFAULT
  assert.match(workspaceDefault.stdout, /WORKSPACE/);
});

test("AGENT-05: agent run propagates the fake agent's exit code 7", () => {
  const { fx } = setup();
  addFake(fx, "seven", "SEVEN", 7);
  const result = fx.grove(["agent", "run", "work", "--agent", "seven"]);
  assert.equal(result.status, 7);
  // ASSERT:AGENT-05:GROVE-AGENT-RUN-EXITS-7
  assert.match(result.stdout, /SEVEN/);
});

test("AGENT-06: agent run refuses before spawning when no agent resolves or the selected executable is missing", () => {
  const { fx } = setup();
  const none = fx.grove(["--json", "agent", "run", "work"]);
  assert.equal(none.status, 5, none.stdout);
  assert.match(json(none.stdout).error.what, /No agent to run/);

  assert.equal(fx.grove(["agent", "add", "missing", "grove-definitely-absent-agent-command"]).status, 0);
  const missing = fx.grove(["--json", "agent", "run", "work", "--agent", "missing"]);
  assert.equal(missing.status, 5, missing.stdout);
  assert.match(json(missing.stdout).error.what, /unavailable/);
  // ASSERT:AGENT-06:REFUSES-BEFORE-SPAWNING-ANYTHING
  assert.match(json(missing.stdout).error.why, /absent from PATH/);
});

test("AGENT-07: agent run without a Grove outside every managed Tree refuses with the explicit-scope remedy", () => {
  const { fx } = setup();
  addFake(fx, "fake", "SHOULD_NOT_RUN");
  const result = fx.grove(["--json", "agent", "run", "--agent", "fake"], { cwd: fx.root });
  assert.equal(result.status, 5, result.stdout);
  const error = json(result.stdout).error;
  assert.match(error.what, /Not inside a Grove Tree/);
  assert.match(error.remedy, /inside a Tree|pass <grove>/);
  // ASSERT:AGENT-07:REFUSES-PRECISE-REMEDY
  assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/);
});

test("AGENT-08: working-dir refuses parent, absolute, and symlink escapes without config change; the child remains contained", () => {
  const { fx, tree, worktree, manifest } = setup();
  const outside = tempDir("agent-outside");
  symlinkSync(outside, join(worktree, "escape"));
  const before = existsSync(manifest) ? readFileSync(manifest, "utf8") : null;
  for (const candidate of ["..", outside, "escape"]) {
    const result = fx.grove(["tree", "configure", "work", tree, "--working-dir", candidate]);
    // ASSERT:AGENT-08:EXITS-2-MATERIAL-CLAUSE-1
    assert.equal(result.status, 2, `${candidate}: ${result.stderr}`);
    // ASSERT:AGENT-08:CONFIG-UNCHANGED-MATERIAL-CLAUSE-2
    assert.equal(existsSync(manifest) ? readFileSync(manifest, "utf8") : null, before);
  }

  const inside = join(worktree, "inside");
  mkdirSync(inside);
  const record = join(tempDir("agent-cwd"), "cwd.txt");
  const script = join(tempDir("agent-cwd-script"), "agent.mjs");
  writeFileSync(script, `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], process.cwd() + "\\n");\n`);
  // ASSERT:AGENT-08:AGENT-RUN-NEVER-RECEIVES-AN-OUTSIDE-CWD-3
  assert.equal(fx.grove(["agent", "add", "cwd", process.execPath, "--arg", script, "--arg", record]).status, 0);
  assert.equal(fx.grove(["tree", "configure", "work", tree, "--working-dir", "inside"]).status, 0);
  const run = fx.grove(["agent", "run", "work", "--agent", "cwd"]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(record, "utf8").trim(), inside);
});

test("AGENT-09: agent run appends every token after -- verbatim after the definition args", () => {
  const { fx } = setup();
  const record = join(tempDir("agent-argv"), "argv.json");
  const script = join(tempDir("agent-argv-script"), "agent.mjs");
  writeFileSync(script, `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\n`);
  assert.equal(fx.grove(["agent", "add", "argv", process.execPath, "--arg", script, "--arg", record, "--arg", "definition"]).status, 0);
  const result = fx.grove(["agent", "run", "work", "--agent", "argv", "--", "--flag", "value", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  // ASSERT:AGENT-09:EVERYTHING-AFTER-REACHES-CHILD-ARGV-VERBATIM-AFTER-DEFINITION
  assert.deepEqual(json(readFileSync(record, "utf8")), ["definition", "--flag", "value", "--json"]);
});

test("AGENT-10: agent add updates an existing definition in place under CAS and agent ls shows the replacement", () => {
  const { fx } = setup();
  const first = fx.grove(["agent", "add", "replace", process.execPath, "--arg", "one"]);
  assert.equal(first.status, 0, first.stderr);
  const before = json(fx.grove(["--json", "config", "get"]).stdout)._rev;
  const replaced = fx.grove(["--json", "agent", "add", "replace", process.execPath, "--arg", "two"]);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.deepEqual(json(replaced.stdout).replaced, { command: process.execPath, args: ["one"] });
  const config = json(fx.grove(["--json", "config", "get"]).stdout);
  assert.deepEqual(config.agents.replace, { command: process.execPath, args: ["two"] });
  const listed = json(fx.grove(["--json", "agent", "ls"]).stdout).agents.filter((agent: { name: string }) => agent.name === "replace");
  // ASSERT:AGENT-10:UPDATES-DEFINITION-PLACE-UNDER-CAS-AGENT-LS-SHOWS
  assert.deepEqual(
    { revision: config._rev, listed },
    { revision: before + 1, listed: [{ name: "replace", command: process.execPath, args: ["two"], available: true }] },
  );
});
