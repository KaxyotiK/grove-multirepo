import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerAll } from "../../src/commands/index.ts";
import { all } from "../../src/commands/registry.ts";
import { workspaceConfig } from "../../src/paths/layout.ts";
import { makeFixture, type Fixture, type RunResult } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);
registerAll();

const json = (source: string) => JSON.parse(source.trim());

function initialized(repos: Record<string, string[]> = {}) {
  const fx = makeFixture({ repos });
  assert.equal(fx.grove(["init"]).status, 0);
  return fx;
}

function assertEnvelope(result: RunResult, code: number, label: string): Record<string, unknown> {
  assert.equal(result.status, code, `${label}: ${result.stderr || result.stdout}`);
  assert.equal(result.stderr, "", `${label}: structured errors must not leak prose to stderr`);
  assert.equal(result.stdout.trim().split("\n").length, 1, `${label}: stdout must contain one JSON value`);
  const error = json(result.stdout).error as Record<string, unknown>;
  assert.equal(error.exitCode, code, label);
  for (const field of ["kind", "what", "why", "remedy"]) assert.ok(error[field], `${label}: missing ${field}`);
  return error;
}

test("CMD-01: every command help renders its exact registered positionals and flags", () => {
  const fx = initialized();
  for (const command of all()) {
    const result = fx.grove([...command.path.split(" "), "--help"]);
    assert.equal(result.status, 0, `${command.path}: ${result.stderr}`);
    const usageBlock = result.stdout.match(/^Usage:\n((?:[ \t]{2,}.*\n?)+)/m)?.[1];
    assert.ok(usageBlock, `${command.path}: missing Usage block`);
    const renderedUsage = usageBlock.trim().split("\n").map((line) => line.trim()).join(" ");
    assert.equal(renderedUsage, `grove ${command.usage}`, `${command.path}: wrapped usage changed its exact syntax`);
    for (const arg of command.args ?? []) {
      assert.ok(result.stdout.includes(arg.name), `${command.path} help omits ${arg.name}`);
    }
    for (const option of Object.keys(command.options)) {
      // ASSERT:CMD-01:EXACT-DOCUMENTED-POSITIONALS-FLAGS-APPEAR
      assert.ok(result.stdout.includes(`--${option}`), `${command.path} help omits --${option}`);
    }
  }
});

test("CMD-02: every required positional and required command argument exits 2 with a remedy when omitted", () => {
  const fx = initialized();
  for (const command of all()) {
    for (let supplied = 0; supplied < command.positionals.min; supplied++) {
      const result = fx.grove(["--json", ...command.path.split(" "), ...Array(supplied).fill("placeholder")]);
      assertEnvelope(result, 2, `${command.path} with ${supplied} positionals`);
    }
  }
  for (const args of [["config", "set"], ["tree", "reorder", "placeholder"]]) {
    // ASSERT:CMD-02:EXITS-2-PRECISE-REMEDY
    assertEnvelope(fx.grove(["--json", ...args]), 2, args.join(" "));
  }
});

test("CMD-03: unknown and camel-case flags exit 2 before a mutating handler runs", () => {
  const fx = initialized();
  for (const flag of ["--bogus", "--Repo"]) {
    const result = fx.grove(["--json", "new", "must-not-exist", flag, "--all"]);
    const error = assertEnvelope(result, 2, flag);
    // ASSERT:CMD-03:EXITS-2-MATERIAL-CLAUSE-1
    assert.match(String(error.why), new RegExp(flag.replace("--", "--")));
    // ASSERT:CMD-03:NOTHING-REACHES-A-MUTATING-HANDLER-2
    assert.deepEqual(json(fx.grove(["--json", "ls"]).stdout).detail.groves, []);
    assert.deepEqual(readdirSync(join(fx.root, "groves")), []);
  }
});

test("CMD-04: repeated list flags use stable target order and validate every value before mutation", () => {
  const fx = initialized({ alpha: [], beta: [] });
  for (const repo of fx.repos) {
    assert.equal(fx.grove(["repo", "add", repo.origin, "--name", repo.name]).status, 0);
  }
  const created = fx.grove([
    "--json", "new", "ordered",
    "--repo", "beta", "--repo", "alpha",
    "--branch", "beta=feature/b", "--branch", "alpha=feature/a",
    "--from", "beta=main", "--from", "alpha=main",
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(json(created.stdout).targets.map((target: { after: { branch: string } }) => target.after.branch), ["feature/a", "feature/b"]);

  const invalid = fx.grove(["new", "invalid-list", "--repo", "alpha", "--repo", "missing"]);
  assert.equal(invalid.status, 2, invalid.stderr);
  // ASSERT:CMD-04:PRESERVES-ORDER-VALIDATES-EACH-VALUE
  assert.deepEqual(json(fx.grove(["--json", "ls"]).stdout).detail.groves.map((grove: { name: string }) => grove.name), ["ordered"]);
});

test("CMD-05: --json emits one pure value on success and every typed error class", () => {
  const fx = initialized({ alpha: [] });
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);

  const success = fx.grove(["--json", "status"]);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  assert.equal(success.stdout.trim().split("\n").length, 1);
  json(success.stdout);

  assertEnvelope(fx.grove(["--json", "unknown-command"]), 2, "invalid-input");
  assertEnvelope(fx.grove(["--json", "config", "set", "--values", '{"repositories":[]}']), 3, "refused-policy");
  assert.equal(fx.grove(["new", "same", "--all"]).status, 0);
  assertEnvelope(fx.grove(["--json", "new", "same", "--all"]), 4, "refused-conflict");
  assert.equal(fx.grove(["new", "dirty", "--repo", "alpha"]).status, 0);
  const dirtyTree = json(fx.grove(["--json", "tree", "ls", "dirty"]).stdout).detail.trees[0];
  writeFileSync(join(dirtyTree.path.value, "dirty.txt"), "dirty\n");
  assertEnvelope(fx.grove(["--json", "delete", "dirty"]), 5, "refused-precondition");
  assert.equal(fx.grove(["new", "git-error", "--all"]).status, 0);
  assertEnvelope(fx.grove(["--json", "tree", "add", "git-error", "alpha", "--name", "broken", "--branch", "new-branch", "--from", "missing-base"]), 2, "invalid revision");
  assert.equal(fx.grove(["new", "io-scope", "--all"]).status, 0);
  assertEnvelope(fx.grove(["--json", "file", "read", "missing.txt", "--grove", "io-scope"]), 7, "io");

  const outside = makeFixture({ repos: {} });
  assertEnvelope(outside.grove(["--json", "status"]), 8, "config");
  const path = workspaceConfig(fx.root);
  const config = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...config, schemaVersion: 999 }, null, 2) + "\n");
  // ASSERT:CMD-05:STDOUT-CONTAINS-ONE-JSON-VALUE-NO-PROSE-AGENT
  assertEnvelope(fx.grove(["--json", "status"]), 9, "version-skew");
});

test("CMD-07: unsupported command families are ordinary exit-2 errors with no hidden behavior", () => {
  const fx = initialized();
  for (const args of [["project", "ls"], ["cloud", "start"], ["syncer"], ["workspace", "use", "x"]]) {
    const error = assertEnvelope(fx.grove(["--json", ...args]), 2, args.join(" "));
    // ASSERT:CMD-07:EXITS-2-MATERIAL-CLAUSE-1
    assert.match(String(error.what), /Unknown command/);
    // ASSERT:CMD-07:NO-HIDDEN-COMPATIBILITY-BEHAVIOR-2
    assert.match(String(error.remedy), /grove --help/);
  }
  assert.deepEqual(readdirSync(join(fx.root, "groves")), []);
});

test("CMD-08: workspace-required commands outside a workspace refuse before locks, Git, or agents", () => {
  const fx = makeFixture({ repos: {} });
  for (const args of [["new", "x", "--all"], ["repo", "add", "/missing", "--name", "x"], ["agent", "run"]]) {
    const error = assertEnvelope(fx.grove(["--json", ...args]), 8, args.join(" "));
    assert.match(String(error.what), /workspace/i);
  }
  // ASSERT:CMD-08:REFUSES-BEFORE-LOCKS-GIT-SUBPROCESSES
  assert.deepEqual(readdirSync(fx.root), [], "no lock, manifest, Git, or subprocess artifact was created");
});

test("CMD-13: unsupported schema and unknown config keys exit 9/8 without rewriting the file", () => {
  const fx = initialized();
  const path = workspaceConfig(fx.root);
  const original = JSON.parse(readFileSync(path, "utf8"));
  for (const [raw, code] of [
    [{ ...original, schemaVersion: 999 }, 9],
    [{ ...original, unknown: true }, 8],
  ] as const) {
    const bytes = JSON.stringify(raw, null, 2) + "\n";
    writeFileSync(path, bytes);
    // Consolidated: the exit code AND the file's byte-identity are separate clauses. Both
    // obligations previously cited the byte equality, which cannot observe the exit code.
    // ASSERT:CMD-13:REFUSED-CONFIG-EXITS-THE-RIGHT-CODE-AND-IS-NEVER-REWRITTEN
    assert.deepEqual(
      { exit: fx.grove(["--json", "status"]).status, bytesAfter: readFileSync(path, "utf8") },
      { exit: code, bytesAfter: bytes },
      `schema/config exit ${code}`,
    );
  }
});

test("CMD-14: status inventories workspace, repositories, Groves, and Trees while config get returns the validated file", () => {
  const fx = initialized({ alpha: [] });
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "inventory", "--repo", "alpha"]).status, 0);
  const status = fx.grove(["--json", "status"]);
  assert.equal(status.status, 0, status.stderr);
  const inventory = json(status.stdout).detail;
  const human = fx.grove(["status"]);
  assert.match(human.stdout, /inventory/);
  assert.match(human.stdout, /inventory@alpha/);
  const config = json(fx.grove(["--json", "config", "get"]).stdout);
  // ASSERT:CMD-14:STATUS-LISTS-WORKSPACE-IDENTITY-REVISION-REPOSITORIES-GROVES-TREES
  assert.deepEqual(
    {
      workspace: inventory.workspace,
      hasId: Boolean(inventory.id),
      revisionType: typeof inventory.rev,
      repositories: inventory.repositories.map((repo: { name: string }) => repo.name),
      groves: inventory.groves.map((grove: { name: string }) => grove.name),
      trees: inventory.groves[0].trees.map((tree: { branch: { value: string } }) => tree.branch.value),
      config,
    },
    {
      workspace: fx.root,
      hasId: true,
      revisionType: "number",
      repositories: ["alpha"],
      groves: ["inventory"],
      trees: ["refs/heads/inventory"],
      config: JSON.parse(readFileSync(workspaceConfig(fx.root), "utf8")),
    },
  );
});

test("CMD-15: invoking the removed diff command returns the standard unknown-command envelope", () => {
  const fx = initialized();
  const result = fx.grove(["--json", "diff", "anything"]);
  const error = json(result.stdout).error;
  // ASSERT:CMD-15:REMOVED-DIFF-INVOCATION-USES-STANDARD-UNKNOWN-COMMAND-ERROR
  assert.deepEqual(
    { status: result.status, what: /Unknown command/.test(String(error.what)), remedy: /grove --help/.test(String(error.remedy)), stderr: result.stderr },
    { status: 2, what: true, remedy: true, stderr: "" },
  );
});

test("P1.1: invoking the removed migrate command returns the standard unknown-command envelope", () => {
  const fx = initialized();
  const result = fx.grove(["--json", "migrate", "--dry-run"]);
  const error = json(result.stdout).error;
  assert.deepEqual(
    { status: result.status, what: /Unknown command/.test(String(error.what)), remedy: /grove --help/.test(String(error.remedy)) },
    { status: 2, what: true, remedy: true },
  );
});

test("CMD-06: --progress=json keeps stdout pure and emits valid bracketed NDJSON on stderr", () => {
  const fx = initialized({ alpha: [] });
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const result = fx.grove(["--json", "--progress=json", "new", "progress", "--repo", "alpha"]);
  assert.equal(result.status, 0, result.stderr);
  const events = result.stderr.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  // ASSERT:CMD-06:STDERR-VALID-NDJSON-STDOUT-REMAINS-RESULT
  assert.deepEqual(
    {
      stdoutValues: result.stdout.trim().split("\n").length,
      stdoutCommand: json(result.stdout).command,
      progressStart: events[0].event,
      progressEnd: events.at(-1).event,
      progressExit: events.at(-1).exitCode,
    },
    { stdoutValues: 1, stdoutCommand: "new", progressStart: "command-start", progressEnd: "command-end", progressExit: 0 },
  );
});
