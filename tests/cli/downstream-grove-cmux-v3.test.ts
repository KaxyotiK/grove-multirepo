/**
 * The Grove interfaces the grove-cmux wrapper (npm grove-multirepo-cmux) depends on, pinned so a
 * Grove change that would break it fails here, in the normal gate, instead of in its live VM
 * suite. Contract: cli-surface-v3.md "Downstream interface: grove-cmux".
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";

after(cleanupTempDirs);

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The harness's setup sequence: init by path, then repo add and new --all through --workspace. */
function seeded(): { fx: Fixture; tree: string } {
  const fx = makeFixture();
  const init = fx.grove(["init", fx.root, "--name", "work"], { cwd: dirname(fx.root) });
  assert.equal(init.status, 0, init.stderr);
  const added = fx.grove(["--workspace", fx.root, "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { cwd: dirname(fx.root) });
  assert.equal(added.status, 0, added.stderr);
  const created = fx.grove(["--workspace", fx.root, "new", "g", "--all"], { cwd: dirname(fx.root) });
  assert.equal(created.status, 0, created.stderr);
  return { fx, tree: join(fx.root, "groves", "g", "trees", "g@alpha") };
}

test("V3DWN-01: grove --json new prints one schema-1 value with outcome complete and the Tree path the wrapper derives the Grove root from", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  for (const [name, selection] of [["spaced", ["--repo", "alpha"]], ["joined", ["--repo=alpha"]]] as const) {
    const run = fx.grove(["--json", "new", name, ...selection]);
    assert.equal(run.status, 0, run.stderr);
    const value = JSON.parse(run.stdout);
    assert.equal(typeof value.schemaVersion, "number");
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.outcome, "complete");
    const target = (value.targets as { selector?: { path?: unknown; tree?: unknown } }[]).find((entry) => typeof entry.selector?.path === "string");
    assert.ok(target, "a target carries selector.path");
    assert.equal(target.selector!.tree, `${name}@alpha`);
    assert.equal(dirname(dirname(String(target.selector!.path))), join(fx.root, "groves", name));
  }
});

test("V3DWN-02: grove --json agent ls reports a top-level agents array with name and a boolean available", () => {
  const { fx, tree } = seeded();
  assert.equal(fx.grove(["agent", "add", "fake", process.execPath]).status, 0);
  const run = fx.grove(["--json", "agent", "ls"], { cwd: tree });
  assert.equal(run.status, 0, run.stderr);
  const agents = JSON.parse(run.stdout).agents as { name: unknown; available: unknown }[];
  assert.ok(Array.isArray(agents));
  const fake = agents.find((agent) => agent.name === "fake");
  assert.ok(fake, "the added agent is listed by name");
  assert.equal(fake.available, true);
});

test("V3DWN-03: grove agent run <grove> --tree <grove>@<repo> runs in the foreground in that Tree and forwards arguments verbatim", () => {
  const { fx, tree } = seeded();
  const record = join(fx.home, "agent-run.json");
  const script = join(fx.home, "record-agent.cjs");
  writeFileSync(script, `require("node:fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })); process.exit(3);\n`);
  assert.equal(fx.grove(["agent", "add", "recorder", process.execPath, "--arg", script]).status, 0);
  const run = fx.grove(["agent", "run", "g", "--tree", "g@alpha", "--agent", "recorder", "--", "task", "two words", "--flag"]);
  assert.equal(run.status, 3, "the agent's exit status passes through");
  const seen = JSON.parse(readFileSync(record, "utf8")) as { argv: string[]; cwd: string };
  assert.deepEqual(seen.argv, ["task", "two words", "--flag"]);
  assert.equal(realpathSync(seen.cwd), realpathSync(tree));
});

test("V3DWN-04: the default layout puts each Tree at groves/<grove>/trees/<grove>@<repo> as its own worktree, and an archived Grove at archives/<grove>", () => {
  const { fx, tree } = seeded();
  assert.equal(realpathSync(git(tree, ["rev-parse", "--show-toplevel"])), realpathSync(tree));
  assert.equal(fx.grove(["archive", "g"]).status, 0);
  assert.equal(existsSync(join(fx.root, "archives", "g")), true);
  assert.equal(existsSync(tree), false);
});

test("V3DWN-05: init by path, repo add through --workspace with the remote HEAD as trunk, and new --all through --workspace build the harness fixture", () => {
  const { fx, tree } = seeded();
  assert.equal(existsSync(join(fx.root, "trunks", "main@alpha", ".git")), true);
  assert.equal(git(tree, ["branch", "--show-current"]), "g");
});

test("V3DWN-06: grove agent add <name> <command> is shown by human grove agent ls as a Name: line", () => {
  const { fx } = seeded();
  assert.equal(fx.grove(["agent", "add", "fake", process.execPath]).status, 0);
  const run = fx.grove(["agent", "ls"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^\s*Name: fake$/m);
});

test("V3DWN-07: plain grove delete refuses with exit 5 while .grove-cmux/ exists in the Grove root, and only --allow-destructive-all removes it", () => {
  const { fx } = seeded();
  const projection = join(fx.root, "groves", "g", ".grove-cmux");
  mkdirSync(projection, { recursive: true });
  writeFileSync(join(projection, "projection.json"), "{}\n");
  const withFile = fx.grove(["delete", "g"]);
  assert.equal(withFile.status, 5, withFile.stdout + withFile.stderr);
  assert.match(withFile.stdout + withFile.stderr, /refused-precondition/);
  assert.match(withFile.stdout + withFile.stderr, /\.grove-cmux\/projection\.json/);
  rmSync(join(projection, "projection.json"));
  const emptyDirectory = fx.grove(["delete", "g"]);
  assert.equal(emptyDirectory.status, 5, emptyDirectory.stdout + emptyDirectory.stderr);
  assert.match(emptyDirectory.stdout + emptyDirectory.stderr, /\.grove-cmux\//);
  const forced = fx.grove(["delete", "g", "--allow-destructive-all"]);
  assert.equal(forced.status, 0, forced.stdout + forced.stderr);
  assert.equal(existsSync(join(fx.root, "groves", "g")), false);
});
