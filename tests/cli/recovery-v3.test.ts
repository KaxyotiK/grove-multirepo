import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { killAndReapFaultProcess, processGroupAlive, spawnFaultProcess } from "../testkit/git-fault.ts";

after(cleanupTempDirs);
const json = (text: string): any => JSON.parse(text.trim());
const records = (fx: Fixture, kind: string): any[] => readdirSync(join(fx.root, ".grove", "operations")).filter((name) => name.endsWith(".json")).map((name) => json(readFileSync(join(fx.root, ".grove", "operations", name), "utf8"))).filter((record) => record.kind === kind);

async function interrupt(fx: Fixture, args: string[], gitArgs: string[]): Promise<void> {
  const gate = createGitGate(gitArgs);
  const command = spawnFaultProcess(process.execPath, [CLI, ...args], { cwd: fx.root, env: { ...process.env, HOME: fx.home, ...gate.env } });
  try { await waitForGitGate(gate, command); await killAndReapFaultProcess(command); }
  finally { gate.release(); if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
}

test("V3RCV-01: doctor and reconcile audit-only report the same pending-operation diagnostic set", async () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], { failExitCode: 42 });
  try { assert.notEqual(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { env: gate.env }).status, 0); }
  finally { gate.dispose(); }
  const before = records(fx, "repo-add")[0];
  const doctor = fx.grove(["--json", "doctor"]);
  const audit = fx.grove(["--json", "reconcile", "--audit-only"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(audit.status, 0, audit.stderr);
  const ids = (result: any) => result.diagnostics.map((d: any) => `${d.code}:${d.id}`).sort();
  assert.ok(json(doctor.stdout).diagnostics.some((d: any) => d.code === "pending-operation"));
  assert.deepEqual(ids(json(audit.stdout)), ids(json(doctor.stdout)));
  assert.deepEqual(records(fx, "repo-add")[0], before);
});

test("V3RCV-02: delete of a metadata-free Grove resumes and removes its empty scaffold", async () => {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g", "--all"]]) assert.equal(fx.grove(args).status, 0, args.join(" "));
  assert.equal(existsSync(join(fx.root, ".grove", "groves", "g.json")), false);
  const tree = join(fx.root, "groves", "g", "trees", "g@alpha");
  await interrupt(fx, ["delete", "g"], ["worktree", "remove", "--", tree]);
  const result = fx.grove(["--json", "reconcile"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(fx.root, "groves", "g")), false);
  assert.equal(records(fx, "grove-delete")[0]?.state, "completed");
});

test("V3RCV-02: explicit delete cleans only the empty scaffold left by an abandoned delete", async () => {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g", "--all"]]) assert.equal(fx.grove(args).status, 0);
  const root = join(fx.root, "groves", "g");
  await interrupt(fx, ["delete", "g"], ["worktree", "remove", "--", join(root, "trees", "g@alpha")]);
  writeFileSync(join(root, "late.txt"), "keep until explicitly removed\n");
  assert.notEqual(fx.grove(["reconcile"]).status, 0);
  const id = records(fx, "grove-delete")[0].id;
  assert.equal(fx.grove(["reconcile", "--abandon", id]).status, 0);
  const protectedRetry = fx.grove(["delete", "g"]);
  assert.notEqual(protectedRetry.status, 0);
  assert.equal(existsSync(join(root, "late.txt")), true);
  rmSync(join(root, "late.txt"));
  const retry = fx.grove(["--json", "delete", "g"]);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.equal(existsSync(root), false);
});

test("V3RCV-02: delete protects a cmux projection as loose Grove content", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["new", "g"]).status, 0);
  const projection = join(fx.root, "groves", "g", ".grove-cmux", "projection.json");
  mkdirSync(join(fx.root, "groves", "g", ".grove-cmux"));
  writeFileSync(projection, "{}\n");
  const refusal = fx.grove(["--json", "delete", "g"]);
  assert.equal(refusal.status, 5, refusal.stdout + refusal.stderr);
  assert.match(refusal.stdout + refusal.stderr, /projection\.json/);
  assert.equal(existsSync(projection), true);
  const consented = fx.grove(["delete", "g", "--allow-destructive-all"]);
  assert.equal(consented.status, 0, consented.stdout + consented.stderr);
  assert.equal(existsSync(projection), false);
});

test("V3RCV-03: retry of a pending archive names its reconcile remedy", async () => {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g", "--all"]]) assert.equal(fx.grove(args).status, 0);
  const tree = join(fx.root, "groves", "g", "trees", "g@alpha");
  await interrupt(fx, ["archive", "g", "--allow-unpushed"], ["worktree", "remove", "--", tree]);
  const id = records(fx, "grove-archive")[0].id;
  const retry = fx.grove(["--json", "archive", "g", "--allow-unpushed"]);
  assert.notEqual(retry.status, 0);
  assert.match(retry.stdout + retry.stderr, new RegExp(id));
  assert.match(retry.stdout + retry.stderr, /grove reconcile/);
});

test("V3RCV-04: independent interrupted repo adds finish after the first moves config revision", async () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repo of fx.repos) await interrupt(fx, ["repo", "add", repo.origin, "--name", repo.name], ["worktree", "add", "--", join(fx.root, "trunks", `main@${repo.name}`), "main"]);
  const result = fx.grove(["--json", "reconcile"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.map((r: any) => r.name).sort(), ["alpha", "beta"]);
  assert.deepEqual(records(fx, "repo-add").map((r) => r.state), ["completed", "completed"]);
});

test("V3RCV-04: a real alias conflict refuses only that pending acquisition", async () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repo of fx.repos) await interrupt(fx, ["repo", "add", repo.origin, "--name", repo.name], ["worktree", "add", "--", join(fx.root, "trunks", `main@${repo.name}`), "main"]);
  const configPath = join(fx.root, ".grove", "config.json");
  const config = json(readFileSync(configPath, "utf8"));
  config._rev += 1;
  config.repositories.push({ id: "external-alpha", name: "alpha", location: { kind: "linked", commonGitDir: fx.repos[1]!.origin }, remote: "origin", trunk: "main" });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = fx.grove(["--json", "reconcile"]);
  assert.equal(result.status, 4, result.stdout + result.stderr);
  const states = Object.fromEntries(records(fx, "repo-add").map((record) => [record.scope.repositoryAlias, record.state]));
  assert.deepEqual(states, { alpha: "conflicted", beta: "completed" });
  assert.deepEqual(json(readFileSync(configPath, "utf8")).repositories.map((repo: any) => repo.name).sort(), ["alpha", "beta"]);
});

test("V3RCV-03: an empty new whose metadata write fails names its exact reconcile operation", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const metadataDir = join(fx.root, ".grove", "groves");
  const mode = statSync(metadataDir).mode & 0o777;
  let failed;
  try { chmodSync(metadataDir, 0o500); failed = fx.grove(["--json", "new", "empty"]); }
  finally { chmodSync(metadataDir, mode); }
  assert.notEqual(failed.status, 0);
  const operation = records(fx, "new-grove")[0];
  assert.match(failed.stdout + failed.stderr, new RegExp(`grove reconcile --operation ${operation.id}`));
  assert.equal(fx.grove(["reconcile", "--operation", operation.id]).status, 0);
});

for (const command of ["rename", "restore"] as const) {
  test(`V3RCV-03: ${command} metadata failure names its exact reconcile operation`, () => {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    if (command === "rename") assert.equal(fx.grove(["new", "g"]).status, 0);
    else {
      for (const args of [["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g", "--all"], ["archive", "g", "--allow-unpushed"]]) assert.equal(fx.grove(args).status, 0, args.join(" "));
    }
    const metadataDir = join(fx.root, ".grove", "groves");
    const mode = statSync(metadataDir).mode & 0o777;
    let failed;
    try { chmodSync(metadataDir, 0o500); failed = fx.grove(["--json", command, "g", ...(command === "rename" ? ["renamed"] : [])]); }
    finally { chmodSync(metadataDir, mode); }
    assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
    const operation = records(fx, `grove-${command}`)[0];
    assert.match(failed.stdout + failed.stderr, new RegExp(`grove reconcile --operation ${operation.id}`));
    const recovery = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.equal(recovery.status, 0, recovery.stdout + recovery.stderr);
  });
}
