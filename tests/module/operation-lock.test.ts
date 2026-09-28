/**
 * P1-1: the lock spans precondition validation AND mutation (constitution:105).
 *
 * The first test is the discipline gate — it reads the command sources and fails if any handler
 * mutates outside the operation lock. That matters more than any single fixed case: the defect was
 * never one handler, it was that "take a lock around the whole operation" lived only in the
 * constitution and in no mechanism, so every new handler re-litigated it.
 *
 * The second test is what the gate could NOT check while there were two lock scopes. `delete` took
 * `workspace` and `tree configure` took `grove:<id>`, so both passed the discipline gate above
 * while sharing no key — `tree configure` could write a manifest into a Grove `delete` was
 * removing. "Interfering operations share a key" is a claim about every pair of handlers and
 * nothing could verify it. With one key it reduces to "there is one key", which a test can read.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beginOperation, operationLockPath, scanOperations } from "../../src/store/operation.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const COMMANDS_DIR = new URL("../../src/commands/", import.meta.url).pathname;

/** Calls that change durable state. A handler containing one is a mutation. */
const MUTATIONS = ["saveWorkspace(", "saveGroveManifest(", "beginOperation(", "recordPending(", "rmSync(", "renameSync("];

/**
 * `init` creates the workspace that would hold the lock, so there is nothing to lock yet — it is
 * `workspaceIndependent` for the same reason. Every other mutating handler must take one.
 */
const EXEMPT = new Set(["initHandler"]);

function handlerBodies(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async )?function (\w+Handler)\(ctx: CommandContext\)/.exec(lines[i] as string);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== "}") j++;
    out.push({ name: m[1] as string, body: lines.slice(i, j).join("\n") });
  }
  return out;
}

test("P1-1: every mutating command is declared and central dispatch holds the operation lock", () => {
  const offenders: string[] = [];
  let checked = 0;
  const cli = readFileSync(new URL("../../src/cli.ts", import.meta.url).pathname, "utf8");
  assert.match(cli, /match\.spec\.mutates[\s\S]*withOperation\(/, "central dispatch does not lock declared mutations");
  for (const file of readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(COMMANDS_DIR, file), "utf8");
    for (const { name, body } of handlerBodies(source)) {
      if (EXEMPT.has(name)) continue;
      if (!MUTATIONS.some((m) => body.includes(m))) continue;
      checked++;
      const registration = source.split("register({").slice(1).find((block) => block.includes(`handler: ${name}`));
      if (!registration?.includes("mutates: true")) offenders.push(`${file}:${name} is not declared mutating`);
    }
  }
  // Non-vacuous: if this drops to zero the gate has stopped finding handlers at all.
  assert.ok(checked >= 10, `expected to check the mutating surface, only found ${checked} handlers`);
  assert.deepEqual(offenders, [], `these handlers mutate without an operation lock:\n  ${offenders.join("\n  ")}`);
});

test("P1-1: there is exactly ONE operation lock key, so any two mutations interlock", () => {
  // Two Groves, two workspaces: the key must not vary with the Grove being operated on (that was
  // the `grove:<id>` scope, which let a Grove-local write miss a workspace-wide delete), but it
  // must still be per-workspace (two workspaces are genuinely independent).
  assert.equal(operationLockPath("/ws"), operationLockPath("/ws"), "one workspace, one key");
  assert.notEqual(operationLockPath("/ws-a"), operationLockPath("/ws-b"), "workspaces stay independent");

  // And no second lock namespace may reappear in the store layer. A new `op-<something>.lock`
  // would silently reintroduce the non-overlapping-scopes defect.
  const operation = readFileSync(new URL("../../src/store/operation.ts", import.meta.url).pathname, "utf8");
  const lockNames = [...operation.matchAll(/"(op-[a-z-]*)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(lockNames)], ["op-workspace"], `extra lock namespaces: ${lockNames.join(", ")}`);
});

test("P1-1/FR-023: forward operation records are invocation-unique and discoverable", () => {
  const ws = tempDir("operation-records");
  const plan = { kind: "tree-add", scope: { grove: "g" }, targetLocks: ["grove:g"], targets: [] };
  const first = beginOperation(ws, plan);
  const second = beginOperation(ws, plan);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.file, second.file);
  assert.deepEqual(scanOperations(ws).records.map((record) => record.id).sort(), [first.id, second.id].sort());
  assert.deepEqual(readdirSync(join(ws, ".grove", "operations")).filter((file) => file.endsWith(".json")).length, 2);
});
