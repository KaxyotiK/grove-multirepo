import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { killAndReapFaultProcess, processGroupAlive, spawnFaultProcess } from "../testkit/git-fault.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);
const json = (value: string): any => JSON.parse(value.trim());
const deleteRecord = (fx: Fixture): any => readdirSync(join(fx.root, ".grove", "operations")).filter((name) => name.endsWith(".json")).map((name) => json(readFileSync(join(fx.root, ".grove", "operations", name), "utf8"))).find((record) => record.kind === "grove-delete");

async function interruptedDeleteWithEmptySlot(metadataFree: boolean): Promise<{ fx: Fixture; root: string; slot: string }> {
  const fx = makeFixture();
  for (const args of [["init"], ["config", "set", "--values", JSON.stringify({ layout: { trees: "groves/{grove}/trees/{repo}/{tree}" } })], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], metadataFree ? ["new", "g", "--all"] : ["new", "g"]]) assert.equal(fx.grove(args).status, 0, args.join(" "));
  if (!metadataFree) assert.equal(fx.grove(["tree", "add", "g", "alpha"]).status, 0);
  const root = join(fx.root, "groves", "g");
  const original = join(root, "trees", "alpha", "g@alpha");
  const slot = join(root, "trees", "beta");
  mkdirSync(slot);
  execFileSync("git", ["worktree", "move", "--", original, join(slot, "g@alpha")], { cwd: join(fx.root, "repos", "alpha") });
  assert.equal(fx.grove(["fix", "--move"]).status, 0);
  assert.equal(existsSync(slot), true);
  const gitArgs = ["worktree", "remove", ...(metadataFree ? [] : ["--force"]), "--", original];
  const gate = createGitGate(gitArgs);
  const command = spawnFaultProcess(process.execPath, [CLI, "delete", "g", ...(metadataFree ? [] : ["--allow-destructive-all"])], { cwd: fx.root, env: { ...process.env, HOME: fx.home, ...gate.env } });
  try { await waitForGitGate(gate, command); await killAndReapFaultProcess(command); }
  finally { gate.release(); if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
  assert.deepEqual(deleteRecord(fx).steps.find((step: any) => step.kind === "directory-remove").input.looseInventory.entries, []);
  return { fx, root, slot };
}

async function assertEmptySlotResume(metadataFree: boolean): Promise<void> {
  const { fx, root, slot } = await interruptedDeleteWithEmptySlot(metadataFree);
  const resumed = fx.grove(["--json", "reconcile"]);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.equal(json(resumed.stdout).outcome, "complete");
  assert.equal(deleteRecord(fx).state, "completed");
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(slot), false);
}

test("V3REL-01: interrupted delete resumes across an unchanged empty grouped Tree slot", async () => assertEmptySlotResume(false));
test("V3REL-02: interrupted metadata-free delete resumes across an unchanged empty grouped Tree slot", async () => assertEmptySlotResume(true));

test("V3REL-01: a file added within an empty structural slot remains outside recorded consent", async () => {
  const { fx, root, slot } = await interruptedDeleteWithEmptySlot(false);
  const late = join(slot, "keep.txt");
  writeFileSync(late, "keep\n");
  const resumed = fx.grove(["--json", "reconcile"]);
  assert.equal(resumed.status, 4, resumed.stdout + resumed.stderr);
  assert.equal(deleteRecord(fx).state, "conflicted");
  assert.ok(json(resumed.stdout).detail.resumed[0].evidence.addedLoose.includes("trees/beta/keep.txt"));
  assert.equal(readFileSync(late, "utf8"), "keep\n");
  assert.equal(existsSync(root), true);
});

const localUuid = (): string => {
  const output = execFileSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
  const value = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(value);
  return value.toLowerCase();
};

function assertAuditLockParity(holderKind: "same" | "legacy" | "foreign", recovery: "automatic" | "manual"): void {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const lock = join(fx.root, ".grove", "locks", "op-workspace.lock");
  const holder = { token: "fixture-lock", pid: 2_147_483_600, host: holderKind === "same" ? "fixture-previous-host" : hostname(), startedAt: 0, heartbeatAt: Date.now(), op: "fixture", ...(holderKind === "legacy" ? {} : { machineId: holderKind === "same" ? localUuid() : "22222222-2222-4222-8222-222222222222" }) };
  writeFileSync(lock, JSON.stringify(holder));
  const before = readFileSync(lock, "utf8");
  const doctor = fx.grove(["--json", "doctor"]);
  const audit = fx.grove(["--json", "reconcile", "--audit-only"]);
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.equal(audit.status, 0, audit.stdout + audit.stderr);
  const diagnostics = (result: any) => result.diagnostics.map((item: any) => ({ code: item.code, id: item.id })).sort((a: any, b: any) => a.id.localeCompare(b.id));
  assert.deepEqual(diagnostics(json(audit.stdout)), diagnostics(json(doctor.stdout)));
  assert.equal(json(audit.stdout).diagnostics.find((item: any) => item.code === "stale-lock")?.facts.recovery, recovery);
  assert.equal(readFileSync(lock, "utf8"), before);
}

test("V3REL-03: audit-only matches doctor for a same-machine dead workspace lock without reclaiming it", () => assertAuditLockParity("same", "automatic"));
test("V3REL-04: audit-only matches doctor for a legacy dead workspace lock without reclaiming it", () => assertAuditLockParity("legacy", "automatic"));
test("V3REL-05: audit-only matches doctor for a foreign-machine dead workspace lock without reclaiming it", () => assertAuditLockParity("foreign", "manual"));
